from django.urls import include, path, re_path

from .views import health, spa

urlpatterns = [
    path("api/health/", health, name="health"),
    path("api/auth/", include("accounts.urls")),
    path("api/songs/", include("songs.urls")),
    path("api/practice/", include("practice.urls")),
    path("api/admin/", include("adminpanel.urls")),
    # Everything else is the React app (client-side routing).
    re_path(r"^(?!api/|static/).*$", spa),
]
