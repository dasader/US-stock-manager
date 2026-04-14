import re
from typing import Literal

Market = Literal["KRX", "US"]
_KRX_TICKER_RE = re.compile(r"^\d{6}$")
_GOLD_TICKER = "GOLD"
_GOLD_KRX_CODE = "04020000"


def resolve_market(ticker: str) -> Market:
    t = ticker.strip().upper()
    if t == _GOLD_TICKER or _KRX_TICKER_RE.fullmatch(t):
        return "KRX"
    return "US"


def to_krx_code(ticker: str) -> str:
    """내부 pykrx 조회용 코드 변환. GOLD → 04020000, 나머지는 그대로."""
    t = ticker.strip().upper()
    return _GOLD_KRX_CODE if t == _GOLD_TICKER else t


def validate_ticker_against_account(ticker: str, account_currency: str) -> None:
    market = resolve_market(ticker)
    expected = "KRX" if account_currency == "KRW" else "US"
    if market != expected:
        raise ValueError(
            f"market mismatch: ticker={ticker} resolves to {market}, "
            f"but account currency is {account_currency} (expected {expected})"
        )
