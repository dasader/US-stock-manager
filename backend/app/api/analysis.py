"""
포트폴리오 분석 API 엔드포인트
"""
import logging
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional, List, Dict
from collections import defaultdict
from datetime import date

from .. import crud, schemas
from ..database import get_db
from ..services.position_engine import PositionEngine
from ..services.price_aggregator import price_aggregator
from ..services.stock_info_service import stock_info_service
from ..services.fx_service import fx_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/portfolio/", response_model=schemas.PortfolioAnalysis)
async def analyze_portfolio(
    account_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    포트폴리오 분석
    - 섹터별 배분
    - 산업별 배분
    - 집중도 분석
    - 다양성 점수
    """
    # 환율 조회 (KRW 계정 포지션 환산용)
    fx_data = await fx_service.get_rate("USD", "KRW")
    fx_rate = fx_data['rate'] if fx_data else 1350.0

    # 1. 포지션 조회
    trades = crud.get_all_trades_for_calculation(db, account_id)
    engine = PositionEngine()
    engine.process_trades(trades)
    positions = engine.get_all_positions(include_closed=False)
    
    # 가격 정보 추가
    price_data = price_aggregator.get_prices_for_positions(positions)
    positions = price_aggregator.apply_prices_to_positions(positions, price_data)
    
    # 각 포지션에 account_id 추가 (배당 데이터 조회를 위해)
    for position in positions:
        # 해당 ticker의 첫 번째 거래에서 account_id 가져오기
        matching_trade = next((t for t in trades if t['ticker'] == position['ticker']), None)
        if matching_trade:
            position['account_id'] = matching_trade['account_id']
        else:
            position['account_id'] = account_id or 0

    # 계정 맵 로드 (포지션별 base_currency 판별용)
    accounts_list = crud.get_accounts(db)
    accounts_map = {a.id: a for a in accounts_list}

    # 2. DB에서 배당 데이터 조회 (yfinance 호출 없이)
    current_year = date.today().year
    # 모든 포지션의 티커 목록 수집
    position_tickers = [p['ticker'] for p in positions]
    logger.info(f"[ANALYSIS] 포지션 티커 수집: {len(position_tickers)} tickers")
    
    # DB에서 현재 연도의 배당 데이터를 티커별로 집계하여 조회
    # account_id가 None이면 전체 계정, 아니면 해당 계정만 조회
    dividend_data_by_ticker = {}
    if position_tickers:
        # account_id와 year로 필터링하여 배당 데이터 조회
        dividends_by_ticker = crud.get_dividends_by_ticker(db, account_id=account_id, year=current_year)
        logger.info(f"[ANALYSIS] 배당 데이터 조회: account_id={account_id}, year={current_year}, found={len(dividends_by_ticker)} items, position_tickers={len(position_tickers)}")
        
        # 딕셔너리로 변환 (빠른 조회를 위해)
        # get_dividends_by_ticker는 이미 티커별로 집계하므로 그대로 사용
        # position_tickers도 대문자로 변환하여 비교
        position_tickers_upper = [t.upper() for t in position_tickers]
        for item in dividends_by_ticker:
            ticker = item['ticker'].upper()  # 대문자로 변환
            if ticker in position_tickers_upper:
                dividend_data_by_ticker[ticker] = item['total_amount_usd']
        
        logger.info(f"[ANALYSIS] 매칭된 배당 데이터: {len(dividend_data_by_ticker)} tickers")
    
    # 3. 각 포지션에 섹터/산업 정보 추가
    positions_with_info = []
    sector_data = defaultdict(lambda: {
        'count': 0,
        'total_value_usd': 0.0,
        'total_cost_usd': 0.0,
        'unrealized_pl_usd': 0.0
    })
    industry_data = defaultdict(lambda: {
        'sector': '',
        'count': 0,
        'total_value_usd': 0.0,
        'total_cost_usd': 0.0,
        'unrealized_pl_usd': 0.0
    })
    
    total_market_value_usd = 0.0
    total_unrealized_pl_usd = 0.0
    
    for position in positions:
        ticker = position['ticker']
        account_id_pos = position.get('account_id')
        account = accounts_map.get(account_id_pos) if account_id_pos else None
        if account is None and account_id_pos:
            logger.warning(
                f"[ANALYSIS] account_id={account_id_pos} 계정 없음 → USD 기본값 사용 "
                f"(ticker={ticker})"
            )
        base_currency = getattr(account, 'base_currency', 'USD') if account else 'USD'

        raw_market_value = position.get('market_value_usd', 0) or 0
        raw_unrealized_pl = position.get('unrealized_pl_usd', 0) or 0

        # KRW 계정은 native 금액(KRW)을 USD로 환산
        if base_currency == 'KRW':
            market_value = raw_market_value / fx_rate if fx_rate else 0.0
            unrealized_pl = raw_unrealized_pl / fx_rate if fx_rate else 0.0
        else:
            market_value = raw_market_value
            unrealized_pl = raw_unrealized_pl
        
        # 섹터/산업 정보 조회 (24시간 인메모리 캐시 활용)
        try:
            stock_info = stock_info_service.get_stock_info(ticker)
            sector = stock_info.get('sector', 'Unknown') or 'Unknown'
            industry = stock_info.get('industry', 'Unknown') or 'Unknown'
            long_name = stock_info.get('longName', ticker) or ticker
        except Exception as e:
            logger.warning(f"[ANALYSIS] {ticker} 섹터/산업 정보 조회 실패: {e}")
            sector = 'Unknown'
            industry = 'Unknown'
            long_name = ticker
        
        # DB에서 배당금 조회 (yfinance 호출 없이)
        yearly_dividend = dividend_data_by_ticker.get(ticker.upper(), 0.0)  # 대소문자 일치 확인

        # 포지션 정보 저장
        positions_with_info.append({
            'ticker': ticker,
            'shares': position['shares'],
            'avg_cost_usd': position['avg_cost_usd'],
            'market_price_usd': position.get('market_price_usd'),
            'market_value_usd': market_value,
            'unrealized_pl_usd': unrealized_pl,
            'unrealized_pl_percent': position.get('unrealized_pl_percent', 0),
            'weight': 0.0,  # 나중에 계산
            'sector': sector,
            'industry': industry,
            'longName': long_name,
            'yearly_dividend_usd': yearly_dividend
        })
        
        # 섹터별 집계
        sector_data[sector]['count'] += 1
        sector_data[sector]['total_value_usd'] += market_value
        sector_data[sector]['unrealized_pl_usd'] += unrealized_pl
        raw_cost = position['avg_cost_usd'] * position['shares']
        cost = raw_cost / fx_rate if base_currency == 'KRW' else raw_cost
        sector_data[sector]['total_cost_usd'] += cost

        # 산업별 집계
        industry_data[industry]['sector'] = sector
        industry_data[industry]['count'] += 1
        industry_data[industry]['total_value_usd'] += market_value
        industry_data[industry]['unrealized_pl_usd'] += unrealized_pl
        industry_data[industry]['total_cost_usd'] += cost
        
        # 전체 합계
        total_market_value_usd += market_value
        total_unrealized_pl_usd += unrealized_pl
    
    # 4. 포지션별 비중 계산
    for position in positions_with_info:
        if total_market_value_usd > 0:
            position['weight'] = (position['market_value_usd'] / total_market_value_usd) * 100
    
    # 5. 섹터별 배분 계산
    sector_allocations = []
    for sector, data in sector_data.items():
        percentage = (data['total_value_usd'] / total_market_value_usd * 100) if total_market_value_usd > 0 else 0
        pl_percent = (data['unrealized_pl_usd'] / data['total_cost_usd'] * 100) if data['total_cost_usd'] > 0 else 0
        
        sector_allocations.append({
            'sector': sector,
            'count': data['count'],
            'total_value_usd': data['total_value_usd'],
            'percentage': percentage,
            'unrealized_pl_usd': data['unrealized_pl_usd'],
            'unrealized_pl_percent': pl_percent
        })
    
    # 섹터별 정렬 (비중 높은 순)
    sector_allocations.sort(key=lambda x: x['percentage'], reverse=True)
    top_sectors = [s['sector'] for s in sector_allocations[:3]]
    
    # 6. 산업별 배분 계산
    industry_allocations = []
    for industry, data in industry_data.items():
        percentage = (data['total_value_usd'] / total_market_value_usd * 100) if total_market_value_usd > 0 else 0
        pl_percent = (data['unrealized_pl_usd'] / data['total_cost_usd'] * 100) if data['total_cost_usd'] > 0 else 0
        
        industry_allocations.append({
            'industry': industry,
            'sector': data['sector'],
            'count': data['count'],
            'total_value_usd': data['total_value_usd'],
            'percentage': percentage,
            'unrealized_pl_usd': data['unrealized_pl_usd'],
            'unrealized_pl_percent': pl_percent
        })
    
    # 산업별 정렬
    industry_allocations.sort(key=lambda x: x['percentage'], reverse=True)
    
    # 7. 집중도 경고 (30% 이상)
    warnings = []
    THRESHOLD = 30.0
    
    # 포지션 집중도
    for position in positions_with_info:
        if position['weight'] >= THRESHOLD:
            warnings.append({
                'type': 'position',
                'name': position['ticker'],
                'percentage': position['weight'],
                'threshold': THRESHOLD,
                'message': f"{position['ticker']} 종목이 포트폴리오의 {position['weight']:.1f}%를 차지하고 있습니다."
            })
    
    # 섹터 집중도
    for sector_alloc in sector_allocations:
        if sector_alloc['percentage'] >= THRESHOLD:
            warnings.append({
                'type': 'sector',
                'name': sector_alloc['sector'],
                'percentage': sector_alloc['percentage'],
                'threshold': THRESHOLD,
                'message': f"{sector_alloc['sector']} 섹터가 포트폴리오의 {sector_alloc['percentage']:.1f}%를 차지하고 있습니다."
            })
    
    # 8. 다양성 점수 계산 (0-100)
    # 섹터 수, 산업 수, 집중도를 종합
    sector_count = len(sector_data)
    industry_count = len(industry_data)
    
    # 기본 점수: 섹터/산업 다양성
    diversity_score = min(sector_count * 10, 50)  # 최대 50점
    diversity_score += min(industry_count * 2, 30)  # 최대 30점
    
    # 집중도 페널티
    concentration_penalty = 0
    for position in positions_with_info:
        if position['weight'] > 20:
            concentration_penalty += (position['weight'] - 20)
    
    diversity_score -= min(concentration_penalty, 20)  # 최대 -20점
    diversity_score = max(0, min(100, diversity_score))  # 0-100 범위
    
    # 9. 수익률 계산
    total_cost_usd = total_market_value_usd - total_unrealized_pl_usd
    total_unrealized_pl_percent = (total_unrealized_pl_usd / total_cost_usd * 100) if total_cost_usd > 0 else 0
    
    return {
        'total_positions': len(positions_with_info),
        'total_market_value_usd': total_market_value_usd,
        'total_unrealized_pl_usd': total_unrealized_pl_usd,
        'total_unrealized_pl_percent': total_unrealized_pl_percent,
        'sector_allocations': sector_allocations,
        'top_sectors': top_sectors,
        'industry_allocations': industry_allocations,
        'positions_with_info': positions_with_info,
        'concentration_warnings': warnings,
        'diversification_score': diversity_score,
        'sector_count': sector_count,
        'industry_count': industry_count
    }


@router.get("/stock-info/{ticker}", response_model=schemas.StockInfo, include_in_schema=True)
@router.get("/stock-info/{ticker}/", response_model=schemas.StockInfo, include_in_schema=False)
def get_stock_info(ticker: str):
    """종목 정보 조회"""
    info = stock_info_service.get_stock_info(ticker)
    return {
        'ticker': info['ticker'],
        'sector': info['sector'],
        'industry': info['industry'],
        'country': info['country'],
        'longName': info['longName'],
        'shortName': info['shortName']
    }



