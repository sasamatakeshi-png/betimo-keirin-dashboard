"""認証スキーマ。"""

from __future__ import annotations

from pydantic import BaseModel


class LoginRequest(BaseModel):
    password: str


class TokenOut(BaseModel):
    token: str
    token_type: str = "bearer"
    # APP_PASSWORD 未設定時は False（開発モード・認証スキップ）
    auth_required: bool
