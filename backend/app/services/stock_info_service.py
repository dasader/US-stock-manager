"""
주식 정보 조회 서비스 (yfinance)
섹터, 산업, 기업 정보 등을 조회합니다.
"""
import logging
from typing import Optional, Dict
import yfinance as yf
from datetime import datetime, timedelta
from ..core.exceptions import ExternalServiceError

logger = logging.getLogger(__name__)

# ETF category → sector 매핑 (yfinance의 category 필드 기반)
ETF_CATEGORY_TO_SECTOR = {
    # 미국 시장지수 (Broad Market)
    'Large Blend': 'Broad Market',
    'Large Growth': 'Broad Market',
    'Large Value': 'Broad Market',
    'Mid-Cap Blend': 'Broad Market',
    'Mid-Cap Growth': 'Broad Market',
    'Mid-Cap Value': 'Broad Market',
    'Small Blend': 'Broad Market',
    'Small Growth': 'Broad Market',
    'Small Value': 'Broad Market',
    'Target-Date Retirement': 'Broad Market',

    # 섹터 ETF → 개별 주식 섹터와 동일 이름
    'Technology': 'Technology',
    'Health': 'Healthcare',
    'Financial': 'Financial Services',
    'Communications': 'Communication Services',
    'Consumer Cyclical': 'Consumer Cyclical',
    'Consumer Defensive': 'Consumer Defensive',
    'Energy Equity': 'Energy',
    'Equity Energy': 'Energy',
    'Natural Resources': 'Basic Materials',
    'Real Estate': 'Real Estate',
    'Utilities': 'Utilities',
    'Industrials': 'Industrials',

    # 해외 주식
    'Foreign Large Blend': 'International Equity',
    'Foreign Large Growth': 'International Equity',
    'Foreign Large Value': 'International Equity',
    'Foreign Small/Mid Blend': 'International Equity',
    'Foreign Small/Mid Growth': 'International Equity',
    'Foreign Small/Mid Value': 'International Equity',
    'Diversified Emerging Mkts': 'Emerging Markets',
    'China Region': 'Emerging Markets',
    'India Equity': 'Emerging Markets',
    'Japan Stock': 'International Equity',
    'Europe Stock': 'International Equity',
    'Pacific/Asia ex-Japan Stk': 'International Equity',
    'Latin America Stock': 'Emerging Markets',
    'Miscellaneous Region': 'International Equity',
    'World Large Stock': 'International Equity',
    'World Stock': 'International Equity',

    # 채권
    'Intermediate-Term Bond': 'Fixed Income',
    'Intermediate Core Bond': 'Fixed Income',
    'Intermediate Core-Plus Bond': 'Fixed Income',
    'Short-Term Bond': 'Fixed Income',
    'Ultrashort Bond': 'Fixed Income',
    'Long-Term Bond': 'Fixed Income',
    'Long Government': 'Fixed Income',
    'Short Government': 'Fixed Income',
    'Intermediate Government': 'Fixed Income',
    'High Yield Bond': 'Fixed Income',
    'Inflation-Protected Bond': 'Fixed Income',
    'Corporate Bond': 'Fixed Income',
    'World Bond': 'Fixed Income',
    'World Bond-USD Hedged': 'Fixed Income',
    'Emerging Markets Bond': 'Fixed Income',
    'Emerging-Markets Local-Currency Bond': 'Fixed Income',
    'Bank Loan': 'Fixed Income',
    'Muni National Interm': 'Fixed Income',
    'Muni National Long': 'Fixed Income',
    'Muni National Short': 'Fixed Income',
    'Muni Target Maturity': 'Fixed Income',
    'Nontraditional Bond': 'Fixed Income',
    'Multisector Bond': 'Fixed Income',

    # 원자재
    'Commodities Broad Basket': 'Commodities',
    'Commodities Focused': 'Commodities',
    'Equity Precious Metals': 'Commodities',

    # 대안투자
    'Long-Short Equity': 'Alternative',
    'Multialternative': 'Alternative',
    'Options Trading': 'Alternative',
    'Volatility': 'Alternative',
    'Trading--Leveraged Equity': 'Alternative',
    'Trading--Inverse Equity': 'Alternative',
    'Trading--Leveraged Debt': 'Alternative',
    'Trading--Inverse Debt': 'Alternative',
    'Trading--Miscellaneous': 'Alternative',
    'Preferred Stock': 'Alternative',
    'Convertibles': 'Alternative',
    'Derivative Income': 'Alternative',
    'Systematic Trend': 'Alternative',
    'Event Driven': 'Alternative',
    'Relative Value Arbitrage': 'Alternative',
    'Macro Trading': 'Alternative',
    'Digital Assets': 'Alternative',
}


