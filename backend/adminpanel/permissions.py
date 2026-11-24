from accounts.permissions import IsVerifiedUser


class IsStaff(IsVerifiedUser):
    """Verified *and* staff. Non-staff get 403 with a clear message."""

    message = "You do not have permission to access the administration area."

    def has_permission(self, request, view):
        return super().has_permission(request, view) and bool(request.user.is_staff)
