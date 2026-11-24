import re

import pytest
from django.core import mail
from django.utils import timezone

from accounts.models import EmailCode, User

from .conftest import csrf, login, make_user

pytestmark = pytest.mark.django_db

STRONG = "Strum-along-42"


def post(client, url, data):
    return client.post(url, data, format="json", HTTP_X_CSRFTOKEN=csrf(client))


def code_from_outbox():
    body = mail.outbox[-1].body
    return re.search(r"\b(\d{6})\b", body).group(1)


def register(client, email="new@example.com", password=STRONG, confirm=None, username="new_player"):
    return post(
        client,
        "/api/auth/register/",
        {"email": email, "username": username, "password": password, "password_confirm": confirm or password},
    )


def test_register_sends_real_email_with_code_and_creates_pending_user(client):
    response = register(client, email="New@Example.com")
    assert response.status_code == 201
    user = User.objects.get(email="new@example.com")
    assert not user.is_verified
    assert user.password != STRONG and user.check_password(STRONG)  # hashed
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == ["new@example.com"]
    assert "Melobud" in message.subject
    assert "expires in 15 minutes" in message.body
    html = message.alternatives[0][0]
    assert code_from_outbox() in html
    # Only a hash of the code is stored.
    assert code_from_outbox() not in EmailCode.objects.get(user=user).code_hash


def test_register_validation(client):
    assert register(client, email="not-an-email").status_code == 400
    r = register(client, password="12345678")
    assert r.status_code == 400 and "password" in r.json()["errors"]
    r = register(client, password=STRONG, confirm=STRONG + "x")
    assert "password_confirm" in r.json()["errors"]


def test_duplicate_verified_email_is_rejected(client, user):
    r = register(client, email=user.email.upper())
    assert r.status_code == 409 and r.json()["code"] == "email_taken"


def test_verify_activates_account_and_logs_in(client):
    register(client)
    code = code_from_outbox()
    r = post(client, "/api/auth/verify/", {"email": "new@example.com", "code": code})
    assert r.status_code == 200 and r.json()["user"]["is_verified"]
    assert client.get("/api/auth/me/").json()["user"]["email"] == "new@example.com"
    # Single use.
    assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": code}).json()["code"] == "already_verified"


def test_wrong_code_attempts_are_limited(client, settings):
    register(client)
    real = code_from_outbox()
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(settings.VERIFICATION_CODE_MAX_ATTEMPTS - 1):
        assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": wrong}).json()["code"] == "invalid_code"
    assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": wrong}).json()["code"] == "too_many_attempts"
    # The real code is now burned too.
    assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": real}).status_code == 400


def test_expired_code_is_rejected(client):
    register(client)
    EmailCode.objects.update(expires_at=timezone.now() - timezone.timedelta(seconds=1))
    r = post(client, "/api/auth/verify/", {"email": "new@example.com", "code": code_from_outbox()})
    assert r.json()["code"] == "invalid_code"


def test_resend_has_cooldown_and_invalidates_old_code(client):
    register(client)
    first = code_from_outbox()
    assert post(client, "/api/auth/resend-code/", {"email": "new@example.com"}).status_code == 429
    EmailCode.objects.update(created_at=timezone.now() - timezone.timedelta(minutes=2))
    assert post(client, "/api/auth/resend-code/", {"email": "new@example.com"}).status_code == 200
    second = code_from_outbox()
    assert len(mail.outbox) == 2
    if first != second:
        assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": first}).status_code == 400
    assert post(client, "/api/auth/verify/", {"email": "new@example.com", "code": second}).status_code == 200


