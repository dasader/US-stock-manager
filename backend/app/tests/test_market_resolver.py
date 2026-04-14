import pytest
from app.services.market_resolver import resolve_market, validate_ticker_against_account


def test_krx_six_digit_ticker():
    assert resolve_market("005930") == "KRX"


def test_gold_ticker():
    assert resolve_market("GOLD") == "KRX"


def test_us_ticker():
    assert resolve_market("AAPL") == "US"


def test_us_ticker_with_dot():
    assert resolve_market("BRK.B") == "US"


def test_validate_ok():
    validate_ticker_against_account("005930", "KRW")
    validate_ticker_against_account("AAPL", "USD")


def test_validate_mismatch_raises():
    with pytest.raises(ValueError, match="market mismatch"):
        validate_ticker_against_account("005930", "USD")
    with pytest.raises(ValueError, match="market mismatch"):
        validate_ticker_against_account("AAPL", "KRW")
