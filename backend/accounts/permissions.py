from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission


class IsVerifiedUser(BasePermission):
    """Authenticated *and* email-verified. Default for every API view."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if not user.is_verified:
            raise PermissionDenied(detail="Please verify your email address to continue.", code="unverified")
        return True
