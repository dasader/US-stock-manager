from typing import Literal

Currency = Literal["USD", "KRW"]

TAX_RATES: dict[str, float] = {
    "USD": 0.15,   # 미국 주식 배당 원천징수
    "KRW": 0.154,  # 한국 배당소득세 14% + 지방세 1.4%
}


def apply_withholding_tax(gross: float, currency: str) -> tuple[float, float, float]:
    """(gross, tax_withheld, net) 반환."""
    if currency not in TAX_RATES:
        raise ValueError(f"unknown currency: {currency}")
    rate = TAX_RATES[currency]
    tax = round(gross * rate, 2)
    net = round(gross - tax, 2)
    return gross, tax, net
