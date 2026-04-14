"""
background_price_service 시장별 갱신 스케줄 테스트.
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

from app.services.background_price_service import background_price_service  # noqa: E402


@patch("app.services.background_price_service.is_krx_open", return_value=True)
@patch("app.services.background_price_service.is_us_open", return_value=False)
def test_interval_krx_open_us_closed(mock_us, mock_krx):
    assert background_price_service._interval_for("005930") == 120
    assert background_price_service._interval_for("AAPL") == 3600


@patch("app.services.background_price_service.is_krx_open", return_value=False)
@patch("app.services.background_price_service.is_us_open", return_value=True)
def test_interval_us_open_krx_closed(mock_us, mock_krx):
    assert background_price_service._interval_for("005930") == 3600
    assert background_price_service._interval_for("AAPL") == 120


def test_should_update_first_time():
    # 최초 조회는 항상 업데이트 필요
    background_price_service._last_ticker_update.pop("TEST_NEW", None)
    assert background_price_service._should_update("TEST_NEW") is True


def test_should_update_recent_blocked():
    import time
    background_price_service._last_ticker_update["TEST_RECENT"] = time.time()
    # 바로 직전에 업데이트했으므로 재갱신 불필요
    assert background_price_service._should_update("TEST_RECENT") is False
