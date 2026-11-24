from django.conf import settings
from django.db import models


class AuditEntry(models.Model):
    """One administrative action, kept for accountability."""

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    actor_label = models.CharField(max_length=254)
    action = models.CharField(max_length=40)
    target_type = models.CharField(max_length=20)
    target_id = models.PositiveBigIntegerField(null=True)
    target_label = models.CharField(max_length=254, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]


def record(request, action, target_type, target=None, label="", **details):
    AuditEntry.objects.create(
        actor=request.user,
        actor_label=request.user.username or request.user.email,
        action=action,
        target_type=target_type,
        target_id=getattr(target, "pk", None),
        target_label=label or (str(target) if target is not None else ""),
        details=details,
    )
