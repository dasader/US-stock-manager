from datetime import datetime, time
from zoneinfo import ZoneInfo

_KST = ZoneInfo("Asia/Seoul")
_ET = ZoneInfo("America/New_York")
_UTC = ZoneInfo("UTC")

_KRX_OPEN = time(9, 0)
_KRX_CLOSE = time(15, 30)
_US_OPEN = time(9, 30)
_US_CLOSE = time(16, 0)


def _now_utc() -> datetime:
    return datetime.now(tz=_UTC)


def _is_weekday(dt: datetime) -> bool:
    return dt.weekday() < 5


def is_krx_open() -> bool:
    now_kst = _now_utc().astimezone(_KST)
    if not _is_weekday(now_kst):
        return False
    return _KRX_OPEN <= now_kst.time() <= _KRX_CLOSE


def is_us_open() -> bool:
    now_et = _now_utc().astimezone(_ET)
    if not _is_weekday(now_et):
        return False
    return _US_OPEN <= now_et.time() <= _US_CLOSE
