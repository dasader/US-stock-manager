"""
포지션 엔진 멀티통화 회귀 테스트

PositionEngine은 통화에 무관하게 동작합니다.
- KRW 계정: price_usd 컬럼에 KRW 금액 저장
- USD 계정: price_usd 컬럼에 USD 금액 저장
- 계정 격리: 각 계정의 거래를 별도 PositionEngine 인스턴스로 처리
"""
import pytest
from datetime import date
from ..services.position_engine import PositionEngine, Position


# ---------------------------------------------------------------------------
# KRW 계정 FIFO 테스트
# ---------------------------------------------------------------------------

def test_krw_account_fifo_buy_sell():
    """KRW 계정: BUY 10@70000, SELL 3@80000 → 잔여 7주, avg_cost 70000"""
    trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 10,
            "price_usd": 70000,  # KRW 금액을 price_usd 컬럼에 저장
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
        {
            "id": 2,
            "ticker": "005930",
            "side": "SELL",
            "shares": 3,
            "price_usd": 80000,
            "fee_usd": 0,
            "trade_date": date(2024, 2, 15),
        },
    ]

    engine = PositionEngine()
    engine.process_trades(trades)

    pos = engine.get_position("005930")
    assert pos is not None, "005930 포지션이 존재해야 합니다"
    assert pos.total_shares == 7, f"잔여 주수는 7이어야 합니다, 실제: {pos.total_shares}"
    assert pos.get_avg_cost() == pytest.approx(70000.0), (
        f"평균 단가는 70000 이어야 합니다, 실제: {pos.get_avg_cost()}"
    )


def test_krw_account_fifo_realized_pl():
    """KRW 계정: SELL 3@80000 → 실현손익 (80000-70000)*3 = 30000"""
    trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 10,
            "price_usd": 70000,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
        {
            "id": 2,
            "ticker": "005930",
            "side": "SELL",
            "shares": 3,
            "price_usd": 80000,
            "fee_usd": 0,
            "trade_date": date(2024, 2, 15),
        },
    ]

    engine = PositionEngine()
    engine.process_trades(trades)

    pos = engine.get_position("005930")
    assert pos is not None
    assert pos.realized_pl == pytest.approx(30000.0), (
        f"실현손익은 30000 이어야 합니다, 실제: {pos.realized_pl}"
    )


def test_krw_account_full_close():
    """KRW 계정: 전량 매도 시 포지션 청산"""
    trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 5,
            "price_usd": 60000,
            "fee_usd": 0,
            "trade_date": date(2024, 3, 1),
        },
        {
            "id": 2,
            "ticker": "005930",
            "side": "SELL",
            "shares": 5,
            "price_usd": 65000,
            "fee_usd": 0,
            "trade_date": date(2024, 4, 1),
        },
    ]

    engine = PositionEngine()
    engine.process_trades(trades)

    pos = engine.get_position("005930")
    assert pos is not None
    assert pos.total_shares == 0
    assert pos.is_closed(), "전량 매도 후 포지션이 청산되어야 합니다"
    assert pos.realized_pl == pytest.approx(25000.0)  # (65000-60000)*5


# ---------------------------------------------------------------------------
# 계정 격리(Account Isolation) 테스트
# ---------------------------------------------------------------------------

