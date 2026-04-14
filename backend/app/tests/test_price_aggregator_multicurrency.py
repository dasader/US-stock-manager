"""
PriceAggregator 통화 인식 집계 테스트

calculate_position_metrics_multicurrency()는
각 포지션의 account_id → base_currency를 읽어
native 통화 금액을 target_currency로 환산 후 합산한다.
"""
import pytest
from ..services.price_aggregator import PriceAggregator


# Fake Account 객체 (ORM 대신 간단한 네임스페이스)
class FakeAccount:
    def __init__(self, id: int, base_currency: str):
        self.id = id
        self.base_currency = base_currency


FX_RATE = 1400.0   # 1 USD = 1400 KRW (테스트용 고정값)


def _make_position(account_id, ticker, shares, avg_cost, market_price):
    """테스트용 포지션 dict 생성 헬퍼"""
    total_cost = shares * avg_cost
    market_value = shares * market_price
    unrealized_pl = market_value - total_cost
    return {
        "account_id": account_id,
        "ticker": ticker,
        "shares": shares,
        "avg_cost_usd": avg_cost,
        "total_cost_usd": total_cost,
        "market_price_usd": market_price,
        "market_value_usd": market_value,
        "unrealized_pl_usd": unrealized_pl,
    }


# --------------------------------------------------------------------------
# USD 단일 계정
# --------------------------------------------------------------------------

def test_single_usd_account_target_usd():
    """USD 계정, target_currency=USD → 변환 없이 그대로 합산"""
    accounts_map = {1: FakeAccount(1, "USD")}
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
    ]
    price_data = {"AAPL": {"price_usd": 160.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    # market_value = 10 * 160 = 1600 USD
    assert result["total_market_value"] == pytest.approx(1600.0)
    # unrealized_pl = (160-150)*10 = 100 USD
    assert result["total_unrealized_pl"] == pytest.approx(100.0)
    assert result["native_usd_market_value"] == pytest.approx(1600.0)
    assert result["native_krw_market_value"] == pytest.approx(0.0)


def test_single_usd_account_target_krw():
    """USD 계정, target_currency=KRW → USD 금액에 fx_rate 곱셈"""
    accounts_map = {1: FakeAccount(1, "USD")}
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
    ]
    price_data = {"AAPL": {"price_usd": 160.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    # 1600 USD * 1400 = 2_240_000 KRW
    assert result["total_market_value"] == pytest.approx(1600.0 * FX_RATE)
    assert result["total_unrealized_pl"] == pytest.approx(100.0 * FX_RATE)


# --------------------------------------------------------------------------
# KRW 단일 계정
# --------------------------------------------------------------------------

def test_single_krw_account_target_krw():
    """KRW 계정, target_currency=KRW → 변환 없이 그대로 합산"""
    accounts_map = {2: FakeAccount(2, "KRW")}
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    # market_value = 26 * 226170 = 5,880,420 KRW
    assert result["total_market_value"] == pytest.approx(26 * 226_170.0)
    # unrealized_pl = (226170-170000)*26 = 1,460,420 KRW
    assert result["total_unrealized_pl"] == pytest.approx((226_170.0 - 170_000.0) * 26)
    assert result["native_krw_market_value"] == pytest.approx(26 * 226_170.0)
    assert result["native_usd_market_value"] == pytest.approx(0.0)


def test_single_krw_account_target_usd():
    """KRW 계정, target_currency=USD → KRW 금액을 fx_rate로 나눔"""
    accounts_map = {2: FakeAccount(2, "KRW")}
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    krw_market_value = 26 * 226_170.0
    assert result["total_market_value"] == pytest.approx(krw_market_value / FX_RATE)


# --------------------------------------------------------------------------
# 혼합 계정 (핵심 시나리오)
# --------------------------------------------------------------------------

def test_mixed_accounts_target_usd():
    """USD + KRW 혼합, target_currency=USD → 각각 정확히 환산 후 합산"""
    accounts_map = {
        1: FakeAccount(1, "USD"),
        2: FakeAccount(2, "KRW"),
    }
    positions = [
        _make_position(1, "AAPL", shares=10, avg_cost=150.0, market_price=160.0),
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {
        "AAPL": {"price_usd": 160.0},
        "GOLD": {"price_usd": 226_170.0},
    }
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    usd_part = 10 * 160.0                              # 1600 USD
    krw_part = 26 * 226_170.0 / FX_RATE               # ~4200 USD
    assert result["total_market_value"] == pytest.approx(usd_part + krw_part, rel=1e-4)
    assert result["native_usd_market_value"] == pytest.approx(usd_part)
    assert result["native_krw_market_value"] == pytest.approx(26 * 226_170.0)


def test_mixed_accounts_no_double_fx():
    """KRW 포지션의 unrealized_pl이 USD로 double-converted되지 않는지 검증"""
    accounts_map = {
        2: FakeAccount(2, "KRW"),
    }
    positions = [
        _make_position(2, "GOLD", shares=26, avg_cost=170_000.0, market_price=226_170.0),
    ]
    price_data = {"GOLD": {"price_usd": 226_170.0}}
    agg = PriceAggregator()
    result_krw = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "KRW"
    )
    result_usd = agg.calculate_position_metrics_multicurrency(
        positions, price_data, accounts_map, FX_RATE, "USD"
    )
    # KRW 결과를 USD로 나누면 USD 결과와 일치해야 함
    assert result_krw["total_unrealized_pl"] / FX_RATE == pytest.approx(
        result_usd["total_unrealized_pl"], rel=1e-4
    )


# --------------------------------------------------------------------------
# 빈 포지션 (경계값)
# --------------------------------------------------------------------------

def test_empty_positions_returns_all_zeros():
    """빈 포지션 리스트 → 모든 집계값이 0.0이어야 한다"""
    agg = PriceAggregator()
    result = agg.calculate_position_metrics_multicurrency([], {}, {}, 1400.0, "USD")
    assert result["total_market_value"] == 0.0
    assert result["total_unrealized_pl"] == 0.0
    assert result["total_cost"] == 0.0
    assert result["native_usd_market_value"] == 0.0
    assert result["native_krw_market_value"] == 0.0
    assert result["native_usd_unrealized_pl"] == 0.0
    assert result["native_krw_unrealized_pl"] == 0.0


def test_unsupported_target_currency_raises():
    """지원하지 않는 target_currency('JPY') → AssertionError 발생"""
    agg = PriceAggregator()
    with pytest.raises(AssertionError, match="지원하지 않는 target_currency"):
        agg.calculate_position_metrics_multicurrency([], {}, {}, 1400.0, "JPY")
