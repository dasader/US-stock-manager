import pytest
from app.services.dividend_tax import apply_withholding_tax, TAX_RATES


def test_us_rate():
    assert TAX_RATES["USD"] == 0.15


def test_krw_rate():
    assert TAX_RATES["KRW"] == 0.154


def test_apply_us():
    gross, tax, net = apply_withholding_tax(100.0, "USD")
    assert gross == 100.0
    assert tax == pytest.approx(15.0)
    assert net == pytest.approx(85.0)


def test_apply_krw():
    gross, tax, net = apply_withholding_tax(10000.0, "KRW")
    assert tax == pytest.approx(1540.0)
    assert net == pytest.approx(8460.0)


def test_unknown_currency_raises():
    with pytest.raises(ValueError):
        apply_withholding_tax(100.0, "EUR")
