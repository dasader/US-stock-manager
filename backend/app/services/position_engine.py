"""
FIFO 포지션 엔진
매수/매도 거래를 FIFO 방식으로 매칭하여 실현/미실현 손익을 계산합니다.
"""
from typing import List, Dict, Tuple, Optional
from collections import deque
from datetime import date, datetime


class Lot:
    """매수 로트"""
    def __init__(self, shares: float, price_usd: float, trade_date: date, trade_id: int):
        self.shares = shares
        self.price_usd = price_usd
        self.trade_date = trade_date
        self.trade_id = trade_id
        self.remaining_shares = shares

    def __repr__(self):
        return f"Lot({self.shares}@${self.price_usd}, remaining={self.remaining_shares})"


class Position:
    """단일 종목의 포지션"""
    def __init__(self, ticker: str, account_id: Optional[int] = None):
        self.ticker = ticker
        self.account_id = account_id
        self.lots: deque[Lot] = deque()
        self.total_shares = 0.0
        self.total_cost = 0.0
        self.realized_pl = 0.0
        self.realized_history = []
        self.first_buy_date: Optional[date] = None  # 최초 매수일

    def add_buy(
        self,
        shares: float,
        price_usd: float,
        trade_date: date,
        trade_id: int,
        trade_fee_usd: float = 0.0
    ):
        """매수 추가"""
        # 최초 매수일 기록
        if self.first_buy_date is None:
            self.first_buy_date = trade_date

        # 수수료를 주당 단가에 반영 (있을 경우)
        fee_per_share = (trade_fee_usd / shares) if trade_fee_usd else 0.0
        effective_price = price_usd + fee_per_share

        lot = Lot(shares, effective_price, trade_date, trade_id)
        self.lots.append(lot)
        self.total_shares += shares
        self.total_cost += shares * effective_price

    def process_sell(
        self,
        shares: float,
        price_usd: float,
        trade_date: date,
        trade_id: int,
        trade_fee_usd: float = 0.0
    ) -> Dict:
        """
        매도 처리 (FIFO)
        Returns: 실현 손익 정보
        """
        if self.total_shares < shares:
            raise ValueError(f"매도 수량({shares})이 보유 수량({self.total_shares})을 초과합니다.")

        remaining_to_sell = shares
        matched_lots = []
        total_cost_basis = 0.0
        total_pl = 0.0

        while remaining_to_sell > 0 and len(self.lots) > 0:
            lot = self.lots[0]
            
            if lot.remaining_shares <= remaining_to_sell:
                # 전체 로트 소진
                sell_shares = lot.remaining_shares
                cost_basis = sell_shares * lot.price_usd
                proceeds = sell_shares * price_usd
                
                pl = proceeds - cost_basis
                
                matched_lots.append({
                    "buy_trade_id": lot.trade_id,
                    "buy_price": lot.price_usd,
                    "buy_date": lot.trade_date.isoformat(),
                    "shares": sell_shares,
                    "cost_basis": cost_basis,
                    "proceeds": proceeds,
                    "pl": pl
                })
                
                total_cost_basis += cost_basis
                total_pl += pl
                remaining_to_sell -= sell_shares
                self.total_shares -= sell_shares
                self.total_cost -= cost_basis
                
                self.lots.popleft()
            else:
                # 부분 소진
                sell_shares = remaining_to_sell
                cost_basis = sell_shares * lot.price_usd
                proceeds = sell_shares * price_usd
                
                pl = proceeds - cost_basis
                
                matched_lots.append({
                    "buy_trade_id": lot.trade_id,
                    "buy_price": lot.price_usd,
                    "buy_date": lot.trade_date.isoformat(),
                    "shares": sell_shares,
                    "cost_basis": cost_basis,
                    "proceeds": proceeds,
                    "pl": pl
                })
                
                total_cost_basis += cost_basis
                total_pl += pl
                lot.remaining_shares -= sell_shares
                self.total_shares -= sell_shares
                self.total_cost -= cost_basis
                remaining_to_sell = 0

        # 매도 수수료 차감
        if trade_fee_usd:
            total_pl -= trade_fee_usd

        self.realized_pl += total_pl

        realized_info = {
            "ticker": self.ticker,
            "trade_id_sell_ref": trade_id,
            "shares": shares,
            "pl_usd": total_pl,
            "pl_per_share_usd": total_pl / shares if shares > 0 else 0,
            "matched_lots": matched_lots,
            "sell_price": price_usd,
            "sell_date": trade_date.isoformat(),
            "total_cost_basis": total_cost_basis,
            "trade_fee_usd": trade_fee_usd
        }

        self.realized_history.append(realized_info)
        return realized_info

    def get_avg_cost(self) -> float:
        """평균 매수 단가"""
        if self.total_shares == 0:
            return 0.0
        return self.total_cost / self.total_shares

    def get_unrealized_pl(self, current_price: float) -> Tuple[float, float]:
        """
        미실현 손익
        Returns: (unrealized_pl_usd, unrealized_pl_percent)
        """
        if self.total_shares == 0:
            return 0.0, 0.0

        market_value = self.total_shares * current_price
        unrealized_pl = market_value - self.total_cost
        unrealized_pl_percent = (unrealized_pl / self.total_cost * 100) if self.total_cost > 0 else 0.0

        return unrealized_pl, unrealized_pl_percent

    def is_closed(self) -> bool:
        """포지션이 닫혔는지 여부"""
        return self.total_shares == 0

    def get_holding_days(self, as_of_date: Optional[date] = None) -> Optional[int]:
        """
        보유 기간 (일수) 계산
        
        Args:
            as_of_date: 기준일 (None이면 오늘)
        
        Returns:
            보유 일수 또는 None (최초 매수일이 없는 경우)
        """
        if self.first_buy_date is None:
            return None
        
        if as_of_date is None:
            as_of_date = date.today()
        
        delta = as_of_date - self.first_buy_date
        return delta.days

    def to_dict(self, current_price: Optional[float] = None, as_of_date: Optional[date] = None) -> Dict:
        """포지션 정보를 딕셔너리로 변환"""
        unrealized_pl, unrealized_pl_percent = self.get_unrealized_pl(current_price) if current_price else (None, None)
        market_value = self.total_shares * current_price if current_price else None

        return {
            "account_id": self.account_id,
            "ticker": self.ticker,
            "shares": self.total_shares,
            "avg_cost_usd": self.get_avg_cost(),
            "total_cost_usd": self.total_cost,
            "market_price_usd": current_price,
            "market_value_usd": market_value,
            "unrealized_pl_usd": unrealized_pl,
            "unrealized_pl_percent": unrealized_pl_percent,
            "is_closed": self.is_closed(),
            "lot_count": len(self.lots),
            "first_buy_date": self.first_buy_date.isoformat() if self.first_buy_date else None,
            "holding_days": self.get_holding_days(as_of_date),
            "realized_pl_usd": self.realized_pl  # 실현 손익 추가
        }


