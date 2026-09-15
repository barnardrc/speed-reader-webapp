from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request, status

from ..config import TRUST_PROXY_IP_HEADERS


class InMemoryRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, *, max_requests: int, window_seconds: int) -> bool:
        now = time.time()
        cutoff = now - window_seconds

        with self._lock:
            queue = self._events[key]
            while queue and queue[0] < cutoff:
                queue.popleft()

            if len(queue) >= max_requests:
                return False

            queue.append(now)
            return True


rate_limiter = InMemoryRateLimiter()


def get_client_ip(request: Request) -> str:
    if TRUST_PROXY_IP_HEADERS:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def enforce_rate_limit(
    *,
    key: str,
    max_requests: int,
    window_seconds: int,
    detail: str = "Too many requests. Please retry shortly.",
) -> None:
    allowed = rate_limiter.allow(key, max_requests=max_requests, window_seconds=window_seconds)
    if allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(window_seconds)},
    )
