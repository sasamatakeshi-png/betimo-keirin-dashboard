"""認証: 標準ライブラリ hmac による署名トークン（新規依存なし）。

Phase 1 は単一ユーザー想定の最小認証。
- APP_PASSWORD 未設定 → 認証スキップ（開発モード）。
- 署名鍵は APP_PASSWORD から導出（固定シークレット署名）。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

# トークン有効期間（秒）。Phase 1 は 7 日。
TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

# 開発モード（APP_PASSWORD 未設定）でも署名できるフォールバック鍵。
_DEV_FALLBACK_SECRET = "betimo-dev-insecure-secret"

bearer_scheme = HTTPBearer(auto_error=False)


def _signing_secret() -> bytes:
    return (settings.APP_PASSWORD or _DEV_FALLBACK_SECRET).encode("utf-8")


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(payload_b64: str) -> str:
    sig = hmac.new(_signing_secret(), payload_b64.encode("ascii"), hashlib.sha256).digest()
    return _b64e(sig)


def create_token(subject: str = "app", *, now: int | None = None) -> str:
    """署名付きトークンを発行する。"""
    issued = int(time.time()) if now is None else now
    payload = {"sub": subject, "iat": issued, "exp": issued + TOKEN_TTL_SECONDS}
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return f"{payload_b64}.{_sign(payload_b64)}"


def verify_token(token: str, *, now: int | None = None) -> bool:
    """署名と有効期限を検証する。"""
    try:
        payload_b64, sig = token.split(".", 1)
    except ValueError:
        return False
    expected = _sign(payload_b64)
    if not hmac.compare_digest(sig, expected):
        return False
    try:
        payload = json.loads(_b64d(payload_b64))
    except Exception:
        return False
    current = int(time.time()) if now is None else now
    exp = payload.get("exp")
    if not isinstance(exp, int) or current >= exp:
        return False
    return True


def get_current_auth(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """保護ルート用の依存関数。

    APP_PASSWORD 未設定なら認証スキップ。設定済みなら Bearer トークンを検証し、
    失敗時は 401。
    """
    if not settings.APP_PASSWORD:
        return {"authenticated": True, "auth_required": False}

    if creds is None or not verify_token(creds.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or missing token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"authenticated": True, "auth_required": True}
