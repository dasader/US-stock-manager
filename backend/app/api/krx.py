from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio
from ..services.krx_service import krx_service

router = APIRouter(prefix="/api/krx", tags=["krx"])


class TickerInfo(BaseModel):
    ticker: str
    name: str
    sector: Optional[str] = None


@router.get("/ticker/{code}/info", response_model=TickerInfo)
async def get_ticker_info(code: str):
    name = await krx_service.get_name_async(code)
    if not name:
        raise HTTPException(404, "ticker not found")
    sector = krx_service.get_sector(code)
    return TickerInfo(ticker=code, name=name, sector=sector)


@router.get("/search", response_model=list[TickerInfo])
async def search_ticker(q: str):
    """종목명 부분 일치 검색. pykrx 전체 리스트에서 필터 (KOSPI+KOSDAQ)."""
    from pykrx import stock as _stock

    def _search():
        results = []
        for mkt in ("KOSPI", "KOSDAQ"):
            try:
                tickers = _stock.get_market_ticker_list(market=mkt)
            except Exception:
                continue
            for t in tickers:
                try:
                    name = _stock.get_market_ticker_name(t)
                except Exception:
                    continue
                if q in name:
                    results.append(TickerInfo(ticker=t, name=name))
                    if len(results) >= 20:
                        return results
        return results

    return await asyncio.to_thread(_search)