def test_email_not_configured_is_reported_not_faked(client, settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    settings.EMAIL_CONFIGURED = False
    r = register(client)
    assert r.status_code == 503 and r.json()["code"] == "email_not_configured"
    assert len(mail.outbox) == 0
    # No cooldown was started by an email that never left.
    assert not EmailCode.objects.exists()


def test_login_rules(client, user):
    make_user(email="pending@example.com", verified=False)
    assert post(client, "/api/auth/login/", {"login": user.email, "password": "wrong"}).json()["code"] == "invalid_credentials"
    r = post(client, "/api/auth/login/", {"login": "pending@example.com", "password": STRONG})
    assert r.status_code == 403 and r.json()["code"] == "unverified"
    assert post(client, "/api/auth/login/", {"login": user.email.upper(), "password": STRONG}).status_code == 200


def test_protected_endpoints_require_session_and_logout_works(client, user):
    assert client.get("/api/songs/").status_code == 401
    login(client)
    token = client.cookies["csrftoken"].value
    assert client.get("/api/songs/").status_code == 200
    # CSRF is enforced on unsafe requests.
    assert client.post("/api/auth/logout/").status_code == 403
    assert client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code == 204
    assert client.get("/api/songs/").status_code == 401


def test_unverified_session_cannot_use_app(client):
    user = make_user(email="pending@example.com", verified=False)
    client.force_login(user)
    r = client.get("/api/songs/")
    assert r.status_code == 403 and r.json()["code"] == "unverified"


def test_forgot_password_does_not_reveal_accounts(client, user):
    a = post(client, "/api/auth/password/forgot/", {"email": "nobody@example.com"})
    b = post(client, "/api/auth/password/forgot/", {"email": user.email})
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert len(mail.outbox) == 1 and mail.outbox[0].to == [user.email]


def test_password_reset_flow_is_single_use(client, user):
    post(client, "/api/auth/password/forgot/", {"email": user.email})
    link = re.search(r"(http\S+reset-password\?uid=(\S+?)&token=(\S+))", mail.outbox[0].body)
    uid, token = link.group(2), link.group(3)
    new = "Fresh-chords-77"
    r = post(client, "/api/auth/password/reset/", {"uid": uid, "token": token, "password": new, "password_confirm": new})
    assert r.status_code == 200
    user.refresh_from_db()
    assert user.check_password(new)
    again = post(client, "/api/auth/password/reset/", {"uid": uid, "token": token, "password": STRONG, "password_confirm": STRONG})
    assert again.json()["code"] == "invalid_token"
    login(client, password=new)


def test_change_password_and_preferences(authed, user):
    r = authed.post("/api/auth/password/change/", {"current_password": "bad", "new_password": "Another-song-55", "password_confirm": "Another-song-55"}, format="json")
    assert r.json()["code"] == "invalid_password"
    r = authed.post("/api/auth/password/change/", {"current_password": STRONG, "new_password": "Another-song-55", "password_confirm": "Another-song-55"}, format="json")
    assert r.status_code == 200
    assert authed.get("/api/songs/").status_code == 200  # session survives
    r = authed.patch("/api/auth/me/", {"preferences": {"mic_sensitivity": "high"}}, format="json")
    assert r.json()["user"]["preferences"]["mic_sensitivity"] == "high"
    assert r.json()["user"]["preferences"]["show_beat_counter"] is True
    assert authed.patch("/api/auth/me/", {"preferences": {"mic_sensitivity": "weird"}}, format="json").status_code == 400


def test_delete_account_requires_password(authed, user):
    assert authed.delete("/api/auth/me/", {"password": "nope"}, format="json").status_code == 400
    assert authed.delete("/api/auth/me/", {"password": STRONG}, format="json").status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()


def test_login_is_rate_limited(client, user, settings):
    codes = [post(client, "/api/auth/login/", {"login": user.email, "password": "wrong"}).status_code for _ in range(12)]
    assert 429 in codes


# --- usernames -------------------------------------------------------------------
def test_register_stores_lowercase_username(client):
    assert register(client, username="@Strummer_01").status_code == 201
    assert User.objects.get(email="new@example.com").username == "strummer_01"
    assert "Hello strummer_01," in mail.outbox[0].body


@pytest.mark.parametrize("bad", ["ab", "a" * 21, "bad name", "_start", "end.", "double..dot", "admin", "émile"])
def test_register_rejects_invalid_usernames(client, bad):
    r = register(client, username=bad)
    assert r.status_code == 400 and "username" in r.json()["errors"]
    assert not User.objects.exists()


def test_username_must_be_unique_case_insensitively(client, user):
    r = register(client, username=user.username.upper())
    assert r.json()["errors"]["username"] == ["This username is already taken. Please choose another."]


def test_pending_account_can_restart_with_new_username(client):
    register(client, username="first_try")
    EmailCode.objects.update(created_at=timezone.now() - timezone.timedelta(minutes=2))
    assert register(client, username="second_try").status_code == 201
    assert User.objects.get(email="new@example.com").username == "second_try"


def test_username_availability_endpoint(client, user):
    assert client.get("/api/auth/username-available/?username=free_name").json()["available"] is True
    taken = client.get(f"/api/auth/username-available/?username={user.username.upper()}").json()
    assert taken["available"] is False and "taken" in taken["detail"]
    assert client.get("/api/auth/username-available/?username=x").json()["available"] is False


def test_login_with_username(client, user):
    r = post(client, "/api/auth/login/", {"login": "@" + user.username.upper(), "password": STRONG})
    assert r.status_code == 200 and r.json()["user"]["username"] == user.username
    assert post(client, "/api/auth/login/", {"login": "nobody_here", "password": STRONG}).json()["code"] == "invalid_credentials"


def test_change_username(authed, user, other_user):
    assert authed.patch("/api/auth/me/", {"username": other_user.username}, format="json").status_code == 400
    r = authed.patch("/api/auth/me/", {"username": "New.Handle"}, format="json")
    assert r.json()["user"]["username"] == "new.handle"