def _match_etf_category_by_keyword(category: str) -> str:
    """ETF 카테고리를 키워드로 섹터에 매핑 (딕셔너리에 없는 카테고리용 폴백)"""
    if not category:
        return 'Other ETF'

    cat_lower = category.lower()
    keyword_map = [
        (['bond', 'fixed', 'treasury', 'municipal', 'debt'], 'Fixed Income'),
        (['emerging', 'china', 'india', 'brazil', 'latin'], 'Emerging Markets'),
        (['foreign', 'international', 'world', 'global', 'europe', 'japan', 'pacific'], 'International Equity'),
        (['health', 'biotech', 'pharma', 'medical'], 'Healthcare'),
        (['technology', 'tech', 'software', 'semiconductor'], 'Technology'),
        (['financial', 'bank'], 'Financial Services'),
        (['energy', 'oil', 'gas'], 'Energy'),
        (['real estate', 'reit'], 'Real Estate'),
        (['utilities'], 'Utilities'),
        (['consumer'], 'Consumer Cyclical'),
        (['industrials', 'infrastructure'], 'Industrials'),
        (['commodit', 'gold', 'silver', 'metal', 'mining'], 'Commodities'),
        (['leverag', 'inverse', 'option', 'volatil', 'trading', 'derivative', 'digital asset', 'crypto'], 'Alternative'),
        (['blend', 'growth', 'value', 'index', 'equity', 'stock', 'dividend', 'cap'], 'Broad Market'),
    ]

    for keywords, sector in keyword_map:
        if any(kw in cat_lower for kw in keywords):
            return sector

    return 'Other ETF'


