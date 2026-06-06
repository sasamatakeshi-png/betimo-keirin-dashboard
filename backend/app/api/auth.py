"""認証エンドポイント。"""

from __future__ import annotations

import hmac

from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.core.security import create_token
from app.schemas.auth import LoginRequest, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest) -> TokenOut:
    # 開発モード: パスワード未設定なら誰でもトークンを取得できる（認証スキップ運用）
    if not settings.APP_PASSWORD:
        return TokenOut(token=create_token(), auth_required=False)

    if not hmac.compare_digest(body.password, settings.APP_PASSWORD):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid password",
        )
    return TokenOut(token=create_token(), auth_required=True)
