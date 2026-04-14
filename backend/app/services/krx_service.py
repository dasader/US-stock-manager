from __future__ import annotations
import asyncio
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional
import logging

from pykrx import stock
from .market_resolver import to_krx_code

logger = logging.getLogger(__name__)


class KRXService:
    """pykrx 래퍼. sync API를 스레드풀에서 실행하여 async 컨텍스트 대응."""

    def get_name(self, ticker: str) -> Optional[str]:
        code = to_krx_code(ticker)
        try:
            return stock.get_market_ticker_name(code)
        except Exception as e:
            logger.warning(f"krx get_name failed for {ticker}: {e}")
            return None

    def get_price(self, ticker: str) -> Optional[float]:
        code = to_krx_code(ticker)
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
