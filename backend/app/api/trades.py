"""
거래 관련 API 엔드포인트
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import distinct
from typing import List, Optional
from datetime import date, datetime
from collections import Counter
import csv
import io

from .. import crud, schemas, models
from ..database import get_db
from ..core.exceptions import (
    not_found_exception, 
    validation_exception, 
    business_logic_exception,
    external_service_exception
)
from ..services.position_engine import PositionEngine
from ..services.market_resolver import validate_ticker_against_account

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/trades", tags=["trades"])


@router.post("/", response_model=schemas.TradeResponse)
def create_trade(trade: schemas.TradeCreate, db: Session = Depends(get_db)):
    """거래 생성"""
    try:
        # 입력 검증
        if not trade.ticker or not trade.ticker.strip():
            raise validation_exception("티커는 필수입니다.")
        
        if trade.side.upper() not in ['BUY', 'SELL']:
            raise validation_exception("매매유형은 BUY 또는 SELL이어야 합니다.")
        
        if trade.shares <= 0:
            raise validation_exception("수량은 0보다 커야 합니다.")
        
        if trade.price_usd <= 0:
            raise validation_exception("단가는 0보다 커야 합니다.")
        
        # 거래일 미래 날짜 검증
        if trade.trade_date > date.today():
            raise validation_exception("거래일은 오늘 이후 날짜일 수 없습니다.")
        
        # 계정 존재 확인
        account = crud.get_account(db, trade.account_id)
        if not account:
            raise not_found_exception("계정", str(trade.account_id))
        
        if not account.is_active:
            raise validation_exception(f"계정 '{account.name}'이 비활성화되어 있습니다.")

        # 티커·계정통화 정합성 검증
        try:
            validate_ticker_against_account(trade.ticker, account.base_currency)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # 거래/현금을 하나의 트랜잭션으로 처리
        db_trade = crud.create_trade(db, trade, commit=False)
        
        # 현금 자동 증감 처리
        total_amount = trade.shares * trade.price_usd
        
        try:
            if trade.side == "BUY":
                # 매수 시 현금 차감
                cash_transaction = schemas.CashCreate(
                    account_id=trade.account_id,
                    amount_usd=total_amount,
                    transaction_type="BUY",
                    transaction_date=trade.trade_date,
                    note=f"{trade.ticker} 매수"
                )
                crud.create_cash(db, cash_transaction, related_trade_id=db_trade.id, commit=False)
            elif trade.side == "SELL":
                # 매도 시 현금 추가
                cash_transaction = schemas.CashCreate(
                    account_id=trade.account_id,
                    amount_usd=total_amount,
                    transaction_type="SELL",
                    transaction_date=trade.trade_date,
                    note=f"{trade.ticker} 매도"
                )
                crud.create_cash(db, cash_transaction, related_trade_id=db_trade.id, commit=False)
        except Exception as cash_error:
            # 현금 거래 생성 실패 시 거래도 롤백
            db.rollback()
            logger.error(f"현금 거래 생성 실패로 거래 생성 롤백: {cash_error}")
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "현금 거래 처리 중 오류가 발생했습니다. 거래가 저장되지 않았습니다.",
                    "error_code": "CASH_TRANSACTION_ERROR",
                    "detail": str(cash_error)  # 개발용 상세 정보
                }
            )
        db.commit()
        db.refresh(db_trade)
        return db_trade
        
    except HTTPException:
        raise
    except Exception as e:
        # 예상치 못한 오류 발생 시 롤백
        db.rollback()
        logger.error(f"거래 생성 중 오류 발생: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "message": "거래 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
                "error_code": "INTERNAL_ERROR",
                "detail": str(e)  # 개발용 상세 정보
            }
        )


@router.get("/", response_model=List[schemas.TradeResponse])
def get_trades(
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    side: Optional[str] = None,
    min_amount_usd: Optional[float] = None,
    max_amount_usd: Optional[float] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """
    거래 목록 조회
    
    고급 필터링:
    - min_amount_usd: 최소 거래 금액
    - max_amount_usd: 최대 거래 금액
    """
    trades = crud.get_trades(db, account_id, ticker, start_date, end_date, side, skip, limit)
    
    # 거래 금액 필터링
    if min_amount_usd is not None or max_amount_usd is not None:
        filtered_trades = []
        for trade in trades:
            amount = trade.shares * trade.price_usd
            if min_amount_usd is not None and amount < min_amount_usd:
                continue
            if max_amount_usd is not None and amount > max_amount_usd:
                continue
            filtered_trades.append(trade)
        return filtered_trades
    
    return trades


@router.get("/tickers/", response_model=List[str])
def get_tickers(
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """특정 계정의 거래 이력에 있는 고유 티커 목록 조회
    
    현재 보유 여부와 무관하게, 해당 계정에서 거래한 적이 있는 모든 티커를 반환합니다.
    """
    logger.debug(f"get_tickers called with account_id={account_id}, type={type(account_id)}")
    
    query = db.query(distinct(models.Trade.ticker))
    
    # account_id가 제공된 경우에만 필터링 (유효성 검증)
    if account_id is not None:
        # account_id가 양수인지 확인
        if account_id <= 0:
            logger.warning(f"Invalid account_id: {account_id}")
            raise HTTPException(
                status_code=422,
                detail="account_id는 양수여야 합니다."
            )
        query = query.filter(models.Trade.account_id == account_id)
    
    tickers = query.order_by(models.Trade.ticker).all()
    result = [t[0] for t in tickers]
    logger.debug(f"Returning {len(result)} tickers")
    return result


@router.get("/{trade_id}", response_model=schemas.TradeResponse, include_in_schema=True)
@router.get("/{trade_id}/", response_model=schemas.TradeResponse, include_in_schema=False)
def get_trade(trade_id: int, db: Session = Depends(get_db)):
    """거래 조회"""
    trade = crud.get_trade(db, trade_id)
    if not trade:
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")
    return trade


@router.put("/{trade_id}", response_model=schemas.TradeResponse, include_in_schema=True)
@router.put("/{trade_id}/", response_model=schemas.TradeResponse, include_in_schema=False)
def update_trade(trade_id: int, trade_update: schemas.TradeUpdate, db: Session = Depends(get_db)):
    """거래 수정"""
    # 계정이 변경되는 경우 계정 존재 확인
    if trade_update.account_id is not None:
        account = crud.get_account(db, trade_update.account_id)
        if not account:
            raise HTTPException(status_code=404, detail=f"계정 ID {trade_update.account_id}를 찾을 수 없습니다.")

    # 기존 거래 정보 조회 (현금 데이터 갱신을 위해)
    existing_trade = crud.get_trade(db, trade_id)
    if not existing_trade:
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")

    # 티커·계정통화 정합성 검증 (변경 여부와 무관하게 유효 값으로 검증)
    effective_ticker = trade_update.ticker if trade_update.ticker is not None else existing_trade.ticker
    effective_account_id = trade_update.account_id if trade_update.account_id is not None else existing_trade.account_id
    effective_account = crud.get_account(db, effective_account_id)
    if effective_account:
        try:
            validate_ticker_against_account(effective_ticker, effective_account.base_currency)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    
    # 거래/현금을 하나의 트랜잭션으로 처리
    trade = crud.update_trade(db, trade_id, trade_update, commit=False)
    if not trade:
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")
    
    # 현금 데이터 갱신 처리
    try:
        # 기존 현금 거래 조회
        existing_cash = db.query(models.Cash).filter(models.Cash.related_trade_id == trade_id).first()
        
        if existing_cash:
            # 새로운 거래 정보로 현금 거래 갱신
            new_total_amount = trade.shares * trade.price_usd
            
            # 현금 거래 정보 업데이트
            existing_cash.account_id = trade.account_id
            existing_cash.amount_usd = new_total_amount
            existing_cash.transaction_type = trade.side
            existing_cash.transaction_date = trade.trade_date
            existing_cash.note = f"{trade.ticker} {trade.side}"
            existing_cash.updated_at = datetime.now()
            
            db.flush()
        
        db.commit()
        db.refresh(trade)
        if existing_cash:
            db.refresh(existing_cash)
    except Exception as e:
        db.rollback()
        logger.error(f"거래/현금 동시 수정 실패 (trade_id={trade_id}): {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "message": "거래 수정 중 오류가 발생했습니다. 변경사항이 저장되지 않았습니다.",
                "error_code": "TRADE_UPDATE_ERROR"
            }
        )
    
    return trade


@router.delete("/{trade_id}", include_in_schema=True)
@router.delete("/{trade_id}/", include_in_schema=False)
def delete_trade(trade_id: int, db: Session = Depends(get_db)):
    """거래 삭제"""
    # 거래와 연결된 현금 거래를 효율적으로 삭제
    from sqlalchemy import delete
    
    # 관련된 현금 거래를 한번에 삭제
    db.execute(delete(models.Cash).where(models.Cash.related_trade_id == trade_id))
    
    success = crud.delete_trade(db, trade_id)
    if not success:
        raise HTTPException(status_code=404, detail="거래를 찾을 수 없습니다.")
    return {"message": "거래가 삭제되었습니다."}


@router.post("/bulk-delete/")
def bulk_delete_trades(trade_ids: List[int], db: Session = Depends(get_db)):
    """거래 일괄 삭제"""
    # 거래와 연결된 현금 거래를 효율적으로 삭제
    from sqlalchemy import delete
    
    # 관련된 현금 거래를 한번에 삭제
    db.execute(delete(models.Cash).where(models.Cash.related_trade_id.in_(trade_ids)))
    
    deleted_count = crud.delete_trades_bulk(db, trade_ids)
    return {"message": f"{deleted_count}건의 거래가 삭제되었습니다.", "deleted_count": deleted_count}


@router.post("/import/csv/", response_model=schemas.CSVImportResponse)
async def import_csv(
    file: UploadFile = File(...), 
    import_mode: str = "append",  # append, replace, merge
    default_account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """CSV 파일로 거래 일괄 등록
    
    Args:
        import_mode: 
            - "append": 기존 데이터에 추가 (기본값)
            - "replace": 기존 거래를 모두 삭제하고 새로 추가
            - "merge": 중복 거래는 건너뛰고 새 거래만 추가
        default_account_id: CSV에 계정 정보가 없을 때 사용할 기본 계정 ID
    """
    logger.info(f"CSV Import started - Mode: {import_mode}, Default Account: {default_account_id}")
    try:
        # 파일 형식 검증
        if not file.filename or not file.filename.lower().endswith('.csv'):
            raise validation_exception("CSV 파일만 업로드 가능합니다.")
        
        # 파일 크기 검증 (10MB 제한)
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:  # 10MB
            raise validation_exception("파일 크기가 10MB를 초과합니다.")
        
        # import_mode 검증
        if import_mode not in ["append", "replace", "merge"]:
            raise validation_exception("import_mode는 append, replace, merge 중 하나여야 합니다.")
        
        decoded = content.decode('utf-8-sig')  # BOM 제거
        logger.debug(f"CSV content decoded, length: {len(decoded)}")
        
        reader = csv.DictReader(io.StringIO(decoded))
        logger.debug(f"CSV fieldnames: {reader.fieldnames}")
        
        # 필수 컬럼 검증
        required_columns = ['ticker', 'side', 'shares', 'price_usd', 'trade_date']
        if not all(col in reader.fieldnames for col in required_columns):
            missing_cols = [col for col in required_columns if col not in reader.fieldnames]
            logger.warning(f"Missing required columns: {missing_cols}")
            raise validation_exception(f"필수 컬럼이 누락되었습니다: {', '.join(missing_cols)}")
        
        # 지원하는 컬럼 목록 (account_name은 무시)
        supported_columns = ['ticker', 'side', 'shares', 'price_usd', 'trade_date', 'note', 'account_id', 'account_name']
        unsupported_columns = [col for col in reader.fieldnames if col not in supported_columns]
        if unsupported_columns:
            logger.warning(f"지원하지 않는 컬럼이 있습니다 (무시됨): {', '.join(unsupported_columns)}")
        
        # 기본 계정 설정
        if default_account_id is None:
            # 활성 계정 중 첫 번째 계정을 기본값으로 사용
            default_account = crud.get_accounts(db, is_active=True)
            if not default_account:
                raise validation_exception("활성 계정이 없습니다. 먼저 계정을 생성해주세요.")
            default_account_id = default_account[0].id
        
        # 기본 계정 존재 확인
        default_account = crud.get_account(db, default_account_id)
        if not default_account:
            raise validation_exception(f"기본 계정 ID {default_account_id}를 찾을 수 없습니다.")
        
        success_count = 0
        failed_count = 0
        skipped_count = 0
        errors = []
        created_accounts = []  # 자동 생성된 계정 이름 추적
        replace_rows = []
        
        # merge 모드인 경우 기존 거래 해시셋 생성
        existing_trades = set()
        if import_mode == "merge":
            existing_trades = crud.get_existing_trade_hashes(db)
        
        for i, row in enumerate(reader, start=2):  # 헤더 다음 줄부터 2
            try:
                logger.debug(f"Processing row {i}: {row}")
                
                # 빈 행 건너뛰기
                if not any(row.values()) or not row.get('ticker', '').strip():
                    logger.debug(f"Skipping empty row {i}")
                    continue
                
                # 데이터 검증
                if not row['ticker'] or not row['ticker'].strip():
                    raise ValueError("티커는 필수입니다.")
                
                ticker_upper = row['ticker'].strip().upper()
                if len(ticker_upper) > 20:
                    raise ValueError(f"티커는 20자 이하여야 합니다. (현재: {len(ticker_upper)}자)")
                
                if row['side'].strip().upper() not in ['BUY', 'SELL']:
                    raise ValueError("매매유형은 BUY 또는 SELL이어야 합니다.")
                
                try:
                    shares = float(row['shares'])
                    if shares <= 0:
                        raise ValueError("수량은 0보다 커야 합니다.")
                    if shares > 1000000000:  # 10억 주 제한
                        raise ValueError("수량이 너무 큽니다. (최대 10억 주)")
                except (ValueError, TypeError) as e:
                    raise ValueError(f"잘못된 수량 값: {row['shares']} - {str(e)}")
                
                try:
                    price_usd = float(row['price_usd'])
                    if price_usd <= 0:
                        raise ValueError("단가는 0보다 커야 합니다.")
                    if price_usd > 1000000:  # 100만 달러 제한
                        raise ValueError("단가가 너무 큽니다. (최대 1,000,000 USD)")
                except (ValueError, TypeError) as e:
                    raise ValueError(f"잘못된 단가 값: {row['price_usd']} - {str(e)}")
                
                # 거래일 검증
                try:
                    trade_date = date.fromisoformat(row['trade_date'])
                    if trade_date > date.today():
                        raise ValueError("거래일은 오늘 이후 날짜일 수 없습니다.")
                    # 1900년 이전 날짜는 비현실적
                    if trade_date < date(1900, 1, 1):
                        raise ValueError("거래일은 1900년 이후여야 합니다.")
                except (ValueError, TypeError) as e:
                    if "거래일은" in str(e):
                        raise
                    raise ValueError(f"잘못된 거래일 형식: {row['trade_date']} - {str(e)}")
                
                # 계정 결정 (우선순위: account_name > account_id > default)
                account_id = default_account_id
                
                # 1. account_name이 있으면 해당 계정 조회 또는 생성
                if 'account_name' in row and row['account_name'].strip():
                    account_name = row['account_name'].strip()
                    
                    # 이름으로 계정 조회
                    account = crud.get_account_by_name(db, account_name)
                    
                    if not account:
                        # 계정이 없으면 자동 생성
                        logger.info(f"Creating new account: {account_name}")
                        new_account = schemas.AccountCreate(
                            name=account_name,
                            description=f"CSV 업로드 시 자동 생성됨",
                            is_active=True
                        )
                        account = models.Account(**new_account.model_dump())
                        db.add(account)
                        db.flush()  # ID 생성을 위해 flush
                        logger.info(f"Created account: {account.name} (ID: {account.id})")
                        
                        # 생성된 계정 추적 (중복 제거)
                        if account_name not in created_accounts:
                            created_accounts.append(account_name)
                    
                    account_id = account.id
                
                # 2. account_id가 명시되어 있으면 해당 계정 사용
                elif 'account_id' in row and row['account_id'].strip():
                    try:
                        account_id = int(row['account_id'])
                        # 계정 존재 확인
                        account = crud.get_account(db, account_id)
                        if not account:
                            raise ValueError(f"계정 ID {account_id}를 찾을 수 없습니다.")
                    except (ValueError, TypeError) as e:
                        raise ValueError(f"잘못된 계정 ID: {row['account_id']} - {str(e)}")
                
                # merge 모드인 경우 중복 확인
                if import_mode == "merge":
                    trade_hash = f"{account_id}_{row['ticker'].strip().upper()}_{row['side'].strip().upper()}_{shares}_{price_usd}_{row['trade_date']}"
                    if trade_hash in existing_trades:
                        skipped_count += 1
                        continue
                    existing_trades.add(trade_hash)
                
                # trade_date는 이미 위에서 검증됨
                normalized_trade = schemas.TradeCreate(
                    account_id=account_id,
                    ticker=row['ticker'].strip().upper(),
                    side=row['side'].strip().upper(),
                    shares=shares,
                    price_usd=price_usd,
                    trade_date=trade_date,
                    note=row.get('note', '').strip() or None
                )

                # replace 모드는 전체 검증이 끝난 후 일괄 반영
                if import_mode == "replace":
                    replace_rows.append(normalized_trade)
                    success_count += 1
                    continue

                # append/merge 모드: 즉시 세션에 추가 (최종 commit은 루프 종료 후)
                db_trade = models.Trade(**normalized_trade.model_dump())
                db.add(db_trade)
                db.flush()  # ID 생성을 위해 flush

                total_amount = shares * price_usd
                if normalized_trade.side == "BUY":
                    cash_transaction = models.Cash(
                        account_id=account_id,
                        amount_usd=total_amount,
                        transaction_type="BUY",
                        related_trade_id=db_trade.id,
                        transaction_date=trade_date,
                        note=f"{normalized_trade.ticker} 매수"
                    )
                    db.add(cash_transaction)
                elif normalized_trade.side == "SELL":
                    cash_transaction = models.Cash(
                        account_id=account_id,
                        amount_usd=total_amount,
                        transaction_type="SELL",
                        related_trade_id=db_trade.id,
                        transaction_date=trade_date,
                        note=f"{normalized_trade.ticker} 매도"
                    )
                    db.add(cash_transaction)

                success_count += 1
                
            except ValueError as e:
                failed_count += 1
                error_msg = f"라인 {i}: {str(e)}"
                errors.append(error_msg)
                logger.warning(f"ValueError in row {i}: {str(e)}")
            except Exception as e:
                failed_count += 1
                error_msg = f"라인 {i}: 예상치 못한 오류 - {str(e)}"
                errors.append(error_msg)
                logger.error(f"Unexpected error in row {i}: {str(e)}", exc_info=True)
        
        # replace 모드는 오류가 있으면 전체 취소 (기존 데이터 보호)
        if import_mode == "replace" and failed_count > 0:
            raise validation_exception(
                "replace 모드에서는 오류가 있는 행이 있으면 전체 작업을 취소합니다. 오류를 수정한 뒤 다시 시도해주세요."
            )

        if import_mode == "replace":
            from sqlalchemy import delete

            # 기존 거래/연결된 현금 삭제 후 검증 완료된 데이터만 재적재
            db.execute(delete(models.Cash).where(models.Cash.related_trade_id.isnot(None)))
            db.execute(delete(models.Trade))
            db.flush()

            for trade_data in replace_rows:
                db_trade = models.Trade(**trade_data.model_dump())
                db.add(db_trade)
                db.flush()

                total_amount = trade_data.shares * trade_data.price_usd
                cash_transaction = models.Cash(
                    account_id=trade_data.account_id,
                    amount_usd=total_amount,
                    transaction_type=trade_data.side,
                    related_trade_id=db_trade.id,
                    transaction_date=trade_data.trade_date,
                    note=f"{trade_data.ticker} {'매수' if trade_data.side == 'BUY' else '매도'}"
                )
                db.add(cash_transaction)

        # 모든 거래와 현금 데이터를 한번에 commit
        db.commit()
        logger.info(f"CSV Import completed - Success: {success_count}, Failed: {failed_count}, Created accounts: {created_accounts}")
        
        return schemas.CSVImportResponse(
            success=success_count,
            failed=failed_count,
            errors=errors[:10],  # 최대 10개 오류만 반환
            created_accounts=created_accounts
        )
        
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail={
                "message": "CSV 파일 처리 중 오류가 발생했습니다. 파일 형식을 확인하고 다시 시도해주세요.",
                "error_code": "CSV_PROCESSING_ERROR",
                "detail": str(e)  # 개발용 상세 정보
            }
        )


@router.get("/export/csv/")
def export_csv(
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """거래 내역 CSV 다운로드"""
    from fastapi.responses import StreamingResponse
    
    trades = crud.get_trades(db, account_id, ticker, start_date, end_date, limit=10000)
    
    output = io.StringIO()
    writer = csv.writer(output)
    
    # 헤더 - 계정 정보 추가
    writer.writerow(['account_id', 'account_name', 'ticker', 'side', 'shares', 'price_usd', 'trade_date', 'note'])
    
    # 데이터
    for trade in trades:
        writer.writerow([
            trade.account_id,
            trade.account.name if trade.account else '',
            trade.ticker,
            trade.side,
            trade.shares,
            trade.price_usd,
            trade.trade_date.isoformat(),
            trade.note or ''
        ])
    
    output.seek(0)
    
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=trades.csv"}
    )


@router.get("/statistics/", response_model=schemas.TradeStatistics)
def get_trade_statistics(
    account_id: Optional[int] = None,
    ticker: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db)
):
    """
    거래 통계 조회
    
    Returns:
        - 총 거래 수, 매수/매도 횟수
        - 평균 거래 금액
        - 총 실현 손익
        - 승률 (이익 매도 / 전체 매도)
        - 가장 많이 거래한 종목
    """
    # 필터링된 거래 조회
    trades = crud.get_trades(
        db, 
        account_id=account_id, 
        ticker=ticker, 
        start_date=start_date, 
        end_date=end_date, 
        limit=10000
    )
    
    if not trades:
        return schemas.TradeStatistics(
            total_trades=0,
            buy_trades=0,
            sell_trades=0,
            total_buy_amount_usd=0.0,
            total_sell_amount_usd=0.0,
            avg_buy_amount_usd=0.0,
            avg_sell_amount_usd=0.0,
            total_realized_pl_usd=0.0,
            avg_realized_pl_usd=0.0,
            win_rate=0.0,
            profitable_sells=0,
            loss_sells=0,
            unique_tickers=0,
            most_traded_ticker=None,
            most_traded_count=0,
            first_trade_date=None,
            last_trade_date=None
        )
    
    # 기본 통계
    buy_trades = [t for t in trades if t.side == 'BUY']
    sell_trades = [t for t in trades if t.side == 'SELL']
    
    total_buy_amount = sum(t.shares * t.price_usd for t in buy_trades)
    total_sell_amount = sum(t.shares * t.price_usd for t in sell_trades)
    
    avg_buy_amount = total_buy_amount / len(buy_trades) if buy_trades else 0.0
    avg_sell_amount = total_sell_amount / len(sell_trades) if sell_trades else 0.0
    
    # 날짜 범위
    sorted_trades = sorted(trades, key=lambda t: t.trade_date)
    first_trade_date = sorted_trades[0].trade_date if sorted_trades else None
    last_trade_date = sorted_trades[-1].trade_date if sorted_trades else None
    
    # 티커별 거래 횟수
    ticker_counts = Counter(t.ticker for t in trades)
    most_traded = ticker_counts.most_common(1)
    most_traded_ticker = most_traded[0][0] if most_traded else None
    most_traded_count = most_traded[0][1] if most_traded else 0
    
    # 실현 손익 계산 (FIFO 기반)
    # 계정별로 분리하여 계산
    accounts_to_process = set()
    if account_id:
        accounts_to_process.add(account_id)
    else:
        accounts_to_process = set(t.account_id for t in trades)
    
    total_realized_pl = 0.0
    profitable_sells = 0
    loss_sells = 0
    
    for acc_id in accounts_to_process:
        # 해당 계정의 모든 거래로 포지션 엔진 실행
        all_trades_for_account = crud.get_all_trades_for_calculation(db, acc_id)
        engine = PositionEngine()
        engine.process_trades(all_trades_for_account)
        
        # 필터링된 매도 거래만 처리
        filtered_sell_trades = [t for t in trades if t.side == 'SELL' and t.account_id == acc_id]
        
        for sell_trade in filtered_sell_trades:
            # 매도 시점까지의 실현 손익 조회
            position = engine.get_position(sell_trade.ticker)
            if position:
                realized = position.total_realized_pl
                if realized > 0:
                    profitable_sells += 1
                elif realized < 0:
                    loss_sells += 1
                total_realized_pl += realized
    
    avg_realized_pl = total_realized_pl / len(sell_trades) if sell_trades else 0.0
    win_rate = (profitable_sells / len(sell_trades) * 100) if sell_trades else 0.0
    
    return schemas.TradeStatistics(
        total_trades=len(trades),
        buy_trades=len(buy_trades),
        sell_trades=len(sell_trades),
        total_buy_amount_usd=total_buy_amount,
        total_sell_amount_usd=total_sell_amount,
        avg_buy_amount_usd=avg_buy_amount,
        avg_sell_amount_usd=avg_sell_amount,
        total_realized_pl_usd=total_realized_pl,
        avg_realized_pl_usd=avg_realized_pl,
        win_rate=win_rate,
        profitable_sells=profitable_sells,
        loss_sells=loss_sells,
        unique_tickers=len(ticker_counts),
        most_traded_ticker=most_traded_ticker,
        most_traded_count=most_traded_count,
        first_trade_date=first_trade_date,
        last_trade_date=last_trade_date
    )




