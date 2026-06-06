"""アプリケーション設定。

.env から設定値を読み込む（pydantic-settings）。
実際の値はリポジトリにコミットしない。`.env.example` を参照。
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # PostgreSQL 接続文字列
    # 例: postgresql+psycopg://user:password@host:5432/dbname
    DATABASE_URL: str = ""

    # Phase 1 の環境変数パスワード認証で使用
    APP_PASSWORD: str = ""

    # Anthropic API キー（AI 層で使用）
    ANTHROPIC_API_KEY: str = ""

    # AI 分析で使用する Claude モデル（既定は最新 Opus。env で上書き可）
    ANALYSIS_MODEL: str = "claude-opus-4-8"

    # フロントエンドの許可オリジン（CORS）
    FRONTEND_ORIGIN: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """設定のシングルトンを返す（キャッシュ）。"""
    return Settings()


settings = get_settings()
