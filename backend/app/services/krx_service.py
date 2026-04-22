from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional
import logging

from pykrx import stock
from .market_resolver import to_krx_code
from .gold_price_service import gold_price_service

logger = logging.getLogger(__name__)


class KRXService:
    """pykrx 래퍼. sync API를 스레드풀에서 실행하여 async 컨텍스트 대응."""

    def get_name(self, ticker: str) -> Optional[str]:
        code = to_krx_code(ticker)
        if code == "04020000":
            return "금 현물 (1Kg)"

        name = self._name_from_pykrx(code) or self._name_from_etf(code) or self._name_from_yfinance(code)
        return name

    def _name_from_pykrx(self, code: str) -> Optional[str]:
        try:
            import pandas as pd
            name = stock.get_market_ticker_name(code)
            if isinstance(name, str):
                return name or None
            if isinstance(name, pd.Series):
                return str(name.iloc[0]) if not name.empty else None
            if isinstance(name, pd.DataFrame):
                return str(name.iloc[0, 0]) if not name.empty else None
        except Exception as e:
            logger.debug(f"pykrx market name failed for {code}: {e}")
        return None

    def _name_from_etf(self, code: str) -> Optional[str]:
        # get_etf_ticker_list / get_etf_ticker_name 은 KRX API 응답 형식 변경으로
        # JSONDecodeError 가 발생하므로, 상장종목검색 엔드포인트를 직접 사용한다.
        try:
            from pykrx.website.krx.etx.core import 상장종목검색
            df = 상장종목검색().fetch(market="ALL", name=code)
            if df is None or df.empty:
                return None
            hit = df[df["short_code"] == code]
            if hit.empty:
                return None
            return str(hit.iloc[0]["codeName"]) or None
        except Exception as e:
            logger.debug(f"pykrx ETF name failed for {code}: {e}")
        return None

    def _name_from_yfinance(self, code: str) -> Optional[str]:
        try:
            import yfinance as yf
            info = yf.Ticker(f"{code}.KS").fast_info
            name = getattr(info, 'shortName', None) or getattr(info, 'longName', None)
            return name if isinstance(name, str) and name else None
        except Exception as e:
            logger.debug(f"yfinance KS name failed for {code}: {e}")
        return None

    def get_price(self, ticker: str) -> Optional[float]:
        code = to_krx_code(ticker)
        # 금현물은 data.go.kr 전용 서비스 사용 (pykrx 미지원)
        if code == "04020000":
            return gold_price_service.get_price()
        today = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=7)).strftime("%Y%m%d")
        try:
            df = stock.get_market_ohlcv_by_date(start, today, code)
            if df is None or df.empty:
                return None
            return float(df["종가"].iloc[-1])
        except Exception as e:
            logger.warning(f"krx get_price failed for {ticker}: {e}")
            return None

    @lru_cache(maxsize=256)
    def get_sector(self, ticker: str) -> Optional[str]:
        """KOSPI/KOSDAQ 업종 분류. 캐시됨."""
        code = to_krx_code(ticker)
        try:
            today = datetime.now().strftime("%Y%m%d")
            df = stock.get_market_sector_classifications(today, "KOSPI")
            if code in df.index:
                return str(df.loc[code, "업종명"])
            df = stock.get_market_sector_classifications(today, "KOSDAQ")
            if code in df.index:
                return str(df.loc[code, "업종명"])
            return None
        except Exception as e:
            logger.warning(f"krx get_sector failed for {ticker}: {e}")
            return None

    def get_dividend_per_share(self, ticker: str, year: int) -> Optional[float]:
        """연간 DPS(주당 배당금). pykrx fundamental에서 조회."""
        code = to_krx_code(ticker)
        start = f"{year}0101"
        end = f"{year}1231"
        try:
            df = stock.get_market_fundamental_by_date(start, end, code)
            if df is None or df.empty or "DPS" not in df.columns:
                return None
            dps = float(df["DPS"].iloc[-1])
            return dps if dps > 0 else None
        except Exception as e:
            logger.warning(f"krx get_dividend failed for {ticker}/{year}: {e}")
            return None

    async def get_price_async(self, ticker: str) -> Optional[float]:
        return await asyncio.to_thread(self.get_price, ticker)

    async def get_name_async(self, ticker: str) -> Optional[str]:
        return await asyncio.to_thread(self.get_name, ticker)


krx_service = KRXService()
