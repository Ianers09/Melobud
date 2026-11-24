from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from songs.storage import delete_user_audio

from .models import record
from .permissions import IsStaff
from .serializers import AdminUserSerializer

PAGE_SIZE = 20


def error(detail, code, http_status=status.HTTP_400_BAD_REQUEST):
    return Response({"detail": detail, "code": code}, status=http_status)


def paginate(request, queryset, serialize):
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except ValueError:
        page = 1
    total = queryset.count()
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, pages)
    items = queryset[(page - 1) * PAGE_SIZE : page * PAGE_SIZE]
    return Response(
        {"count": total, "page": page, "pages": pages, "page_size": PAGE_SIZE, "results": [serialize(i) for i in items]}
    )


def person(user):
    if user is None:
        return None
    return {"id": user.id, "username": user.username, "email": user.email}


class AdminView(APIView):
    permission_classes = [IsStaff]


# --- Users -------------------------------------------------------------------------
USER_FILTERS = {
    "active": Q(is_active=True),
    "inactive": Q(is_active=False),
    "unverified": Q(is_verified=False),
    "staff": Q(is_staff=True),
}
USER_SORTS = {
    "newest": ["-date_joined"],
    "oldest": ["date_joined"],
    "username": ["username", "email"],
    "email": ["email"],
    "last_login": ["-last_login", "-date_joined"],
}


def users_queryset():
    return User.objects.annotate(
        song_count=Count("songs", distinct=True), session_count=Count("practice_sessions", distinct=True)
    )


def as_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


SUPERUSER_LOCKED = "Superuser accounts are protected and cannot be modified from the administration area."


def protect(request, user, data):
    """Return an error Response if this change is not allowed, else None."""
    actor = request.user
    if user.is_superuser:
        return error(SUPERUSER_LOCKED, "protected", status.HTTP_403_FORBIDDEN)
    if "is_staff" in data and as_bool(data["is_staff"]) != user.is_staff and not actor.is_superuser:
        return error("Only a superuser can grant or revoke administrator access.", "forbidden", status.HTTP_403_FORBIDDEN)
    if user.pk == actor.pk:
        if "is_active" in data and not as_bool(data["is_active"]):
            return error("You cannot deactivate your own account.", "self_protection")
        if "is_staff" in data and not as_bool(data["is_staff"]):
            return error("You cannot remove your own administrator access.", "self_protection")
    return None


class UserListView(AdminView):
    def get(self, request):
        qs = users_queryset()
        q = request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(
                Q(email__icontains=q) | Q(username__icontains=q.lstrip("@")) | Q(display_name__icontains=q)
            )
        f = request.query_params.get("filter")
        if f in USER_FILTERS:
            qs = qs.filter(USER_FILTERS[f])
        qs = qs.order_by(*USER_SORTS.get(request.query_params.get("sort"), USER_SORTS["newest"]))
        return paginate(request, qs, lambda u: AdminUserSerializer(u).data)

    def post(self, request):
        serializer = AdminUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.validated_data.get("is_staff") and not request.user.is_superuser:
            return error("Only a superuser can grant administrator access.", "forbidden", status.HTTP_403_FORBIDDEN)
        user = serializer.save()
        if user.is_verified:
            user.verified_at = timezone.now()
            user.save(update_fields=["verified_at"])
        record(request, "user.created", "user", user, label=user.username or user.email)
        return Response(AdminUserSerializer(users_queryset().get(pk=user.pk)).data, status=status.HTTP_201_CREATED)


class UserDetailView(AdminView):
    def get_user(self, pk):
        return get_object_or_404(users_queryset(), pk=pk)

    def get(self, request, pk):
        user = self.get_user(pk)
        data = AdminUserSerializer(user).data
        data["recent_songs"] = [
            {"id": s.id, "title": s.title, "status": s.status, "created_at": s.created_at}
            for s in user.songs.order_by("-created_at")[:5]
        ]
        return Response(data)

    def patch(self, request, pk):
        user = self.get_user(pk)
        blocked = protect(request, user, request.data)
        if blocked:
            return blocked
        fields = ("email", "username", "display_name", "is_active", "is_verified", "is_staff")
        before = {f: getattr(user, f) for f in fields}
        serializer = AdminUserSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        if user.is_verified and not before["is_verified"]:
            user.verified_at = timezone.now()
            user.save(update_fields=["verified_at"])
        changed = sorted(f for f, v in before.items() if getattr(user, f) != v)
        if serializer.validated_data.get("password"):
            changed.append("password")
        if changed:
            record(request, "user.updated", "user", user, label=user.username or user.email, fields=changed)
        return Response(AdminUserSerializer(self.get_user(pk)).data)

    def delete(self, request, pk):
        user = self.get_user(pk)
        if user.is_superuser:
            return error(SUPERUSER_LOCKED, "protected", status.HTTP_403_FORBIDDEN)
        if user.pk == request.user.pk:
            return error("You cannot delete your own account from the administration area.", "self_protection")
        label = user.username or user.email
        with transaction.atomic():
            user.delete()
        delete_user_audio(pk)
        record(request, "user.deleted", "user", None, label=label, id=int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
