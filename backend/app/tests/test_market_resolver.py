import pytest
from app.services.market_resolver import resolve_market, to_krx_code, validate_ticker_against_account


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


def test_to_krx_code_gold():
    assert to_krx_code("GOLD") == "04020000"


def test_to_krx_code_six_digit():
    assert to_krx_code("005930") == "005930"


def test_validate_unknown_currency_raises():
    with pytest.raises(ValueError, match="unsupported account currency"):
        validate_ticker_against_account("AAPL", "EUR")


def test_validate_case_insensitive_currency():
    validate_ticker_against_account("AAPL", "usd")