def test_account_isolation_separate_engines():
    """
    KRW 계정과 USD 계정이 독립적으로 동작해야 합니다.
    각 계정의 거래를 별도 PositionEngine 인스턴스로 처리하면
    서로의 포지션에 영향을 주지 않습니다.
    """
    # KRW 계정 거래 (삼성전자)
    krw_trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 10,
            "price_usd": 70000,  # KRW
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
    ]

    # USD 계정 거래 (AAPL)
    usd_trades = [
        {
            "id": 2,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 5,
            "price_usd": 150.0,  # USD
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
    ]

    krw_engine = PositionEngine()
    krw_engine.process_trades(krw_trades)

    usd_engine = PositionEngine()
    usd_engine.process_trades(usd_trades)

    # KRW 계정에는 005930만 있고 AAPL은 없어야 함
    assert krw_engine.get_position("005930") is not None, (
        "KRW 계정에 005930 포지션이 있어야 합니다"
    )
    assert krw_engine.get_position("AAPL") is None, (
        "KRW 계정에 AAPL 포지션이 없어야 합니다"
    )

    # USD 계정에는 AAPL만 있고 005930은 없어야 함
    assert usd_engine.get_position("AAPL") is not None, (
        "USD 계정에 AAPL 포지션이 있어야 합니다"
    )
    assert usd_engine.get_position("005930") is None, (
        "USD 계정에 005930 포지션이 없어야 합니다"
    )


def test_account_isolation_shares_do_not_leak():
    """
    KRW 계정의 주수와 비용이 USD 계정으로 누출되지 않아야 합니다.
    """
    krw_trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 10,
            "price_usd": 70000,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
    ]

    usd_trades = [
        {
            "id": 2,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 5,
            "price_usd": 150.0,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
    ]

    krw_engine = PositionEngine()
    krw_engine.process_trades(krw_trades)

    usd_engine = PositionEngine()
    usd_engine.process_trades(usd_trades)

    krw_pos = krw_engine.get_position("005930")
    usd_pos = usd_engine.get_position("AAPL")

    # 각 계정의 주수가 독립적으로 올바른지 확인
    assert krw_pos.total_shares == pytest.approx(10.0), (
        f"KRW 계정 005930 주수는 10이어야 합니다, 실제: {krw_pos.total_shares}"
    )
    assert usd_pos.total_shares == pytest.approx(5.0), (
        f"USD 계정 AAPL 주수는 5이어야 합니다, 실제: {usd_pos.total_shares}"
    )

    # 각 계정의 평균단가가 독립적인지 확인
    assert krw_pos.get_avg_cost() == pytest.approx(70000.0), (
        f"KRW 계정 평균단가는 70000 이어야 합니다, 실제: {krw_pos.get_avg_cost()}"
    )
    assert usd_pos.get_avg_cost() == pytest.approx(150.0), (
        f"USD 계정 평균단가는 150.0 이어야 합니다, 실제: {usd_pos.get_avg_cost()}"
    )


def test_account_isolation_total_positions_count():
    """각 계정 엔진은 자신의 종목만 포함해야 합니다."""
    krw_trades = [
        {
            "id": 1,
            "ticker": "005930",
            "side": "BUY",
            "shares": 10,
            "price_usd": 70000,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
        {
            "id": 2,
            "ticker": "000660",  # SK하이닉스
            "side": "BUY",
            "shares": 5,
            "price_usd": 120000,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 12),
        },
    ]

    usd_trades = [
        {
            "id": 3,
            "ticker": "AAPL",
            "side": "BUY",
            "shares": 5,
            "price_usd": 150.0,
            "fee_usd": 0,
            "trade_date": date(2024, 1, 10),
        },
    ]

    krw_engine = PositionEngine()
    krw_engine.process_trades(krw_trades)

    usd_engine = PositionEngine()
    usd_engine.process_trades(usd_trades)

    krw_positions = krw_engine.get_all_positions(include_closed=True)
    usd_positions = usd_engine.get_all_positions(include_closed=True)

    assert len(krw_positions) == 2, (
        f"KRW 계정에 2개 포지션이 있어야 합니다, 실제: {len(krw_positions)}"
    )
    assert len(usd_positions) == 1, (
        f"USD 계정에 1개 포지션이 있어야 합니다, 실제: {len(usd_positions)}"
    )

    krw_tickers = {p["ticker"] for p in krw_positions}
    usd_tickers = {p["ticker"] for p in usd_positions}

    assert "005930" in krw_tickers
    assert "000660" in krw_tickers
    assert "AAPL" in usd_tickers
    # 교집합이 없어야 함
    assert krw_tickers.isdisjoint(usd_tickers), (
        f"KRW/USD 계정 간 ticker 누출: {krw_tickers & usd_tickers}"
    )
