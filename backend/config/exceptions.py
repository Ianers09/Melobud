"""Consistent JSON error responses for the API."""
import logging

from django.db import DatabaseError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        data = response.data
        if isinstance(data, dict) and "detail" in data and len(data) <= 2:
            payload = {"detail": str(data["detail"])}
            code = getattr(data.get("detail"), "code", None) or data.get("code")
            if code:
                payload["code"] = str(code)
        else:
            payload = {"detail": "Please correct the highlighted fields.", "errors": data}
        response.data = payload
        return response

    if isinstance(exc, DatabaseError):
        logger.exception("Database error")
        return Response(
            {"detail": "The service is temporarily unavailable. Please try again shortly.", "code": "database_error"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    logger.exception("Unhandled API error")
    return Response(
        {"detail": "An unexpected error occurred. Please try again.", "code": "server_error"},
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
