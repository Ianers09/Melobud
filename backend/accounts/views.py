import logging

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.tokens import default_token_generator
from django.db import transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from django.views.decorators.csrf import ensure_csrf_cookie
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from songs.storage import delete_user_audio

from . import emails
from .models import EmailCode, User
from .serializers import (
    normalize_username,
    username_problem,
    ChangePasswordSerializer,
    DeleteAccountSerializer,
    EmailOnlySerializer,
    LoginSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    UserSerializer,
    VerifySerializer,
)

logger = logging.getLogger(__name__)


def error(detail, code, http_status=status.HTTP_400_BAD_REQUEST, **extra):
    return Response({"detail": detail, "code": code, **extra}, status=http_status)


def send_code_or_error(user):
    """Issue a fresh verification code and email it. Returns an error Response or None."""
    record, code = EmailCode.issue(user, EmailCode.PURPOSE_VERIFY)
    try:
        emails.send_verification_code(user, code)
    except emails.EmailNotConfigured:
        # A code that never left the server must not start the resend cooldown.
        record.delete()
        return error(
            "The email service is not available at the moment. Please try again later.",
            "email_not_configured",
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    except emails.EmailDeliveryFailed:
        record.delete()
        return error(
            "The verification email could not be sent. Please try again in a few minutes.",
            "email_failed",
            status.HTTP_502_BAD_GATEWAY,
        )
    return None


def resend_cooldown_remaining(user):
    latest = EmailCode.objects.filter(user=user, purpose=EmailCode.PURPOSE_VERIFY).order_by("-created_at").first()
    if not latest:
        return 0
    elapsed = (timezone.now() - latest.created_at).total_seconds()
    return max(0, int(settings.VERIFICATION_RESEND_COOLDOWN_SECONDS - elapsed))


class PublicView(APIView):
    permission_classes = [AllowAny]


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(PublicView):
    authentication_classes = []

    def get(self, request):
        return Response({"detail": "ok"})


class MeView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return super().get_permissions()

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"user": None})
        return Response({"user": UserSerializer(request.user).data})

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"user": serializer.data})

    def delete(self, request):
        serializer = DeleteAccountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["password"]):
            return error("The password you entered is incorrect.", "invalid_password")
        user_id = user.pk
        logout(request)
        user.delete()
        delete_user_audio(user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RegisterView(PublicView):
    throttle_scope = "auth_register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        username = serializer.validated_data["username"]
        password = serializer.validated_data["password"]

        existing = User.objects.filter(email__iexact=email).first()
        problem = username_problem(username, exclude_user=existing if existing and not existing.is_verified else None)
        if problem:
            return Response(
                {"detail": "Please correct the highlighted fields.", "errors": {"username": [problem]}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if existing and existing.is_verified:
            return error(
                "An account with this email address already exists. Please sign in instead.",
                "email_taken",
                status.HTTP_409_CONFLICT,
            )
        if existing:
            # Pending (unverified) account: let the person restart sign-up.
            wait = resend_cooldown_remaining(existing)
            if wait:
                return error(
                    f"A verification code was recently sent to this address. You can request a new code in {wait} seconds.",
                    "cooldown",
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=wait,
                )
            existing.set_password(password)
            existing.username = username
            existing.save(update_fields=["password", "username"])
            user = existing
        else:
            with transaction.atomic():
                user = User.objects.create_user(email=email, username=username, password=password, is_verified=False)

        failure = send_code_or_error(user)
        if failure:
            failure.data["email"] = user.email
            return failure
        return Response(
            {"detail": "A 6-digit verification code has been sent to your email address.", "email": user.email},
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(PublicView):
    throttle_scope = "auth_code"

    def post(self, request):
        serializer = VerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        code = serializer.validated_data["code"]
        invalid = error("The verification code is invalid or has expired. Please request a new code.", "invalid_code")

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return invalid
        if user.is_verified:
            return error("This email address has already been verified. Please sign in.", "already_verified")

        with transaction.atomic():
            record = (
                EmailCode.objects.select_for_update()
                .filter(user=user, purpose=EmailCode.PURPOSE_VERIFY, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if not record or record.is_expired:
                return invalid
            if not record.matches(code):
                record.attempts += 1
                if record.attempts >= settings.VERIFICATION_CODE_MAX_ATTEMPTS:
                    record.used_at = timezone.now()
                    record.save(update_fields=["attempts", "used_at"])
                    return error("Too many incorrect attempts. Please request a new verification code.", "too_many_attempts")
                record.save(update_fields=["attempts"])
                return error("The verification code is incorrect. Please check the code and try again.", "invalid_code")
            record.used_at = timezone.now()
            record.save(update_fields=["used_at"])
            user.is_verified = True
            user.verified_at = timezone.now()
            user.save(update_fields=["is_verified", "verified_at"])

        login(request, user, backend="django.contrib.auth.backends.ModelBackend")
        return Response({"user": UserSerializer(user).data})


class ResendCodeView(PublicView):
    throttle_scope = "auth_email"

    def post(self, request):
        serializer = EmailOnlySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.filter(email__iexact=serializer.validated_data["email"], is_verified=False).first()
        generic = Response({"detail": "If this account is awaiting verification, a new code has been sent."})
        if not user:
            return generic
        wait = resend_cooldown_remaining(user)
        if wait:
            return error(
                f"Please wait {wait} seconds before requesting another code.",
                "cooldown",
                status.HTTP_429_TOO_MANY_REQUESTS,
                retry_after=wait,
            )
        return send_code_or_error(user) or generic


class LoginView(PublicView):
    throttle_scope = "auth_login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # "@name" is a username; anything else containing "@" is an email.
        identifier = serializer.validated_data["login"].strip()
        if "@" in identifier[1:]:
            email = identifier.lower()
        else:
            match = User.objects.filter(username=normalize_username(identifier)).only("email").first()
            email = match.email if match else None
        user = None
        if email:
            user = authenticate(request, username=email, password=serializer.validated_data["password"])
        if user is None:
            return error(
                "The email, username, or password is incorrect.", "invalid_credentials", status.HTTP_400_BAD_REQUEST
            )
        if not user.is_verified:
            return error(
                "Please verify your email address before signing in.",
                "unverified",
                status.HTTP_403_FORBIDDEN,
                email=user.email,
            )
        login(request, user)
        return Response({"user": UserSerializer(user).data})


class UsernameAvailableView(PublicView):
    throttle_scope = "auth_code"

    def get(self, request):
        value = normalize_username(request.query_params.get("username", ""))
        exclude = request.user if request.user.is_authenticated else None
        problem = username_problem(value, exclude_user=exclude)
        return Response({"username": value, "available": problem is None, "detail": problem})


class LogoutView(PublicView):
    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ForgotPasswordView(PublicView):
    throttle_scope = "auth_email"

    def post(self, request):
        serializer = EmailOnlySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        generic = Response(
            {"detail": "If an account exists for this email address, a password reset link has been sent."}
        )
        user = User.objects.filter(email__iexact=serializer.validated_data["email"], is_active=True).first()
        if not user:
            return generic
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"
        try:
            emails.send_password_reset(user, link)
        except emails.EmailNotConfigured:
            # This is a server configuration problem, not account information.
            return error(
                "The email service is not available at the moment. Please try again later.",
                "email_not_configured",
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except emails.EmailDeliveryFailed:
            logger.warning("Password reset email failed for user %s", user.pk)
            # Responding identically avoids revealing that the account exists.
        return generic


class ResetPasswordView(PublicView):
    throttle_scope = "auth_code"

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        invalid = error("This password reset link is invalid or has expired. Please request a new link.", "invalid_token")
        try:
            user = User.objects.get(pk=force_str(urlsafe_base64_decode(data["uid"])))
        except (User.DoesNotExist, ValueError, TypeError, OverflowError):
            return invalid
        # Token embeds the password hash + last login, so it is single-use.
        if not default_token_generator.check_token(user, data["token"]):
            return invalid
        user.set_password(data["password"])
        if not user.is_verified:
            # Receiving the reset email proves ownership of the address.
            user.is_verified = True
            user.verified_at = timezone.now()
        user.save()
        return Response({"detail": "Your password has been updated. You can now sign in."})


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "auth_code"

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, user=request.user)
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(serializer.validated_data["current_password"]):
            return error("The current password you entered is incorrect.", "invalid_password")
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response({"detail": "Your password has been updated."})
