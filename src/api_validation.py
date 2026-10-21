"""Input validation for the HTTP API: bad requests get a clear 400, never a crash (500) or a silent no-op.

- ``validated(handler)`` wraps a route: malformed JSON or a non-object body is a 400, and so is any
  ValueError/TypeError/KeyError/IndexError raised while reading the request (``float("abc")``, a missing key...).
- ``num`` / ``one_of`` / ``require_text`` are small helpers that handlers use to read a field and range-check it.
"""

import functools
import json
import logging
import math
from typing import Any, Iterable, Optional

from starlette.responses import JSONResponse

logger = logging.getLogger("litwave.api")


class ApiError(ValueError):
    """The request is invalid: answered with HTTP 400 and this message."""


def bad_request(message: str) -> JSONResponse:
    return JSONResponse({"success": False, "error": message}, status_code=400)


def num(value: Any, name: str, lo: Optional[float] = None, hi: Optional[float] = None, integer: bool = False):
    """Coerce a request value to a float (or int) and range-check it. Strings like "5" are accepted, as before."""
    if value is None or isinstance(value, (bool, dict, list)):
        raise ApiError(f"{name} must be a number")
    try:
        out = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"{name} must be a number")
    if math.isnan(out) or math.isinf(out):
        raise ApiError(f"{name} must be a finite number")
    if integer:
        if out != int(out):
            raise ApiError(f"{name} must be a whole number")
        out = int(out)
    if lo is not None and out < lo:
        raise ApiError(f"{name} must be at least {lo:g}")
    if hi is not None and out > hi:
        raise ApiError(f"{name} must be at most {hi:g}")
    return out


def one_of(value: Any, allowed: Iterable[Any], name: str):
    allowed = list(allowed)
    if value not in allowed:
        raise ApiError(f"{name} must be one of: {', '.join(str(a) for a in allowed)}")
    return value


def require_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{name} must be a non-empty string")
    return value


def validated(handler):
    """Wrap an async route handler so invalid input becomes a JSON 400."""

    @functools.wraps(handler)
    async def wrapper(request):
        if request.method in ("POST", "PUT", "PATCH") and "multipart" not in request.headers.get("content-type", "").lower():
            raw = await request.body()
            if raw.strip():
                try:
                    parsed = json.loads(raw)
                except ValueError:
                    return bad_request("Request body is not valid JSON")
                if not isinstance(parsed, dict):
                    return bad_request("Request body must be a JSON object")
        try:
            return await handler(request)
        except (ValueError, TypeError, KeyError, IndexError) as exc:
            logger.warning("Rejected %s %s: %s: %s", request.method, request.url.path, type(exc).__name__, exc)
            message = str(exc) if isinstance(exc, ApiError) else f"Invalid request: {type(exc).__name__}: {exc}"
            return bad_request(message)

    return wrapper
