"""
백그라운드 주가 조회 서비스
"""
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
import threading
import time
from ..database import get_db
from .. import crud
from .position_engine import PositionEngine
from .price_service import price_service
from .market_resolver import resolve_market
from .market_hours import is_krx_open, is_us_open


class BackgroundPriceService:
    """백그라운드에서 주가를 미리 로딩하는 서비스"""
    
    def __init__(self):
        self.is_running = False
        self.loading_status: Dict[str, Dict] = {}
        self.price_cache: Dict[str, Dict] = {}
        self.last_update = None
        self.update_interval = 120  # 유지 (외부 호환)
        self.check_interval = 30    # 워커 루프 체크 주기(초)
        self.open_interval = 120    # 시장 개장 중 갱신 주기
        self.closed_interval = 3600 # 시장 외 갱신 주기
        self._last_ticker_update: Dict[str, float] = {}
        self.callbacks: List[Callable] = []
        self._lock = threading.Lock()
    
    def start_background_loading(self):
        """백그라운드 로딩 시작"""
        if self.is_running:
            return
        
        self.is_running = True
        thread = threading.Thread(target=self._background_worker, daemon=True)
        thread.start()
        print("Background price loading started")
    
    def stop_background_loading(self):
        """백그라운드 로딩 중지"""
        self.is_running = False
        print("Background price loading stopped")
    
    def _interval_for(self, ticker: str) -> int:
        """티커의 시장 상태에 따른 갱신 주기(초) 반환"""
        market = resolve_market(ticker)
        if market == "KRX":
            return self.open_interval if is_krx_open() else self.closed_interval
        return self.open_interval if is_us_open() else self.closed_interval

    def _should_update(self, ticker: str) -> bool:
        """티커를 지금 갱신해야 하는지 여부 반환"""
        import time as _t
        last = self._last_ticker_update.get(ticker, 0.0)
        return (_t.time() - last) >= self._interval_for(ticker)

    def _background_worker(self):
        """백그라운드 워커 스레드"""
        while self.is_running:
            try:
                self._load_all_prices()
                time.sleep(self.check_interval)
            except Exception as e:
                print(f"Background price loading error: {e}")
                time.sleep(60)  # 에러 시 1분 대기
    
    def _load_all_prices(self):
        """모든 포지션의 주가를 백그라운드에서 로딩"""
        try:
            # 데이터베이스에서 거래 데이터 조회
            db = next(get_db())
            trades = crud.get_all_trades_for_calculation(db)
            
            # 포지션 엔진으로 계산
            engine = PositionEngine()
            engine.process_trades(trades)
            
            # 활성 포지션 목록 가져오기
            positions = engine.get_all_positions(include_closed=False)
            # 중복 제거: set을 사용하여 고유한 티커만 추출
            active_tickers = list(set([p['ticker'] for p in positions if p['shares'] > 0]))
            
            if not active_tickers:
                return
            
            print(f"Background loading prices for {len(active_tickers)} unique tickers: {', '.join(active_tickers)}")
            
            # 시장별 갱신 필요 여부로 필터
            tickers_to_update = [t for t in active_tickers if self._should_update(t)]
            if not tickers_to_update:
                with self._lock:
                    self.loading_status['current_ticker'] = None
                    self.loading_status['total'] = 0
                    self.loading_status['completed'] = 0
                return

            with self._lock:
                self.loading_status['total'] = len(tickers_to_update)
                self.loading_status['completed'] = 0

            print(f"[BG] 갱신 대상 {len(tickers_to_update)}/{len(active_tickers)} 종목")

            # 로딩 상태 초기화
            with self._lock:
                self.loading_status = {
                    'total': len(tickers_to_update),
                    'completed': 0,
                    'failed': 0,
                    'current_ticker': None,
                    'start_time': datetime.now(),
                    'estimated_completion': None
                }

            for i, ticker in enumerate(tickers_to_update):
                if not self.is_running:
                    break
                with self._lock:
                    self.loading_status['current_ticker'] = ticker
                    self.loading_status['completed'] = i
                try:
                    price_data = price_service.get_price(ticker)
                    if price_data:
                        self.price_cache[ticker] = price_data
                        self._last_ticker_update[ticker] = time.time()
                        with self._lock:
                            self.loading_status['completed'] = i + 1
                    else:
                        with self._lock:
                            self.loading_status['failed'] += 1
                except Exception as e:
                    print(f"Failed to load price for {ticker}: {e}")
                    with self._lock:
                        self.loading_status['failed'] += 1
                self._notify_callbacks()
            
            # 완료 상태 업데이트
            with self._lock:
                self.loading_status['current_ticker'] = None
                self.loading_status['estimated_completion'] = datetime.now()
                self.last_update = datetime.now()
            
            print(f"Background price loading completed: {self.loading_status['completed']}/{self.loading_status['total']}")
            self._notify_callbacks()
            
        except Exception as e:
            print(f"Error in background price loading: {e}")
    
    def get_loading_status(self) -> Dict:
        """현재 로딩 상태 반환"""
        with self._lock:
            status = self.loading_status.copy()
            
            # 진행률 계산
            if status.get('total', 0) > 0:
                status['progress_percent'] = (status['completed'] / status['total']) * 100
                
                # 예상 완료 시간 계산
                if status['completed'] > 0 and status.get('start_time'):
                    elapsed = (datetime.now() - status['start_time']).total_seconds()
                    avg_time_per_ticker = elapsed / status['completed']
                    remaining = status['total'] - status['completed']
                    estimated_remaining_seconds = remaining * avg_time_per_ticker
                    status['estimated_remaining_seconds'] = int(estimated_remaining_seconds)
            
            return status
    
    def get_cached_price(self, ticker: str) -> Optional[Dict]:
        """캐시된 가격 정보 반환"""
        with self._lock:
            return self.price_cache.get(ticker.upper())
    
    def get_all_cached_prices(self) -> Dict[str, Dict]:
        """모든 캐시된 가격 정보 반환"""
        with self._lock:
            return self.price_cache.copy()
    
    def is_price_loading_complete(self) -> bool:
        """가격 로딩이 완료되었는지 확인"""
        with self._lock:
            return (self.loading_status.get('completed', 0) >= 
                   self.loading_status.get('total', 0) and 
                   self.loading_status.get('total', 0) > 0)
    
    def add_callback(self, callback: Callable):
        """진행률 업데이트 콜백 추가"""
        self.callbacks.append(callback)
    
    def remove_callback(self, callback: Callable):
        """진행률 업데이트 콜백 제거"""
        if callback in self.callbacks:
            self.callbacks.remove(callback)
    
    def _notify_callbacks(self):
        """콜백 함수들 호출"""
        status = self.get_loading_status()
        for callback in self.callbacks:
            try:
                callback(status)
            except Exception as e:
                print(f"Callback error: {e}")
    
    def force_refresh(self):
        """강제로 가격 새로고침 시작"""
        if self.is_running:
            thread = threading.Thread(target=self._load_all_prices, daemon=True)
            thread.start()


# 싱글톤 인스턴스
background_price_service = BackgroundPriceService()

