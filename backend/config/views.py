from django.conf import settings
from django.http import FileResponse, Http404
from django.db import connection
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from chord_recognition.dispatch import broker_available


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    """Reports real service status (used by the frontend and Render's health check)."""
    db_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:  # noqa: BLE001
        db_ok = False
    return Response(
        {
            "status": "ok" if db_ok else "degraded",
            "database": {"ok": db_ok, "engine": "postgres" if settings.USING_POSTGRES else "sqlite"},
            "email_configured": settings.EMAIL_CONFIGURED,
            "job_queue": "celery" if broker_available() else "in-process",
        },
        status=200 if db_ok else 503,
    )


def spa(request):
    """Serve the built React app's index.html for client-side routes."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404("The frontend has not been built.")
    response = FileResponse(index.open("rb"), content_type="text/html")
    response["Cache-Control"] = "no-cache"
    return response
