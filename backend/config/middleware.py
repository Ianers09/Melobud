"""Recover from dropped database connections.

Supabase's connection pooler occasionally closes a connection (idle timeouts,
network changes after sleep). The next connection almost always works, so a
read-only request that failed for that reason is retried once on a fresh
connection instead of showing the user an error. Writes are never retried, so
nothing can be saved twice.
"""
import logging

from django.db import OperationalError, connections

logger = logging.getLogger(__name__)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _database_error(response):
    data = getattr(response, "data", None)
    return response.status_code == 503 and isinstance(data, dict) and data.get("code") == "database_error"


class DatabaseRetryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method not in SAFE_METHODS:
            return self.get_response(request)
        try:
            response = self.get_response(request)
            if not _database_error(response):
                return response
        except OperationalError:
            pass
        logger.warning("Database connection lost during %s %s; retrying once", request.method, request.path)
        for conn in connections.all(initialized_only=True):
            conn.close()
        return self.get_response(request)
