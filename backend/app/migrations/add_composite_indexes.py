from sqlalchemy import text
from sqlalchemy.engine import Engine


def add_composite_indexes(engine: Engine) -> None:
    """복합 인덱스 생성 (기존 DB 대응) — CREATE INDEX IF NOT EXISTS 사용"""
    ddl_statements = [
        "CREATE INDEX IF NOT EXISTS idx_trade_account_ticker   ON trades(account_id, ticker)",
        "CREATE INDEX IF NOT EXISTS idx_trade_account_date     ON trades(account_id, trade_date)",
        "CREATE INDEX IF NOT EXISTS idx_cash_account_date      ON cash(account_id, transaction_date)",
        "CREATE INDEX IF NOT EXISTS idx_snapshot_account_date  ON daily_snapshots(account_id, snapshot_date)",
    ]
    with engine.connect() as conn:
        for stmt in ddl_statements:
            conn.execute(text(stmt))
        conn.commit()
