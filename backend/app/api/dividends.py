"""
배당금 관련 API 엔드포인트
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional, Dict
from datetime import date, timedelta

from .. import crud, schemas
from ..database import get_db
from ..services.dividend_service import dividend_service
from ..services.fx_service import fx_service
from ..services.position_engine import PositionEngine
from ..services.market_resolver import resolve_market
from ..services.krx_service import krx_service
from ..services.dividend_tax import apply_withholding_tax

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dividends", tags=["dividends"])


@router.post("/", response_model=schemas.DividendResponse)
def create_dividend(
    dividend: schemas.DividendCreate,
    db: Session = Depends(get_db)
):
    """배당금 수동 입력"""
    # 계정 존재 확인
    account = crud.get_account(db, dividend.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")
    
    # 중복 확인
    if crud.check_dividend_exists(db, dividend.account_id, dividend.ticker, dividend.dividend_date, dividend.amount_usd):
        raise HTTPException(status_code=400, detail="동일한 배당금 기록이 이미 존재합니다.")
    
    return crud.create_dividend(db, dividend, is_auto_imported=False)


@router.get("/", response_model=List[schemas.DividendResponse])
def get_dividends(
    account_id: Optional[int] = Query(None),
    ticker: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """배당금 목록 조회"""
    return crud.get_dividends(
        db,
        account_id=account_id,
        ticker=ticker,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit
    )


@router.get("/summary/", response_model=schemas.DividendSummary)
async def get_dividend_summary(
    account_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """배당금 요약 조회"""
    summary_data = crud.get_dividend_summary(db, account_id, year)

    # 환율 조회
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0

    return schemas.DividendSummary(
        total_dividends_usd=summary_data['total_dividends_usd'],
        total_dividends_krw=summary_data['total_dividends_usd'] * fx_rate,
        dividend_count=summary_data['dividend_count'],
        tickers_with_dividends=summary_data['tickers_with_dividends']
    )


@router.get("/by-ticker/", response_model=List[schemas.DividendByTicker])
def get_dividends_by_ticker(
    account_id: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """티커별 배당금 집계"""
    results = crud.get_dividends_by_ticker(db, account_id, year)
    return [schemas.DividendByTicker(**r) for r in results]


@router.get("/{dividend_id}", response_model=schemas.DividendResponse, include_in_schema=True)
@router.get("/{dividend_id}/", response_model=schemas.DividendResponse, include_in_schema=False)
def get_dividend(
    dividend_id: int,
    db: Session = Depends(get_db)
):
    """배당금 단건 조회"""
    dividend = crud.get_dividend(db, dividend_id)
    if not dividend:
        raise HTTPException(status_code=404, detail="배당금을 찾을 수 없습니다.")
    return dividend


@router.put("/{dividend_id}", response_model=schemas.DividendResponse, include_in_schema=True)
@router.put("/{dividend_id}/", response_model=schemas.DividendResponse, include_in_schema=False)
def update_dividend(
    dividend_id: int,
    dividend_update: schemas.DividendUpdate,
    db: Session = Depends(get_db)
):
    """배당금 수정"""
    updated = crud.update_dividend(db, dividend_id, dividend_update)
    if not updated:
        raise HTTPException(status_code=404, detail="배당금을 찾을 수 없습니다.")
    return updated


@router.delete("/{dividend_id}", include_in_schema=True)
@router.delete("/{dividend_id}/", include_in_schema=False)
def delete_dividend(
    dividend_id: int,
    db: Session = Depends(get_db)
):
    """배당금 삭제"""
    from sqlalchemy import delete
    from .. import models
    
    # 배당금 존재 확인
    dividend = crud.get_dividend(db, dividend_id)
    if not dividend:
        raise HTTPException(status_code=404, detail="배당금을 찾을 수 없습니다.")
    
    # 관련된 현금 거래를 먼저 삭제
    db.execute(delete(models.Cash).where(models.Cash.related_dividend_id == dividend_id))
    
    # 배당금 삭제
    success = crud.delete_dividend(db, dividend_id)
    if not success:
        raise HTTPException(status_code=404, detail="배당금을 찾을 수 없습니다.")
    
    return {"message": "배당금이 삭제되었습니다."}


def _auto_import_krx(db: Session, request: schemas.DividendAutoImportRequest, account):
    """KRX 계정 배당 자동 수집. pykrx DPS(연간 주당 배당금) + 15.4% 원천징수."""
    from .. import models

    start_date = request.start_date or date(date.today().year - 1, 1, 1)
    end_date = request.end_date or date.today()

    all_trades = crud.get_all_trades_for_calculation(db, request.account_id)

    imported_count = 0
    skipped_count = 0
    no_shares_count = 0
    failed_count = 0

    years = list(range(start_date.year, end_date.year + 1))
    for year in years:
        dps = krx_service.get_dividend_per_share(request.ticker, year)
        if dps is None or dps <= 0:
            failed_count += 1
            continue

        # 배당 기준일(연말 영업일 근사: 12/31)
        div_date = date(year, 12, 31)
        if div_date < start_date or div_date > end_date:
            continue

        trades_until = [
            t for t in all_trades
            if t["trade_date"] <= div_date and t["ticker"] == request.ticker
        ]
        if not trades_until:
            no_shares_count += 1
            continue

        engine = PositionEngine()
        engine.process_trades(trades_until)
        position = engine.get_position(request.ticker)
        if not position or position.is_closed() or position.total_shares <= 0:
            no_shares_count += 1
            continue

        shares_held = position.total_shares
        gross = dps * shares_held
        _, tax_withheld, net = apply_withholding_tax(gross, "KRW")

        if crud.check_dividend_exists(db, request.account_id, request.ticker, div_date, net):
            skipped_count += 1
            continue

        try:
            dividend_create = schemas.DividendCreate(
                account_id=request.account_id,
                ticker=request.ticker,
                amount_usd=net,  # KRW 단위 금액을 같은 컬럼에 기록 (계정 base_currency 기준)
                dividend_date=div_date,
                note=f"자동 수집 (연간 DPS ₩{dps:,.0f} x {shares_held:,.2f}주, 세금 ₩{tax_withheld:,.0f})",
                amount_per_share=dps,
                shares_held=shares_held,
                tax_withheld_usd=tax_withheld,
            )
            db_dividend = models.Dividend(**dividend_create.model_dump(), is_auto_imported=True)
            db.add(db_dividend)
            db.flush()

            cash_transaction = schemas.CashCreate(
                account_id=request.account_id,
                amount_usd=net,
                transaction_type="DIVIDEND",
                transaction_date=div_date,
                note=f"{request.ticker} 배당금 (세후)",
            )
            db_cash = models.Cash(**cash_transaction.model_dump(), related_dividend_id=db_dividend.id)
            db.add(db_cash)

            db.commit()
            imported_count += 1
        except Exception as e:
            db.rollback()
            logger.error(
                f"[AUTO-IMPORT-KRX] {request.ticker} 배당금 저장 실패 ({div_date}): {e}",
                exc_info=True
            )
            failed_count += 1

    return {
        "imported_count": imported_count,
        "skipped_count": skipped_count,
        "no_shares_count": no_shares_count,
        "failed_count": failed_count,
    }


@router.post("/auto-import/")
def auto_import_dividends(
    request: schemas.DividendAutoImportRequest,
    db: Session = Depends(get_db)
):
    """
    yfinance로 배당금 자동 가져오기
    
    개선사항:
    - 배당락일 시점의 보유 수량 계산
    - 총 배당금 = 주당 배당금 x 보유 수량
    - 15% 세금 원천징수 적용
    - 세후 배당금을 현금 거래로 자동 추가
    """
    # 계정 존재 확인
    account = crud.get_account(db, request.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")

    # 시장/통화별 라우팅
    market = resolve_market(request.ticker)
    if account.base_currency == "KRW" and market == "KRX":
        return _auto_import_krx(db, request, account)
    if account.base_currency == "USD" and market == "US":
        pass  # fall through to existing US logic below
    else:
        raise HTTPException(
            status_code=400,
            detail=f"ticker/account currency mismatch: {request.ticker} vs {account.base_currency}"
        )

    # 날짜 범위 설정
    start_date = request.start_date or (date.today() - timedelta(days=365))
    end_date = request.end_date or date.today()

    try:
        # yfinance로 배당금 이력 조회 (주당 배당금)
        dividends = dividend_service.get_dividend_history(request.ticker, start_date, end_date)
        
        # 해당 계정의 모든 거래 조회 (배당 시점의 보유 수량 계산을 위해)
        all_trades = crud.get_all_trades_for_calculation(db, request.account_id)
        
        imported_count = 0
        skipped_count = 0
        no_shares_count = 0  # 배당 시점에 보유하지 않은 경우
        
        for div in dividends:
            div_date = div['date']
            amount_per_share = div['amount']
            
            # 배당락일 시점의 보유 수량 계산
            # PositionEngine을 사용하여 배당락일까지의 거래만 처리
            trades_until_div_date = [
                t for t in all_trades 
                if t["trade_date"] <= div_date and t["ticker"] == request.ticker
            ]
            
            if not trades_until_div_date:
                # 배당락일 이전에 매수한 적이 없음
                no_shares_count += 1
                continue
            
            # PositionEngine으로 배당락일 시점의 포지션 계산
            engine = PositionEngine()
            engine.process_trades(trades_until_div_date)
            position = engine.get_position(request.ticker)
            
            if not position or position.is_closed() or position.total_shares <= 0:
                # 배당락일 시점에 보유 수량이 없음
                no_shares_count += 1
                continue
            
            shares_held = position.total_shares
            
            # 총 배당금 계산 (주당 배당금 x 보유 수량)
            gross_dividend = amount_per_share * shares_held
            
            # 통화별 원천징수세 적용
            _, tax_withheld, net_dividend = apply_withholding_tax(gross_dividend, "USD")

            # 중복 확인 (세후 배당금 기준)
            if crud.check_dividend_exists(
                db,
                request.account_id,
                request.ticker,
                div_date,
                net_dividend
            ):
                skipped_count += 1
                continue
            
            # 트랜잭션으로 배당금과 현금 거래를 함께 저장
            try:
                from .. import models
                
                # 배당금 생성 (커밋하지 않음)
                dividend_create = schemas.DividendCreate(
                    account_id=request.account_id,
                    ticker=request.ticker,
                    amount_usd=net_dividend,  # 세후 총 배당금
                    dividend_date=div_date,
                    note=f"자동 가져오기 (주당 ${amount_per_share:.4f} x {shares_held:.2f}주, 세금 ${tax_withheld:.2f})",
                    amount_per_share=amount_per_share,
                    shares_held=shares_held,
                    tax_withheld_usd=tax_withheld
                )
                db_dividend = models.Dividend(
                    **dividend_create.model_dump(),
                    is_auto_imported=True
                )
                db.add(db_dividend)
                db.flush()  # ID를 얻기 위해 flush (아직 커밋 안 함)
                
                # 세후 배당금을 현금 거래로 자동 추가
                cash_transaction = schemas.CashCreate(
                    account_id=request.account_id,
                    amount_usd=net_dividend,
                    transaction_type="DIVIDEND",
                    transaction_date=div_date,
                    note=f"{request.ticker} 배당금 (세후)"
                )
                db_cash = models.Cash(
                    **cash_transaction.model_dump(),
                    related_dividend_id=db_dividend.id
                )
                db.add(db_cash)
                
                # 배당금과 현금 거래를 함께 커밋
                db.commit()
                imported_count += 1
                
            except Exception as e:
                # 에러 발생 시 롤백하여 데이터 일관성 유지
                db.rollback()
                logger.error(
                    f"[AUTO-IMPORT] {request.ticker} 배당금 저장 실패 ({div_date}): {e}",
                    exc_info=True
                )
                # 개별 배당금 저장 실패는 건너뛰고 계속 진행
                continue
        
        return {
            "message": f"{request.ticker} 배당금 자동 가져오기 완료",
            "ticker": request.ticker,
            "imported_count": imported_count,
            "skipped_count": skipped_count,
            "no_shares_count": no_shares_count,
            "total_found": len(dividends),
            "date_range": {
                "start": start_date.isoformat(),
                "end": end_date.isoformat()
            }
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"배당금 자동 가져오기 실패: {str(e)}"
        )


@router.get("/yield/{ticker}", include_in_schema=True)
@router.get("/yield/{ticker}/", include_in_schema=False)
def get_dividend_yield(ticker: str):
    """배당 수익률 조회"""
    try:
        yield_value = dividend_service.get_dividend_yield(ticker)
        if yield_value is None:
            return {
                "ticker": ticker,
                "dividend_yield": None,
                "message": "배당 수익률 정보가 없습니다."
            }
        return {
            "ticker": ticker,
            "dividend_yield": yield_value,
            "message": f"{yield_value:.2f}%"
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"배당 수익률 조회 실패: {str(e)}"
        )


@router.post("/year-import/")
def import_dividends_by_year(
    request: schemas.DividendYearImportRequest,
    db: Session = Depends(get_db)
):
    """
    연도별 배당금 자동 가져오기

    - 계정의 모든 보유 티커 대상
    - 선택한 연도의 배당 데이터만 조회
    - 미리보기 기능 제공
    """
    # 계정 존재 확인
    account = crud.get_account(db, request.account_id)
    if not account:
        raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")

    # 연도 범위 설정
    start_date = date(request.year, 1, 1)
    end_date = date(request.year, 12, 31)

    # 계정의 모든 티커 조회 (해당 연도에 거래가 있었던 종목들)
    account_tickers = crud.get_account_tickers_in_year(
        db, request.account_id, request.year
    )

    # 요청된 티커들만 필터링
    if request.tickers:
        account_tickers = [t for t in account_tickers if t in request.tickers]

    preview_data = []
    total_imported = 0
    total_skipped = 0
    total_errors = 0
    failed_tickers = []

    # 배당 데이터 캐시 (미리보기와 실제 가져오기에서 재사용)
    dividend_cache = {} if not request.preview_only else None

    for ticker in account_tickers:
        try:
            # 배당 데이터 미리보기 생성
            ticker_preview = crud.generate_dividend_preview(
                db, request.account_id, ticker, start_date, end_date, dividend_cache
            )
            preview_data.append(ticker_preview)

            if not request.preview_only:
                # 실제 가져오기 실행 (캐시된 배당 데이터 사용)
                result = import_ticker_dividends(
                    db, request.account_id, ticker, start_date, end_date, dividend_cache
                )
                total_imported += result['imported']
                total_skipped += result['skipped']
                total_errors += result.get('errors', 0)

        except Exception as e:
            # 개별 티커 실패는 전체 실패로 처리하지 않음
            logger.error(f"Error processing {ticker}: {e}", exc_info=True)
            failed_tickers.append({"ticker": ticker, "error": str(e)})
            total_errors += 1
            continue

    summary_data = {
        "year": request.year,
        "tickers_processed": len(account_tickers),
        "total_dividends_found": sum(len(p['dividends']) for p in preview_data),
        "total_amount_usd": sum(p['total_amount_usd'] for p in preview_data),
        "imported_count": total_imported,
        "skipped_count": total_skipped,
        "error_count": total_errors,
    }
    
    # 실패한 티커가 있으면 추가 정보 포함
    if failed_tickers:
        summary_data["failed_tickers"] = failed_tickers
        summary_data["failed_count"] = len(failed_tickers)
    
    return schemas.DividendYearImportResponse(
        preview_data=preview_data if request.preview_only else None,
        summary=summary_data
    )


@router.get("/year-preview/{account_id}/{year}", include_in_schema=True)
@router.get("/year-preview/{account_id}/{year}/", include_in_schema=False)
def get_year_dividend_preview(
    account_id: int,
    year: int,
    tickers: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db)
):
    """연도별 배당 미리보기"""
    try:
        # 계정 존재 확인
        account = crud.get_account(db, account_id)
        if not account:
            raise HTTPException(status_code=404, detail="계정을 찾을 수 없습니다.")

        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)

        # 계정의 티커 목록
        account_tickers = crud.get_account_tickers_in_year(db, account_id, year)
        if tickers:
            account_tickers = [t for t in account_tickers if t in tickers]

        preview_data = []
        for ticker in account_tickers:
            try:
                ticker_preview = crud.generate_dividend_preview(
                    db, account_id, ticker, start_date, end_date
                )
                preview_data.append(ticker_preview)
            except Exception as e:
                logger.error(f"Error generating preview for {ticker}: {e}")
                # 개별 티커 실패는 빈 결과로 처리
                preview_data.append({
                    'ticker': ticker,
                    'dividends': [],
                    'total_amount_usd': 0.0,
                    'dividend_count': 0,
                    'existing_count': 0
                })

        return {
            "year": year,
            "account_id": account_id,
            "tickers": account_tickers,
            "preview_data": preview_data,
            "summary": {
                "total_dividends": sum(len(p['dividends']) for p in preview_data),
                "estimated_total_usd": sum(p['total_amount_usd'] for p in preview_data),
            }
        }
    except Exception as e:
        logger.error(f"Year preview failed for account {account_id}, year {year}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"미리보기 생성 실패: {str(e)}")


def import_ticker_dividends(
    db: Session, account_id: int, ticker: str, start_date: date, end_date: date,
    dividend_cache: Optional[Dict[str, List]] = None
) -> Dict[str, int]:
    """특정 티커의 배당 데이터를 가져옴"""
    from ..services.dividend_service import dividend_service
    from ..core.exceptions import ExternalServiceError
    from .. import models

    # 배당 데이터 조회 (캐시 우선 사용)
    if dividend_cache and ticker in dividend_cache:
        dividends = dividend_cache[ticker]
    else:
        try:
            dividends = dividend_service.get_dividend_history(ticker, start_date, end_date)
            # 캐시에 저장
            if dividend_cache is not None:
                dividend_cache[ticker] = dividends
        except ExternalServiceError as e:
            # yfinance 서비스 에러는 상위로 전파
            logger.error(f"[IMPORT] {ticker} 배당 이력 조회 실패: {e}")
            raise
        except Exception as e:
            # 기타 예외는 ExternalServiceError로 변환
            logger.error(f"[IMPORT] {ticker} 배당 이력 조회 중 예상치 못한 에러: {e}", exc_info=True)
            raise ExternalServiceError(f"{ticker} 배당 이력 조회 실패: {str(e)}")

    # 계정의 모든 거래 조회
    all_trades = crud.get_all_trades_for_calculation(db, account_id)

    imported_count = 0
    skipped_count = 0
    error_count = 0

    for div in dividends:
        div_date = div['date']
        amount_per_share = div['amount']

        # 배당락일 시점의 보유 수량 계산
        trades_until_div_date = [
            t for t in all_trades
            if t["trade_date"] <= div_date and t["ticker"] == ticker
        ]

        if not trades_until_div_date:
            continue

        # 포지션 계산
        engine = PositionEngine()
        engine.process_trades(trades_until_div_date)
        position = engine.get_position(ticker)

        if not position or position.is_closed() or position.total_shares <= 0:
            continue

        shares_held = position.total_shares

        # 총 배당금 계산
        gross_dividend = amount_per_share * shares_held
        tax_rate = 0.15
        tax_withheld = gross_dividend * tax_rate
        net_dividend = gross_dividend - tax_withheld

        # 중복 확인
        if crud.check_dividend_exists(
            db, account_id, ticker, div_date, net_dividend
        ):
            skipped_count += 1
            continue

        # 트랜잭션으로 배당금과 현금 거래를 함께 저장
        try:
            # 배당금 생성 (커밋하지 않음)
            dividend_create = schemas.DividendCreate(
                account_id=account_id,
                ticker=ticker,
                amount_usd=net_dividend,
                dividend_date=div_date,
                note=f"yfinance 자동 가져오기 (주당 ${amount_per_share:.4f} x {shares_held:.2f}주, 세금 ${tax_withheld:.2f})",
                amount_per_share=amount_per_share,
                shares_held=shares_held,
                tax_withheld_usd=tax_withheld
            )
            db_dividend = models.Dividend(
                **dividend_create.model_dump(),
                is_auto_imported=True
            )
            db.add(db_dividend)
            db.flush()  # ID를 얻기 위해 flush (아직 커밋 안 함)

            # 현금 거래 생성
            cash_transaction = schemas.CashCreate(
                account_id=account_id,
                amount_usd=net_dividend,
                transaction_type="DIVIDEND",
                transaction_date=div_date,
                note=f"{ticker} 배당금 (세후)"
            )
            db_cash = models.Cash(
                **cash_transaction.model_dump(),
                related_dividend_id=db_dividend.id
            )
            db.add(db_cash)
            
            # 배당금과 현금 거래를 함께 커밋
            db.commit()
            imported_count += 1
            
        except Exception as e:
            # 에러 발생 시 롤백하여 데이터 일관성 유지
            db.rollback()
            logger.error(
                f"[IMPORT] {ticker} 배당금 저장 실패 ({div_date}): {e}",
                exc_info=True
            )
            error_count += 1
            continue

    return {
        "imported": imported_count,
        "skipped": skipped_count,
        "errors": error_count
    }

