"""crud.py 최적화 항목 유닛 테스트"""
from unittest.mock import MagicMock
from sqlalchemy.orm import Session
from datetime import date

from app.crud import get_existing_trade_hashes
from app import models


def _make_trade_row(account_id, ticker, side, shares, price_usd, trade_date):
    row = MagicMock()
    row.account_id = account_id
    row.ticker = ticker
    row.side = side
    row.shares = shares
    row.price_usd = price_usd
    row.trade_date = trade_date
    return row


def test_get_existing_trade_hashes_returns_set_of_strings():
    db = MagicMock(spec=Session)
    row = _make_trade_row(1, "AAPL", "BUY", 10.0, 150.0, date(2024, 1, 15))
    db.query.return_value.all.return_value = [row]

    result = get_existing_trade_hashes(db)

    assert isinstance(result, set)
    assert len(result) == 1
    assert "1_AAPL_BUY_10.0_150.0_2024-01-15" in result


def test_get_existing_trade_hashes_empty():
    db = MagicMock(spec=Session)
    db.query.return_value.all.return_value = []

    result = get_existing_trade_hashes(db)

    assert result == set()


def test_get_existing_trade_hashes_no_full_objects_loaded():
    """db.query()에 Trade 전체가 아닌 컬럼만 전달되는지 확인"""
    db = MagicMock(spec=Session)
    db.query.return_value.all.return_value = []

    get_existing_trade_hashes(db)

    call_args = db.query.call_args[0]
    assert not any(arg is models.Trade for arg in call_args), (
        "get_existing_trade_hashes should query specific columns, not the full Trade model"
    )
