import re

from django.contrib.auth import password_validation
from rest_framework import serializers

from .models import User

USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_.]{1,18})[a-z0-9]$")
RESERVED_USERNAMES = {
    "admin", "administrator", "root", "system", "support", "help", "melobud", "staff",
    "api", "auth", "login", "logout", "register", "settings", "profile", "null", "undefined",
}


def normalize_username(value):
    return (value or "").strip().lstrip("@").lower()


def username_problem(value, exclude_user=None):
    """Returns an error message, or None if the username can be used."""
    if not 3 <= len(value) <= 20:
        return "Username must be between 3 and 20 characters."
    if not USERNAME_RE.match(value) or ".." in value:
        return "Username may contain only letters, numbers, periods, and underscores, and must start and end with a letter or number."
    if value in RESERVED_USERNAMES:
        return "This username is reserved. Please choose another."
    taken = User.objects.filter(username=value)
    if exclude_user is not None:
        taken = taken.exclude(pk=exclude_user.pk)
    if taken.exists():
        return "This username is already taken. Please choose another."
    return None


class UsernameField(serializers.CharField):
    def __init__(self, **kwargs):
        kwargs.setdefault("max_length", 40)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        return normalize_username(super().to_internal_value(data))

MIC_SENSITIVITY_CHOICES = {"low", "normal", "high"}


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "username", "display_name", "is_verified", "is_staff", "is_superuser", "date_joined", "preferences"]
        read_only_fields = ["id", "email", "is_verified", "is_staff", "is_superuser", "date_joined"]

    def validate_username(self, value):
        value = normalize_username(value)
        problem = username_problem(value, exclude_user=self.instance)
        if problem:
            raise serializers.ValidationError(problem)
        return value

    def validate_display_name(self, value):
        return value.strip()

    def validate_preferences(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Preferences must be an object.")
        current = dict(self.instance.preferences) if self.instance else {}
        if "show_beat_counter" in value:
            if not isinstance(value["show_beat_counter"], bool):
                raise serializers.ValidationError("show_beat_counter must be true or false.")
            current["show_beat_counter"] = value["show_beat_counter"]
        if "mic_sensitivity" in value:
            if value["mic_sensitivity"] not in MIC_SENSITIVITY_CHOICES:
                raise serializers.ValidationError("mic_sensitivity must be low, normal or high.")
            current["mic_sensitivity"] = value["mic_sensitivity"]
        return current


class EmailField(serializers.EmailField):
    def to_internal_value(self, data):
        return super().to_internal_value(data).strip().lower()


class PasswordPairMixin:
    password_field = "password"

    def validate(self, attrs):
        password = attrs[self.password_field]
        if password != attrs.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": ["The passwords do not match."]})
        user = getattr(self, "_user_for_validation", None) or User(
            email=attrs.get("email", ""), username=attrs.get("username", "")
        )
        try:
            password_validation.validate_password(password, user)
        except Exception as exc:  # django ValidationError
            raise serializers.ValidationError({self.password_field: list(exc.messages)}) from exc
        return attrs


class RegisterSerializer(PasswordPairMixin, serializers.Serializer):
    email = EmailField(max_length=254)
    username = UsernameField()
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)


class VerifySerializer(serializers.Serializer):
    email = EmailField()
    code = serializers.RegexField(r"^\d{6}$", error_messages={"invalid": "Enter the 6-digit code sent to your email address."})


class EmailOnlySerializer(serializers.Serializer):
    email = EmailField()


class LoginSerializer(serializers.Serializer):
    # Email address or username.
    login = serializers.CharField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)


class ResetPasswordSerializer(PasswordPairMixin, serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)
    password_confirm = serializers.CharField(write_only=True, max_length=128, trim_whitespace=False)


class ChangePasswordSerializer(PasswordPairMixin, serializers.Serializer):
    password_field = "new_password"
    current_password = serializers.CharField(max_length=128, trim_whitespace=False)
    new_password = serializers.CharField(max_length=128, trim_whitespace=False)
    password_confirm = serializers.CharField(max_length=128, trim_whitespace=False)

    def __init__(self, *args, user=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._user_for_validation = user


class DeleteAccountSerializer(serializers.Serializer):
    password = serializers.CharField(max_length=128, trim_whitespace=False)