class StockInfoService:
    """주식 정보 조회 서비스"""
    
    def __init__(self):
        self._cache: Dict[str, Dict] = {}
        self._cache_ttl = timedelta(hours=24)  # 24시간 캐시
    
    def get_stock_info(self, ticker: str) -> Optional[Dict]:
        """
        종목의 기본 정보 조회 (섹터, 산업, 국가 등)
        
        Args:
            ticker: 종목 심볼
            
        Returns:
            {
                'sector': str,
                'industry': str,
                'country': str,
                'website': str,
                'longName': str,
                'marketCap': float,
                'employees': int,
                'cached_at': datetime
            }
        """
        # 캐시 확인
        if ticker in self._cache:
            cached_data = self._cache[ticker]
            cache_age = datetime.now() - cached_data.get('cached_at', datetime.min)
            if cache_age < self._cache_ttl:
                logger.info(f"[STOCK_INFO] {ticker}: 캐시에서 조회 (나이: {cache_age.seconds // 60}분)")
                return cached_data

        # KRX 티커(6자리 숫자) 또는 GOLD는 yfinance 대신 별도 처리
        from .market_resolver import resolve_market
        if resolve_market(ticker) == "KRX":
            return self._get_krx_stock_info(ticker)

        try:
            logger.info(f"[STOCK_INFO] {ticker}: yfinance로 정보 조회 시작")
            stock = yf.Ticker(ticker)
            info = stock.info

            # ETF 여부 판별
            quote_type = info.get('quoteType', 'EQUITY')

            if quote_type == 'ETF':
                # ETF: category 기반으로 섹터/산업 분류
                category = info.get('category', '') or ''
                sector = ETF_CATEGORY_TO_SECTOR.get(category)
                if not sector:
                    sector = _match_etf_category_by_keyword(category)
                industry = category if category else 'ETF'
                logger.info(f"[STOCK_INFO] {ticker}: ETF 감지 - category='{category}' → sector='{sector}', industry='{industry}'")
            else:
                # 일반 주식: 기존 로직
                sector = info.get('sector', 'Unknown') or 'Unknown'
                industry = info.get('industry', 'Unknown') or 'Unknown'

            # 기본 정보 추출
            stock_data = {
                'ticker': ticker,
                'sector': sector,
                'industry': industry,
                'country': info.get('country', 'Unknown'),
                'website': info.get('website', ''),
                'longName': info.get('longName', ticker) or ticker,
                'shortName': info.get('shortName', ticker) or ticker,
                'marketCap': info.get('marketCap', 0),
                'employees': info.get('fullTimeEmployees', 0),
                'businessSummary': info.get('longBusinessSummary', ''),
                'cached_at': datetime.now()
            }

            # 캐시 저장
            self._cache[ticker] = stock_data

            logger.info(f"[STOCK_INFO] {ticker}: 조회 완료 - {stock_data['sector']} / {stock_data['industry']}")
            return stock_data
            
        except Exception as e:
            logger.error(f"[STOCK_INFO] {ticker} 정보 조회 실패: {e}")
            # 에러 시 기본값 반환
            return {
                'ticker': ticker,
                'sector': 'Unknown',
                'industry': 'Unknown',
                'country': 'Unknown',
                'website': '',
                'longName': ticker,
                'shortName': ticker,
                'marketCap': 0,
                'employees': 0,
                'businessSummary': '',
                'cached_at': datetime.now()
            }
    
    def _get_krx_stock_info(self, ticker: str) -> Dict:
        """KRX 종목/금현물 정보. yfinance 우회."""
        from .krx_service import krx_service
        from .market_resolver import to_krx_code

        code = to_krx_code(ticker)
        is_gold = code == "04020000"

        if is_gold:
            name = "금 현물 1kg (KRX)"
            sector = "Precious Metals"
            industry = "Gold Spot"
        else:
            name = krx_service.get_name(ticker) or ticker
            sector = krx_service.get_sector(ticker) or "Unknown"
            industry = sector  # KRX 업종을 industry로도 사용

        stock_data = {
            'ticker': ticker,
            'sector': sector,
            'industry': industry,
            'country': 'South Korea',
            'website': '',
            'longName': name,
            'shortName': name,
            'marketCap': 0,
            'employees': 0,
            'businessSummary': '',
            'cached_at': datetime.now(),
        }
        self._cache[ticker] = stock_data
        logger.info(f"[STOCK_INFO] {ticker}: KRX 정보 사용 (name={name}, sector={sector})")
        return stock_data

    def get_sector_industry(self, ticker: str) -> Dict[str, str]:
        """
        종목의 섹터와 산업만 빠르게 조회
        
        Args:
            ticker: 종목 심볼
            
        Returns:
            {'sector': str, 'industry': str}
        """
        info = self.get_stock_info(ticker)
        return {
            'sector': info['sector'],
            'industry': info['industry']
        }
    
    def clear_cache(self, ticker: Optional[str] = None):
        """캐시 삭제"""
        if ticker:
            self._cache.pop(ticker, None)
            logger.info(f"[STOCK_INFO] {ticker} 캐시 삭제")
        else:
            self._cache.clear()
            logger.info("[STOCK_INFO] 전체 캐시 삭제")


# 싱글톤 인스턴스
stock_info_service = StockInfoService()














