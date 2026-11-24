import pytest
from rest_framework.test import APIClient

from accounts.models import User
from adminpanel.models import AuditEntry

from .conftest import login, make_user

pytestmark = pytest.mark.django_db
PASSWORD = "Strum-along-42"


def client_for(user):
    client = APIClient(enforce_csrf_checks=True)
    client.credentials(HTTP_X_CSRFTOKEN=login(client, user.email, PASSWORD))
    return client


@pytest.fixture
def superuser(db):
    return User.objects.create_superuser(email="root@example.com", username="boss", password=PASSWORD)


@pytest.fixture
def admin(superuser):
    return client_for(superuser)


def test_non_staff_cannot_use_admin_api(authed):
    assert authed.get("/api/admin/users/").status_code == 403
    assert APIClient().get("/api/admin/users/").status_code in (401, 403)


def test_me_reports_staff_flags(admin):
    me = admin.get("/api/auth/me/").json()
    me = me.get("user", me)
    assert me["is_staff"] is True and me["is_superuser"] is True


def test_user_crud_and_audit(admin, user):
    r = admin.post(
        "/api/admin/users/",
        {"email": "New@Example.com", "username": "newbie", "password": "Another-pass-77", "is_verified": True},
        format="json",
    )
    assert r.status_code == 201, r.content
    created = r.json()
    assert created["email"] == "new@example.com" and created["is_verified"] and "password" not in created
    assert User.objects.get(pk=created["id"]).check_password("Another-pass-77")

    # Validation: duplicate email, weak password, missing password.
    assert admin.post("/api/admin/users/", {"email": "new@example.com", "username": "x_y_z", "password": "Another-pass-77"}, format="json").status_code == 400
    assert "password" in admin.post("/api/admin/users/", {"email": "a@b.com", "username": "abcde", "password": "123"}, format="json").json()["errors"]
    assert "password" in admin.post("/api/admin/users/", {"email": "c@d.com", "username": "cdefg"}, format="json").json()["errors"]

    listing = admin.get("/api/admin/users/?q=newbie").json()
    assert listing["count"] == 1 and listing["results"][0]["username"] == "newbie"
    assert admin.get("/api/admin/users/?filter=staff").json()["count"] == 1

    r = admin.patch(f"/api/admin/users/{user.id}/", {"is_active": False, "display_name": " Pat ", "password": "Brand-new-pw-9"}, format="json")
    assert r.status_code == 200, r.content
    user.refresh_from_db()
    assert not user.is_active and user.display_name == "Pat" and user.check_password("Brand-new-pw-9")

    assert admin.delete(f"/api/admin/users/{created['id']}/").status_code == 204
    assert not User.objects.filter(pk=created["id"]).exists()

    actions = list(AuditEntry.objects.order_by("created_at").values_list("action", flat=True))
    assert actions == ["user.created", "user.updated", "user.deleted"]
    updated = AuditEntry.objects.get(action="user.updated")
    assert set(updated.details["fields"]) == {"display_name", "is_active", "password"}


def test_deactivated_user_cannot_sign_in(admin, user):
    admin.patch(f"/api/admin/users/{user.id}/", {"is_active": False}, format="json")
    client = APIClient(enforce_csrf_checks=True)
    from .conftest import csrf

    token = csrf(client)
    r = client.post("/api/auth/login/", {"login": user.email, "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token)
    assert r.status_code != 200


def make_staff(email="helper@example.com"):
    staff = make_user(email=email)
    staff.is_staff = True
    staff.save()
    return staff


def test_superuser_accounts_are_protected(admin, superuser):
    staff_client = client_for(make_staff())
    for client in (admin, staff_client):  # not even the superuser themselves
        url = f"/api/admin/users/{superuser.id}/"
        assert client.patch(url, {"display_name": "x"}, format="json").json()["code"] == "protected"
        assert client.delete(url).json()["code"] == "protected"
    superuser.refresh_from_db()
    assert superuser.display_name == "" and User.objects.filter(pk=superuser.id).exists()


def test_admin_cannot_lock_themselves_out(superuser):
    staff = make_staff()
    client = client_for(staff)
    url = f"/api/admin/users/{staff.id}/"
    assert client.patch(url, {"is_active": False}, format="json").json()["code"] == "self_protection"
    assert client.delete(url).json()["code"] == "self_protection"
    staff.refresh_from_db()
    assert staff.is_active and staff.is_staff


def test_only_superusers_grant_admin_access(admin, user):
    client = client_for(make_staff())
    assert client.patch(f"/api/admin/users/{user.id}/", {"is_staff": True}, format="json").status_code == 403
    assert client.patch(f"/api/admin/users/{user.id}/", {"is_verified": False}, format="json").status_code == 200
    assert admin.patch(f"/api/admin/users/{user.id}/", {"is_staff": True}, format="json").status_code == 200


def test_pagination(admin):
    for i in range(23):
        make_user(email=f"user{i}@example.com", username=f"user{i:02d}")
    first = admin.get("/api/admin/users/?sort=username").json()
    assert first["count"] == 24 and first["pages"] == 2 and len(first["results"]) == 20
    second = admin.get("/api/admin/users/?sort=username&page=2").json()
    assert len(second["results"]) == 4
    assert admin.get("/api/admin/users/?page=99").json()["page"] == 2
