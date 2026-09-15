from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from ..config import JWT_SECRET_KEY, MASTER_ENCRYPTION_KEY, MASTER_ENCRYPTION_KEY_FALLBACKS


def _legacy_jwt_derived_key() -> bytes:
    derived = hashlib.sha256(JWT_SECRET_KEY.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(derived)


def _resolve_fernet_keys() -> list[bytes]:
    keys: list[bytes] = []
    seen: set[bytes] = set()

    def _add(candidate: str | bytes) -> None:
        encoded = candidate.encode("utf-8") if isinstance(candidate, str) else candidate
        if not encoded or encoded in seen:
            return
        Fernet(encoded)
        seen.add(encoded)
        keys.append(encoded)

    if MASTER_ENCRYPTION_KEY:
        _add(MASTER_ENCRYPTION_KEY)
        for fallback_key in MASTER_ENCRYPTION_KEY_FALLBACKS:
            _add(fallback_key)
        # Compatibility path for credentials encrypted before MASTER_ENCRYPTION_KEY was introduced.
        _add(_legacy_jwt_derived_key())
    else:
        _add(_legacy_jwt_derived_key())

    return keys


class CryptoService:
    def __init__(self) -> None:
        keys = _resolve_fernet_keys()
        self._primary_fernet = Fernet(keys[0])
        self._fallback_fernets = [Fernet(key) for key in keys[1:]]

    def encrypt(self, value: str) -> str:
        token = self._primary_fernet.encrypt(value.encode("utf-8"))
        return token.decode("utf-8")

    def decrypt(self, token: str) -> str:
        token_bytes = token.encode("utf-8")
        try:
            raw = self._primary_fernet.decrypt(token_bytes)
            return raw.decode("utf-8")
        except InvalidToken:
            pass

        for fallback in self._fallback_fernets:
            try:
                raw = fallback.decrypt(token_bytes)
                return raw.decode("utf-8")
            except InvalidToken:
                continue

        raise ValueError(
            "Unable to decrypt stored credential. Restore the original encryption key "
            "or re-save this provider key."
        )
