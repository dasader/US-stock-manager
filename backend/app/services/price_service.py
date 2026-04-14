"""
주가 조회 서비스 (yfinance 사용)
"""
import yfinance as yf
from datetime import datetime
from typing import Optional, Dict
from .market_resolver import resolve_market
from .krx_service import krx_service


class PriceService:
    """주가 조회 서비스"""

    def __init__(self):
        self.cache: Dict[str, Dict] = {}
        self.cache_duration = 300  # 300초 (5분) 캐시
        self.validation_cache: Dict[str, Dict] = {}  # 티커 검증 캐시
        self.validation_cache_duration = 3600  # 1시간

    def get_price(self, ticker: str) -> Optional[Dict]:
        """
        티커의 현재가 조회 (yfinance 사용)
        Returns: {"ticker": str, "price_usd": float, "previous_close": float, "as_of": datetime, "cached": bool}
        """
        ticker = ticker.upper()

        # KRX 시장 분기
        if resolve_market(ticker) == "KRX":
            return self._get_price_krx(ticker)

        # 이하 기존 US/yfinance 로직
        if ticker in self.cache:
            cached_data = self.cache[ticker]
            cache_age = (datetime.now() - cached_data['timestamp']).seconds

            if cache_age < self.cache_duration and cached_data.get('previous_close') is not None:
                return {
                    "ticker": ticker,
                    "price_usd": cached_data['price'],
                    "previous_close": cached_data.get('previous_close'),
                    "as_of": cached_data['as_of'],
                    "cached": True
                }
            elif cache_age < self.cache_duration:
                print(f"[CACHE] {ticker}: 캐시 데이터는 있지만 previous_close가 없음. 새로 조회합니다.")

        try:
            ticker_obj = yf.Ticker(ticker)
            fast = ticker_obj.fast_info

            current_price = fast.last_price
            previous_close = fast.previous_close

            # fast_info 실패 시 history 폴백
            if current_price is None or current_price <= 0:
                print(f"[YFINANCE] {ticker}: fast_info 실패, history 폴백 시도")
                hist = ticker_obj.history(period='5d')
                if not hist.empty:
                    current_price = float(hist['Close'].iloc[-1])
                    previous_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else None

            if current_price is None or current_price <= 0:
                # 캐시가 있으면 오래된 것이라도 반환
                if ticker in self.cache:
                    cached_data = self.cache[ticker]
                    print(f"[CACHE] {ticker}: 조회 실패. 캐시된 이전 데이터 사용")
                    return {
                        "ticker": ticker,
                        "price_usd": cached_data['price'],
                        "previous_close": cached_data.get('previous_close'),
                        "as_of": cached_data['as_of'],
                        "cached": True
                    }
                return None

            result = {
                "ticker": ticker,
                "price_usd": float(current_price),
                "previous_close": float(previous_close) if previous_close is not None else None,
                "as_of": datetime.now(),
                "cached": False
            }

            # 캐시 저장
            self.cache[ticker] = {
                "price": result['price_usd'],
                "previous_close": result['previous_close'],
                "as_of": result['as_of'],
                "timestamp": datetime.now()
            }

            pc_str = f"${result['previous_close']:.2f}" if result['previous_close'] else "N/A"
            print(f"[YFINANCE] {ticker}: ${result['price_usd']:.2f} (Previous Close: {pc_str})")
            return result

        except Exception as e:
            print(f"[ERROR] {ticker}: {e}")

            # 캐시가 있으면 오래된 것이라도 반환
            if ticker in self.cache:
                cached_data = self.cache[ticker]
                print(f"[CACHE] {ticker}: 오류 발생. 캐시된 데이터 사용")
                return {
                    "ticker": ticker,
                    "price_usd": cached_data['price'],
                    "previous_close": cached_data.get('previous_close'),
                    "as_of": cached_data['as_of'],
                    "cached": True
                }

            return None

    def _get_price_krx(self, ticker: str) -> Optional[Dict]:
        """KRX 티커 가격 조회. price_usd 필드는 KRW 금액을 담음(계정 base_currency 기준)."""
        # 캐시 확인
        if ticker in self.cache:
            cached_data = self.cache[ticker]
            cache_age = (datetime.now() - cached_data['timestamp']).seconds
            if cache_age < self.cache_duration:
                return {
                    "ticker": ticker,
                    "price_usd": cached_data['price'],
                    "previous_close": cached_data.get('previous_close'),
                    "as_of": cached_data['as_of'],
                    "cached": True,
                }

        price = krx_service.get_price(ticker)
        if price is None or price <= 0:
            # 캐시된 값이 있으면 stale이라도 반환
            if ticker in self.cache:
                cached_data = self.cache[ticker]
                return {
                    "ticker": ticker,
                    "price_usd": cached_data['price'],
                    "previous_close": cached_data.get('previous_close'),
                    "as_of": cached_data['as_of'],
                    "cached": True,
                }
            return None

        now = datetime.now()
        result = {
            "ticker": ticker,
            "price_usd": float(price),
            "previous_close": None,
            "as_of": now,
            "cached": False,
        }
        self.cache[ticker] = {
            "price": result['price_usd'],
            "previous_close": None,
            "as_of": now,
            "timestamp": now,
        }
        print(f"[KRX] {ticker}: ₩{price:,.0f}")
        return result

    def get_multiple_prices(self, tickers: list) -> Dict[str, Optional[Dict]]:
        """여러 티커의 가격을 한번에 조회"""
        results = {}
        for ticker in tickers:
            results[ticker] = self.get_price(ticker)
        return results

    def validate_ticker(self, ticker: str) -> Dict:
        """
        티커 유효성 검증 (yfinance 사용)
        Returns: {"ticker": str, "valid": bool, "name": str, "exchange": str, "message": str}
        """
        ticker = ticker.upper()

        # 검증 캐시 확인
        if ticker in self.validation_cache:
            cached_data = self.validation_cache[ticker]
            if (datetime.now() - cached_data['timestamp']).seconds < self.validation_cache_duration:
                return cached_data['result']

        # KRX ticker: 6자리 숫자 또는 GOLD
        if resolve_market(ticker) == "KRX":
            name = krx_service.get_name(ticker)
            if name:
                result = {
                    "ticker": ticker,
                    "valid": True,
                    "name": name,
                    "exchange": "KRX",
                    "message": "유효한 KRX 티커입니다.",
                }
            else:
                result = {
                    "ticker": ticker,
                    "valid": False,
                    "name": None,
                    "exchange": None,
                    "message": "KRX 티커를 찾을 수 없습니다.",
                }
            self.validation_cache[ticker] = {"result": result, "timestamp": datetime.now()}
            return result

        # 간단한 티커 형식 검증 (1-5 알파벳)
        if not ticker or len(ticker) > 5 or not ticker.replace('.', '').isalpha():
            result = {
                "ticker": ticker,
                "valid": False,
                "name": None,
                "exchange": None,
                "message": "올바른 티커 형식이 아닙니다."
            }
            return result

        try:
            fast = yf.Ticker(ticker).fast_info
            current_price = fast.last_price

            if current_price is not None and current_price > 0:
                # 회사명 조회 시도
                name = ""
                try:
                    info = yf.Ticker(ticker).info
                    name = info.get('shortName') or info.get('longName') or ""
                except Exception:
                    pass

                result = {
                    "ticker": ticker,
                    "valid": True,
                    "name": name,
                    "exchange": "",
                    "message": "유효한 티커입니다."
                }
            else:
                result = {
                    "ticker": ticker,
                    "valid": False,
                    "name": None,
                    "exchange": None,
                    "message": "가격 정보를 찾을 수 없습니다."
                }

            # 검증 결과 캐시 저장
            self.validation_cache[ticker] = {
                "result": result,
                "timestamp": datetime.now()
            }

            return result

        except Exception as e:
            result = {
                "ticker": ticker,
                "valid": False,
                "name": None,
                "exchange": None,
                "message": f"티커 검증 실패: {str(e)}"
            }

            self.validation_cache[ticker] = {
                "result": result,
                "timestamp": datetime.now()
            }

            return result

    def clear_cache(self, ticker: Optional[str] = None):
        """캐시 초기화"""
        if ticker:
            ticker_upper = ticker.upper()
            self.cache.pop(ticker_upper, None)
            self.validation_cache.pop(ticker_upper, None)
        else:
            self.cache.clear()
            self.validation_cache.clear()


# 싱글톤 인스턴스
price_service = PriceService()
