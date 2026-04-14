from sqlalchemy import text
from sqlalchemy.engine import Engine


def ensure_base_currency_column(engine: Engine) -> None:
    """accounts 테이블에 base_currency 컬럼이 없으면 추가. 멱등성 보장."""
    with engine.begin() as conn:
        cols = conn.execute(text("PRAGMA table_info(accounts)")).fetchall()
        names = {row[1] for row in cols}
        if "base_currency" in names:
            return
        conn.execute(text(
            "ALTER TABLE accounts ADD COLUMN base_currency TEXT NOT NULL DEFAULT 'USD'"
        ))
