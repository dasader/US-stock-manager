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


from app.services.scheduler_service import _group_trades_by_account


def test_group_trades_by_account_empty():
    assert _group_trades_by_account([]) == {}


def test_group_trades_by_account_single():
    trades = [{"account_id": 1, "ticker": "AAPL", "shares": 10}]
    result = _group_trades_by_account(trades)
    assert result == {1: [{"account_id": 1, "ticker": "AAPL", "shares": 10}]}


def test_group_trades_by_account_multiple_accounts():
    trades = [
        {"account_id": 1, "ticker": "AAPL", "shares": 10},
        {"account_id": 2, "ticker": "MSFT", "shares": 5},
        {"account_id": 1, "ticker": "GOOG", "shares": 3},
    ]
    result = _group_trades_by_account(trades)
    assert len(result[1]) == 2
    assert len(result[2]) == 1


from unittest.mock import patch as mock_patch
from app.services.price_service import PriceService


def _make_price_service():
    svc = PriceService.__new__(PriceService)
    svc.cache = {}
    svc.cache_duration = 300
    svc.validation_cache = {}
    svc.validation_cache_duration = 3600
    return svc


def test_get_multiple_prices_returns_all_tickers():
    svc = _make_price_service()
    with mock_patch.object(svc, "get_price", side_effect=lambda t: {"price_usd": 100.0, "ticker": t}):
        result = svc.get_multiple_prices(["AAPL", "MSFT", "GOOG"])
    assert set(result.keys()) == {"AAPL", "MSFT", "GOOG"}
    assert result["AAPL"] is not None
    assert result["AAPL"]["price_usd"] == 100.0


def test_get_multiple_prices_empty():
    svc = _make_price_service()
    result = svc.get_multiple_prices([])
    assert result == {}


def test_get_multiple_prices_handles_individual_failure():
    svc = _make_price_service()

    def side_effect(ticker):
        if ticker == "FAIL":
            raise RuntimeError("network error")
        return {"price_usd": 50.0}

    with mock_patch.object(svc, "get_price", side_effect=side_effect):
        result = svc.get_multiple_prices(["AAPL", "FAIL"])

    assert result["AAPL"] == {"price_usd": 50.0}
    assert result["FAIL"] is None
