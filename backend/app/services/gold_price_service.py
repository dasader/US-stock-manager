"""KRX 금현물 시세 (data.go.kr 금융위원회 일반상품시세정보)."""
from __future__ import annotations
import os
import logging
from datetime import datetime, timedelta
from typing import Optional
import xml.etree.ElementTree as ET
import requests

logger = logging.getLogger(__name__)

_API_URL = "https://apis.data.go.kr/1160100/service/GetGeneralProductInfoService/getGoldPriceInfo"
_GOLD_1KG_CODE = "04020000"


class GoldPriceService:
    """금 99.99_1kg(srtnCd=04020000) 종가 조회. 1일 1회 업데이트."""

    def __init__(self):
        self._cache: dict = {}  # {date_str: price}
        self._last_fetch: Optional[datetime] = None

    def _get_key(self) -> Optional[str]:
        return os.getenv("datagokr_API_KEY")

    def get_price(self) -> Optional[float]:
        """최근 영업일 종가 (원/g). 실패 시 None."""
        key = self._get_key()
        if not key:
            logger.warning("datagokr_API_KEY not set")
            return None

        # 최근 10일 범위로 조회 (주말/공휴일 대비)
        today = datetime.now().strftime("%Y%m%d")
        ten_days_ago = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")

        params = {
            "serviceKey": key,
            "pageNo": 1,
            "numOfRows": 30,
            "beginBasDt": ten_days_ago,
            "endBasDt": today,
        }

        try:
            resp = requests.get(_API_URL, params=params, timeout=10)
            if resp.status_code != 200:
                logger.warning(f"gold api status {resp.status_code}: {resp.text[:200]}")
                return None
            root = ET.fromstring(resp.text)

            result_code = root.findtext("header/resultCode", "")
            if result_code != "00":
                logger.warning(f"gold api resultCode={result_code}")
                return None

            # 04020000 종목의 가장 최근 basDt 항목 선택
            best_date = ""
            best_price: Optional[float] = None
            for item in root.iterfind("body/items/item"):
                if item.findtext("srtnCd") != _GOLD_1KG_CODE:
                    continue
                bas_dt = item.findtext("basDt", "")
                clpr = item.findtext("clpr", "")
                if not clpr:
                    continue
                if bas_dt > best_date:
                    best_date = bas_dt
                    best_price = float(clpr)

            if best_price is not None:
                self._cache[best_date] = best_price
                self._last_fetch = datetime.now()
                logger.info(f"[GOLD] {best_date}: KRW {best_price:,.0f}/g")
            return best_price
        except Exception as e:
            logger.warning(f"gold price fetch failed: {e}")
            return None


gold_price_service = GoldPriceService()
