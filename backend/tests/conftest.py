import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from accounts.models import User


@pytest.fixture(autouse=True)
def _isolation(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.REDIS_URL = ""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client():
    return APIClient(enforce_csrf_checks=True)


def make_user(email="player@example.com", password="Strum-along-42", verified=True, username=None):
    username = username or email.split("@")[0].replace("-", "_")[:20]
    return User.objects.create_user(email=email, username=username, password=password, is_verified=verified)


@pytest.fixture
def user(db):
    return make_user()


@pytest.fixture
def other_user(db):
    return make_user(email="someone-else@example.com")


def csrf(client):
    client.get("/api/auth/csrf/")
    return client.cookies["csrftoken"].value


def login(client, email="player@example.com", password="Strum-along-42"):
    token = csrf(client)
    response = client.post("/api/auth/login/", {"login": email, "password": password}, format="json", HTTP_X_CSRFTOKEN=token)
    assert response.status_code == 200, response.content
    return client.cookies["csrftoken"].value


@pytest.fixture
def authed(client, user):
    token = login(client)
    client.credentials(HTTP_X_CSRFTOKEN=token)
    return client
