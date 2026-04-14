from unittest.mock import patch
import pandas as pd
from app.services.krx_service import krx_service


@patch("app.services.krx_service.stock.get_market_ticker_name")
def test_get_name(mock_name):
    mock_name.return_value = "삼성전자"
    assert krx_service.get_name("005930") == "삼성전자"
    mock_name.assert_called_once_with("005930")


@patch("app.services.krx_service.stock.get_market_ticker_name")
def test_get_name_gold(mock_name):
    # 금현물은 pykrx 미사용, 고정 명칭 반환
    name = krx_service.get_name("GOLD")
    assert name == "금 현물 (1Kg)"
    mock_name.assert_not_called()


@patch("app.services.krx_service.stock.get_market_ohlcv_by_date")
def test_get_price(mock_ohlcv):
    df = pd.DataFrame({"종가": [75000.0]}, index=pd.to_datetime(["2026-04-14"]))
    mock_ohlcv.return_value = df
    price = krx_service.get_price("005930")
    assert price == 75000.0


@patch("app.services.krx_service.stock.get_market_ohlcv_by_date")
def test_get_price_empty_returns_none(mock_ohlcv):
    mock_ohlcv.return_value = pd.DataFrame()
    assert krx_service.get_price("005930") is None


@patch("app.services.krx_service.stock.get_market_fundamental_by_date")
def test_get_dividend_per_share(mock_fund):
    df = pd.DataFrame({"DPS": [1444.0]}, index=pd.to_datetime(["2026-04-14"]))
    mock_fund.return_value = df
    assert krx_service.get_dividend_per_share("005930", 2025) == 1444.0


@patch("app.services.krx_service.stock.get_market_fundamental_by_date")
def test_get_dividend_per_share_zero(mock_fund):
    mock_fund.return_value = pd.DataFrame()
    assert krx_service.get_dividend_per_share("005930", 2025) is None
