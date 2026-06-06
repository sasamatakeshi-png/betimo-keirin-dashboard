"""SQLAlchemy の engine / session 設定。

DATABASE_URL は .env から読み込む（app.core.config 経由）。
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

# DATABASE_URL が未設定の場合でも import 時にクラッシュさせない。
# 実際の接続は最初のクエリ時に評価される。
engine = create_engine(
    settings.DATABASE_URL or "postgresql+psycopg://",
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


class Base(DeclarativeBase):
    """SQLAlchemy 宣言的モデルの基底クラス。"""


def get_db() -> Generator[Session, None, None]:
    """FastAPI 依存性注入用の DB セッションジェネレータ。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
