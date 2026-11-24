"""Transactional email. Sends real mail over SMTP; never pretends to succeed."""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


class EmailNotConfigured(Exception):
    pass


class EmailDeliveryFailed(Exception):
    pass


def _send(to, subject, template, context):
    # The Django test runner swaps EMAIL_BACKEND for the in-memory backend, so
    # tests exercise the real code path without SMTP.
    if not settings.EMAIL_CONFIGURED and "locmem" not in settings.EMAIL_BACKEND:
        raise EmailNotConfigured("SMTP is not configured on the server.")
    context = {"frontend_url": settings.FRONTEND_URL, **context}
    text = render_to_string(f"email/{template}.txt", context)
    html = render_to_string(f"email/{template}.html", context)
    message = EmailMultiAlternatives(subject, text, settings.DEFAULT_FROM_EMAIL, [to])
    message.attach_alternative(html, "text/html")
    try:
        sent = message.send(fail_silently=False)
    except Exception as exc:  # noqa: BLE001 - SMTP errors come in many shapes
        logger.error("Email delivery to %s failed: %s", to, exc.__class__.__name__)
        raise EmailDeliveryFailed(str(exc)) from exc
    if sent != 1:
        raise EmailDeliveryFailed("The mail server did not accept the message.")


def send_verification_code(user, code):
    _send(
        user.email,
        f"Your Melobud verification code is {code}",
        "verify_code",
        {"code": code, "minutes": settings.VERIFICATION_CODE_TTL_MINUTES, "username": user.username},
    )


def send_password_reset(user, link):
    _send(
        user.email,
        "Reset your Melobud password",
        "password_reset",
        {"link": link, "minutes": settings.PASSWORD_RESET_TIMEOUT // 60, "username": user.username},
    )
