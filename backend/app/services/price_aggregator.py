"""
가격 집계 공통 서비스
"""
from typing import List, Dict, Tuple
from ..services.background_price_service import background_price_service
from ..services.price_service import price_service


class PriceAggregator:
    """가격 데이터를 효율적으로 집계하는 서비스"""
    
    @staticmethod
    def get_prices_for_positions(positions: List[Dict]) -> Dict[str, Dict]:
        """
        포지션 목록에 대한 가격 데이터를 배치로 조회
        
        Args:
            positions: 포지션 목록
            
        Returns:
            ticker별 가격 데이터 딕셔너리
        """
        if not positions:
            return {}
        
        # 모든 티커를 한번에 조회
        tickers = [p['ticker'] for p in positions if p['shares'] > 0]
        if not tickers:
            return {}
        
        # 백그라운드 캐시에서 먼저 확인
        cached_prices = background_price_service.get_all_cached_prices()
        
        # 캐시에 없는 티커들만 API로 조회
        missing_tickers = [t for t in tickers if t not in cached_prices]
        if missing_tickers:
            print(f"[PriceAggregator] Fetching prices for {len(missing_tickers)} missing tickers")
            missing_prices = price_service.get_multiple_prices(missing_tickers)
            # 캐시에 추가
            for ticker, price_data in missing_prices.items():
                if price_data:
                    cached_prices[ticker] = price_data
        
        return cached_prices
    
    @staticmethod
    def calculate_position_metrics(positions: List[Dict], price_data: Dict[str, Dict]) -> Tuple[float, float, float]:
        """
        포지션 목록에 대한 메트릭 계산

        Args:
            positions: 포지션 목록
            price_data: 티커별 가격 데이터

        Returns:
            (총_평가금액, 총_미실현손익, 총_투자금)
        """
        total_market_value_usd = 0.0
        total_unrealized_pl_usd = 0.0
        total_cost_usd = 0.0

        for position in positions:
            ticker = position['ticker']
            total_cost_usd += position['total_cost_usd']

            if position['shares'] <= 0:
                continue

            price_info = price_data.get(ticker)
            if price_info and 'price_usd' in price_info and price_info['price_usd'] is not None:
                market_value = position['shares'] * price_info['price_usd']
                total_market_value_usd += market_value
                unrealized_pl = market_value - position['total_cost_usd']
                total_unrealized_pl_usd += unrealized_pl

        return total_market_value_usd, total_unrealized_pl_usd, total_cost_usd

    @staticmethod
    def calculate_position_metrics_multicurrency(
        positions: List[Dict],
        price_data: Dict[str, Dict],
        accounts_map: Dict,
        fx_rate: float,
        target_currency: str,
    ) -> Dict:
        """
        통화 인식 포지션 메트릭 계산.

        각 포지션의 account_id → accounts_map → base_currency를 확인하여
        native 금액을 target_currency로 환산한 뒤 합산한다.

        Args:
            positions: 포지션 목록 (account_id 필드 포함)
            price_data: 티커별 가격 데이터
            accounts_map: account_id → Account (base_currency 속성 보유)
            fx_rate: USD/KRW 환율 (1 USD = fx_rate KRW)
            target_currency: 목표 통화 ("USD" 또는 "KRW")

        Returns:
            {
                "total_market_value": float,
                "total_unrealized_pl": float,
                "total_cost": float,
                "native_usd_market_value": float,
                "native_krw_market_value": float,
                "native_usd_unrealized_pl": float,
                "native_krw_unrealized_pl": float,
            }
        """
        total_market_value = 0.0
        total_unrealized_pl = 0.0
        total_cost = 0.0
        native_usd_market_value = 0.0
        native_krw_market_value = 0.0
        native_usd_unrealized_pl = 0.0
        native_krw_unrealized_pl = 0.0

        for position in positions:
            account_id = position.get("account_id")
            account = accounts_map.get(account_id) if account_id is not None else None
            base_currency = getattr(account, "base_currency", "USD") if account else "USD"

            ticker = position["ticker"]
            shares = position.get("shares", 0)

            price_info = price_data.get(ticker)
            if price_info and price_info.get("price_usd") is not None and shares > 0:
                native_market_value = shares * price_info["price_usd"]
                native_cost = position.get("total_cost_usd", 0.0)
                native_unrealized_pl = native_market_value - native_cost
            else:
                native_market_value = 0.0
                native_cost = position.get("total_cost_usd", 0.0)
                native_unrealized_pl = 0.0

            if base_currency == "KRW":
                native_krw_market_value += native_market_value
                native_krw_unrealized_pl += native_unrealized_pl
            else:
                native_usd_market_value += native_market_value
                native_usd_unrealized_pl += native_unrealized_pl

            if base_currency == target_currency:
                converted_market_value = native_market_value
                converted_unrealized_pl = native_unrealized_pl
                converted_cost = native_cost
            elif base_currency == "USD" and target_currency == "KRW":
                converted_market_value = native_market_value * fx_rate
                converted_unrealized_pl = native_unrealized_pl * fx_rate
                converted_cost = native_cost * fx_rate
            elif base_currency == "KRW" and target_currency == "USD":
                converted_market_value = native_market_value / fx_rate if fx_rate else 0.0
                converted_unrealized_pl = native_unrealized_pl / fx_rate if fx_rate else 0.0
                converted_cost = native_cost / fx_rate if fx_rate else 0.0
            else:
                converted_market_value = native_market_value
                converted_unrealized_pl = native_unrealized_pl
                converted_cost = native_cost

            total_market_value += converted_market_value
            total_unrealized_pl += converted_unrealized_pl
            total_cost += converted_cost

        return {
            "total_market_value": total_market_value,
            "total_unrealized_pl": total_unrealized_pl,
            "total_cost": total_cost,
            "native_usd_market_value": native_usd_market_value,
            "native_krw_market_value": native_krw_market_value,
            "native_usd_unrealized_pl": native_usd_unrealized_pl,
            "native_krw_unrealized_pl": native_krw_unrealized_pl,
        }
    
    @staticmethod
    def apply_prices_to_positions(positions: List[Dict], price_data: Dict[str, Dict]) -> List[Dict]:
        """
        포지션 목록에 가격 정보를 적용
        
        Args:
            positions: 포지션 목록
            price_data: 티커별 가격 데이터
            
        Returns:
            가격 정보가 적용된 포지션 목록
        """
        for position in positions:
            ticker = position['ticker']
            price_info = price_data.get(ticker)
            
            if price_info and 'price_usd' in price_info and price_info['price_usd'] is not None:
                position['market_price_usd'] = price_info['price_usd']
                position['market_value_usd'] = position['shares'] * price_info['price_usd']
                
                # 미실현 손익 재계산
                if position['total_cost_usd'] > 0:
                    position['unrealized_pl_usd'] = position['market_value_usd'] - position['total_cost_usd']
                    position['unrealized_pl_percent'] = (position['unrealized_pl_usd'] / position['total_cost_usd']) * 100
                
                position['last_updated'] = price_info.get('as_of')
                
                # 전일 종가 추가 (Quote API에서 제공)
                if 'previous_close' in price_info and price_info['previous_close'] is not None:
                    position['previous_close_price'] = price_info['previous_close']
            else:
                # 명시적으로 None 설정
                position['market_price_usd'] = None
                position['market_value_usd'] = None
                position['unrealized_pl_usd'] = None
                position['unrealized_pl_percent'] = None
                position['previous_close_price'] = None
        
        return positions


# 싱글톤 인스턴스
price_aggregator = PriceAggregator()