class PositionEngine:
    """포지션 엔진 - 여러 종목의 포지션을 관리"""
    
    def __init__(self):
        self.positions: Dict[str, Position] = {}
        self.all_realized_pl = []

    def process_trades(self, trades: List[Dict]) -> None:
        """
        거래 목록을 처리하여 포지션 계산
        trades: 거래 목록 (trade_date 기준으로 정렬되어야 함)
        """
        self.positions = {}
        self.all_realized_pl = []

        # 날짜 순으로 정렬
        sorted_trades = sorted(trades, key=lambda x: (x['trade_date'], x['id']))

        for trade in sorted_trades:
            ticker = trade['ticker'].upper()

            if ticker not in self.positions:
                self.positions[ticker] = Position(ticker, account_id=trade.get('account_id'))

            position = self.positions[ticker]

            if trade['side'] == 'BUY':
                position.add_buy(
                    shares=trade['shares'],
                    price_usd=trade['price_usd'],
                    trade_date=trade['trade_date'],
                    trade_id=trade['id'],
                    trade_fee_usd=trade.get('fee_usd', 0.0)
                )
            elif trade['side'] == 'SELL':
                try:
                    realized_info = position.process_sell(
                        shares=trade['shares'],
                        price_usd=trade['price_usd'],
                        trade_date=trade['trade_date'],
                        trade_id=trade['id'],
                        trade_fee_usd=trade.get('fee_usd', 0.0)
                    )
                    self.all_realized_pl.append(realized_info)
                except ValueError as e:
                    # 매도 수량 초과 등의 오류 처리
                    print(f"Error processing sell trade {trade['id']}: {e}")
                    continue

    def get_position(self, ticker: str) -> Optional[Position]:
        """특정 종목의 포지션 조회"""
        return self.positions.get(ticker.upper())

    def get_all_positions(self, include_closed: bool = False) -> List[Dict]:
        """모든 포지션 조회"""
        positions = []
        for ticker, position in self.positions.items():
            if not include_closed and position.is_closed():
                continue
            positions.append(position.to_dict())
        return positions

    def get_total_realized_pl(self) -> float:
        """총 실현 손익"""
        return sum(position.realized_pl for position in self.positions.values())

    def get_realized_pl_by_ticker(self, ticker: str) -> float:
        """특정 종목의 실현 손익"""
        position = self.get_position(ticker)
        return position.realized_pl if position else 0.0

    def get_all_realized_pl_history(self) -> List[Dict]:
        """모든 실현 손익 내역"""
        return self.all_realized_pl

