"""
price_service KRX 시장 분기 테스트.
yfinance가 로컬 환경에 없을 수 있으므로 sys.modules로 모킹.
"""
import sys
import types
from unittest.mock import patch, MagicMock

# yfinance stub — 모듈 수준 import 오류 방지
if "yfinance" not in sys.modules:
    yf_stub = types.ModuleType("yfinance")
    yf_stub.Ticker = MagicMock()
    sys.modules["yfinance"] = yf_stub

from app.services.price_service import price_service  # noqa: E402


@patch("app.services.price_service.krx_service")
def test_get_price_krx_ticker_routes_to_krx(mock_krx):
    mock_krx.get_price.return_value = 75000.0
    price_service.cache.pop("005930", None)
    result = price_service.get_price("005930")
    assert result is not None
    assert result["ticker"] == "005930"
    assert result["price_usd"] == 75000.0
    mock_krx.get_price.assert_called_once_with("005930")


@patch("app.services.price_service.krx_service")
def test_get_price_krx_returns_none_when_empty(mock_krx):
    mock_krx.get_price.return_value = None
    price_service.cache.pop("999999", None)
    assert price_service.get_price("999999") is None


@patch("app.services.price_service.krx_service")
def test_validate_ticker_krx(mock_krx):
    mock_krx.get_name.return_value = "삼성전자"
    price_service.validation_cache.pop("005930", None)
    result = price_service.validate_ticker("005930")
    assert result["valid"] is True
    assert result["name"] == "삼성전자"
    assert result["exchange"] == "KRX"
