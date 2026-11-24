import hashlib
import hmac
import secrets

from django.conf import settings
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra):
        if not email:
            raise ValueError("An email address is required.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.update(is_staff=True, is_superuser=True, is_verified=True)
        return self._create_user(email, password, **extra)


def default_preferences():
    return {"show_beat_counter": True, "mic_sensitivity": "normal"}


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    # Public handle, stored lowercase so uniqueness is case-insensitive.
    # Nullable only for accounts created before usernames existed.
    username = models.CharField(max_length=20, unique=True, null=True, blank=True)
    display_name = models.CharField(max_length=60, blank=True)
    is_verified = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    verified_at = models.DateTimeField(null=True, blank=True)
    preferences = models.JSONField(default=default_preferences)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


def _hash_code(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


class EmailCode(models.Model):
    """One-time numeric code sent by email. Only an HMAC of the code is stored."""

    PURPOSE_VERIFY = "verify"
    PURPOSE_CHOICES = [(PURPOSE_VERIFY, "Email verification")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="email_codes")
    purpose = models.CharField(max_length=16, choices=PURPOSE_CHOICES)
    code_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=["user", "purpose", "-created_at"])]

    @classmethod
    def issue(cls, user, purpose):
        """Invalidate earlier codes and create a fresh one. Returns (instance, plaintext_code)."""
        now = timezone.now()
        cls.objects.filter(user=user, purpose=purpose, used_at__isnull=True).update(used_at=now)
        code = f"{secrets.randbelow(1_000_000):06d}"
        instance = cls.objects.create(
            user=user,
            purpose=purpose,
            code_hash=_hash_code(code),
            expires_at=now + timezone.timedelta(minutes=settings.VERIFICATION_CODE_TTL_MINUTES),
        )
        return instance, code

    @property
    def is_expired(self):
        return timezone.now() >= self.expires_at

    def matches(self, code: str) -> bool:
        return hmac.compare_digest(self.code_hash, _hash_code(code))
