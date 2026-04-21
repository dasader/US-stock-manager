"""
현금 관련 API 엔드포인트
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date

from .. import crud, schemas
from ..database import get_db
from ..services.fx_service import fx_service

router = APIRouter(prefix="/api/cash", tags=["cash"])


@router.post("/", response_model=schemas.CashResponse)
def create_cash(cash: schemas.CashCreate, db: Session = Depends(get_db)):
    """현금 거래 생성 (입금/출금)"""
    # 계정 존재 확인
    account = crud.get_account(db, cash.account_id)
    if not account:
        raise HTTPException(status_code=404, detail=f"계정 ID {cash.account_id}를 찾을 수 없습니다.")
    
    return crud.create_cash(db, cash)


@router.get("/", response_model=List[schemas.CashResponse])
def get_cash_list(
    account_id: Optional[int] = None,
    transaction_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """현금 거래 목록 조회"""
    return crud.get_cash_list(db, account_id, transaction_type, start_date, end_date, skip, limit)


@router.get("/balance/", response_model=schemas.CashSummary)
async def get_cash_summary(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    """현금 잔액 및 요약 조회"""
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0

    balance = crud.get_cash_balance(db, account_id, fx_rate_krw=fx_rate)
    balance_krw = balance * fx_rate

    # 입금/출금 총액 계산 — KRW 계정 거래는 USD 환산
    accounts_map = {a.id: a for a in crud.get_accounts(db)}

    def _to_usd(t) -> float:
        acc = accounts_map.get(t.account_id)
        if acc and getattr(acc, 'base_currency', 'USD') == 'KRW' and fx_rate > 0:
            return t.amount_usd / fx_rate
        return t.amount_usd

    deposits = crud.get_cash_list(db, account_id, transaction_type="DEPOSIT", limit=10000)
    withdrawals = crud.get_cash_list(db, account_id, transaction_type="WITHDRAW", limit=10000)
    total_deposits = sum(_to_usd(t) for t in deposits)
    total_withdrawals = sum(_to_usd(t) for t in withdrawals)

    return schemas.CashSummary(
        total_cash_usd=balance,
        total_cash_krw=balance_krw,
        total_deposits_usd=total_deposits,
        total_withdrawals_usd=total_withdrawals
    )


@router.get("/{cash_id}", response_model=schemas.CashResponse, include_in_schema=True)
@router.get("/{cash_id}/", response_model=schemas.CashResponse, include_in_schema=False)
def get_cash(cash_id: int, db: Session = Depends(get_db)):
    """현금 거래 조회"""
    cash = crud.get_cash(db, cash_id)
    if not cash:
        raise HTTPException(status_code=404, detail="현금 거래를 찾을 수 없습니다.")
    return cash


@router.put("/{cash_id}", response_model=schemas.CashResponse, include_in_schema=True)
@router.put("/{cash_id}/", response_model=schemas.CashResponse, include_in_schema=False)
def update_cash(cash_id: int, cash_update: schemas.CashUpdate, db: Session = Depends(get_db)):
    """현금 거래 수정"""
    cash = crud.update_cash(db, cash_id, cash_update)
    if not cash:
        raise HTTPException(status_code=404, detail="현금 거래를 찾을 수 없습니다.")
    return cash


@router.delete("/{cash_id}", include_in_schema=True)
@router.delete("/{cash_id}/", include_in_schema=False)
def delete_cash(cash_id: int, db: Session = Depends(get_db)):
    """현금 거래 삭제"""
    success = crud.delete_cash(db, cash_id)
    if not success:
        raise HTTPException(status_code=404, detail="현금 거래를 찾을 수 없습니다.")
    return {"message": "현금 거래가 삭제되었습니다."}


