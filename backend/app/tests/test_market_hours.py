from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
from app.services.market_hours import is_krx_open, is_us_open


def _kst(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=ZoneInfo("Asia/Seoul"))


def _et(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=ZoneInfo("America/New_York"))


@patch("app.services.market_hours._now_utc")
def test_krx_open_weekday_morning(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 10, 0).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is True


@patch("app.services.market_hours._now_utc")
def test_krx_closed_before_open(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 8, 59).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_krx_closed_after_close(mock_now):
    mock_now.return_value = _kst(2026, 4, 14, 15, 31).astimezone(ZoneInfo("UTC"))
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_krx_closed_weekend(mock_now):
    mock_now.return_value = _kst(2026, 4, 11, 10, 0).astimezone(ZoneInfo("UTC"))  # Saturday
    assert is_krx_open() is False


@patch("app.services.market_hours._now_utc")
def test_us_open_weekday(mock_now):
    mock_now.return_value = _et(2026, 4, 14, 10, 0).astimezone(ZoneInfo("UTC"))
    assert is_us_open() is True


@patch("app.services.market_hours._now_utc")
def test_us_closed_weekend(mock_now):
    mock_now.return_value = _et(2026, 4, 11, 10, 0).astimezone(ZoneInfo("UTC"))  # Saturday
    assert is_us_open() is False
