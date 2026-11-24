from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import User
from accounts.serializers import EmailField, UsernameField, normalize_username, username_problem


class AdminUserSerializer(serializers.ModelSerializer):
    email = EmailField(max_length=254)
    username = UsernameField()
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=128, trim_whitespace=False)
    songs = serializers.IntegerField(read_only=True, source="song_count", default=0)
    sessions = serializers.IntegerField(read_only=True, source="session_count", default=0)

    class Meta:
        model = User
        fields = [
            "id", "email", "username", "display_name", "is_active", "is_verified", "is_staff", "is_superuser",
            "date_joined", "last_login", "songs", "sessions", "password",
        ]
        read_only_fields = ["id", "is_superuser", "date_joined", "last_login"]

    def validate_email(self, value):
        taken = User.objects.filter(email__iexact=value)
        if self.instance:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("An account with this email address already exists.")
        return value

    def validate_username(self, value):
        value = normalize_username(value)
        if self.instance and value == self.instance.username:
            return value
        problem = username_problem(value, exclude_user=self.instance)
        if problem:
            raise serializers.ValidationError(problem)
        return value

    def validate_display_name(self, value):
        return value.strip()

    def validate(self, attrs):
        password = attrs.get("password")
        if not self.instance and not password:
            raise serializers.ValidationError({"password": ["A password is required."]})
        if password:
            candidate = self.instance or User(email=attrs.get("email", ""), username=attrs.get("username", ""))
            try:
                password_validation.validate_password(password, candidate)
            except DjangoValidationError as exc:
                raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated):
        password = validated.pop("password")
        return User.objects.create_user(password=password, **validated)

    def update(self, user, validated):
        password = validated.pop("password", None)
        for field, value in validated.items():
            setattr(user, field, value)
        if password:
            user.set_password(password)
        user.save()
        return user
