from django.db import OperationalError
from django.http import HttpResponse
from django.test import RequestFactory
from rest_framework.response import Response

from config.middleware import DatabaseRetryMiddleware


def flaky(first):
    calls = []

    def get_response(request):
        calls.append(request.method)
        if len(calls) == 1:
            if isinstance(first, Exception):
                raise first
            return first
        return HttpResponse("ok")

    return get_response, calls


def test_read_request_is_retried_after_a_dropped_connection():
    dropped = Response({"detail": "unavailable", "code": "database_error"}, status=503)
    for first in (dropped, OperationalError("server closed the connection unexpectedly")):
        get_response, calls = flaky(first)
        response = DatabaseRetryMiddleware(get_response)(RequestFactory().get("/api/songs/"))
        assert response.status_code == 200 and len(calls) == 2


def test_writes_and_other_errors_are_not_retried():
    dropped = Response({"detail": "unavailable", "code": "database_error"}, status=503)
    get_response, calls = flaky(dropped)
    response = DatabaseRetryMiddleware(get_response)(RequestFactory().post("/api/songs/"))
    assert response.status_code == 503 and len(calls) == 1

    get_response, calls = flaky(Response({"detail": "nope"}, status=404))
    response = DatabaseRetryMiddleware(get_response)(RequestFactory().get("/api/songs/1/"))
    assert response.status_code == 404 and len(calls) == 1
