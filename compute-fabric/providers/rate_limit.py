"""Sliding-window rate limiter.

Used by adapters whose upstream publishes a hard request ceiling. Keeping it
here rather than inside one adapter means the next metered API gets the same
enforcement instead of its own approximation.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable


class RateLimitExceeded(RuntimeError):
    """The configured ceiling would be breached by this call."""


class RateLimiter:
    def __init__(
        self,
        max_calls: int,
        per_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if max_calls < 1:
            raise ValueError("max_calls must be at least 1")
        if per_seconds <= 0:
            raise ValueError("per_seconds must be positive")
        self._max_calls = max_calls
        self._per_seconds = per_seconds
        self._clock = clock
        self._calls: deque[float] = deque()
        self._lock = threading.Lock()

    def acquire(self) -> None:
        """Record a call, or raise if it would breach the window."""
        with self._lock:
            now = self._clock()
            while self._calls and now - self._calls[0] >= self._per_seconds:
                self._calls.popleft()
            if len(self._calls) >= self._max_calls:
                raise RateLimitExceeded(
                    f"{self._max_calls} calls per {self._per_seconds:g}s ceiling reached"
                )
            self._calls.append(now)
