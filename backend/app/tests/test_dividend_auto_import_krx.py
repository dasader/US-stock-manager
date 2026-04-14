"""
KRX 배당 자동 수집 라우팅 및 세율 적용 테스트.
"""
from datetime import date
from unittest.mock import patch, MagicMock, call

import pytest


# ---------------------------------------------------------------------------
# 1. 라우팅 dispatch 테스트: KRW 계정 + KRX 티커 → _auto_import_krx 호출
# ---------------------------------------------------------------------------

@patch("app.api.dividends._auto_import_krx")
@patch("app.api.dividends.crud")
def test_auto_import_dispatches_krx_for_krw_account(mock_crud, mock_auto_krx):
    """KRW 계정 + KRX 티커일 때 _auto_import_krx 에 위임되어야 한다."""
    from app.api.dividends import auto_import_dividends
    from app import schemas

    account = MagicMock()
    account.base_currency = "KRW"
    mock_crud.get_account.return_value = account
    mock_auto_krx.return_value = {"imported_count": 1, "skipped_count": 0,
                                   "no_shares_count": 0, "failed_count": 0}

    db = MagicMock()
    request = schemas.DividendAutoImportRequest(
        account_id=1, ticker="005930",
        start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
    )

    result = auto_import_dividends(request, db)

    mock_auto_krx.assert_called_once_with(db, request, account)
    assert result["imported_count"] == 1


# ---------------------------------------------------------------------------
# 2. 라우팅 dispatch 테스트: USD 계정 + KRX 티커 → 400 에러
# ---------------------------------------------------------------------------

@patch("app.api.dividends.crud")
def test_auto_import_raises_on_currency_mismatch(mock_crud):
    """USD 계정에 KRX 티커 사용 시 400 에러가 발생해야 한다."""
    from app.api.dividends import auto_import_dividends
    from app import schemas
    from fastapi import HTTPException

    account = MagicMock()
    account.base_currency = "USD"
    mock_crud.get_account.return_value = account

    db = MagicMock()
    request = schemas.DividendAutoImportRequest(
        account_id=1, ticker="005930",
        start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
    )

    with pytest.raises(HTTPException) as exc_info:
        auto_import_dividends(request, db)

    assert exc_info.value.status_code == 400
    assert "mismatch" in exc_info.value.detail


# ---------------------------------------------------------------------------
# 3. KRW 세율(15.4%) 적용 검증: _auto_import_krx 가 apply_withholding_tax("KRW") 호출
# ---------------------------------------------------------------------------

@patch("app.api.dividends.apply_withholding_tax")
@patch("app.api.dividends.krx_service")
@patch("app.api.dividends.crud")
def test_auto_import_krx_calls_krw_tax(mock_crud, mock_krx, mock_tax):
    """_auto_import_krx 는 apply_withholding_tax(..., 'KRW') 를 호출해야 한다."""
    from app.api.dividends import _auto_import_krx
    from app import schemas

    # pykrx DPS 반환
    mock_krx.get_dividend_per_share.return_value = 1000.0

    # 거래 목록 (PositionEngine이 요구하는 모든 필드 포함)
    mock_crud.get_all_trades_for_calculation.return_value = [
        {
            "id": 1,
            "trade_date": date(2025, 6, 1),
            "ticker": "005930",
            "side": "BUY",
            "shares": 10.0,
            "price_usd": 70000.0,
            "fee_usd": 0.0,
            "account_id": 1,
        }
    ]
    mock_crud.check_dividend_exists.return_value = False

    # apply_withholding_tax 가 호출될 때 실제 계산값을 반환하도록 설정
    mock_tax.return_value = (10000.0, 1540.0, 8460.0)

    db = MagicMock()
    request = schemas.DividendAutoImportRequest(
        account_id=1, ticker="005930",
        start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
    )
    account = MagicMock(base_currency="KRW", id=1)

    result = _auto_import_krx(db, request, account)

    # apply_withholding_tax 가 "KRW" 통화로 호출되었는지 확인
    mock_tax.assert_called_once_with(10000.0, "KRW")  # 1000 DPS x 10주
    assert result["imported_count"] >= 1


# ---------------------------------------------------------------------------
# 4. DPS 없을 때 failed_count 증가
# ---------------------------------------------------------------------------

@patch("app.api.dividends.krx_service")
@patch("app.api.dividends.crud")
def test_auto_import_krx_no_dps_increments_failed(mock_crud, mock_krx):
    """DPS 조회 실패(None) 시 failed_count 가 증가해야 한다."""
    from app.api.dividends import _auto_import_krx
    from app import schemas

    mock_krx.get_dividend_per_share.return_value = None
    mock_crud.get_all_trades_for_calculation.return_value = []

    db = MagicMock()
    request = schemas.DividendAutoImportRequest(
        account_id=1, ticker="005930",
        start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
    )
    account = MagicMock(base_currency="KRW", id=1)

    result = _auto_import_krx(db, request, account)

    assert result["failed_count"] >= 1
    assert result["imported_count"] == 0
