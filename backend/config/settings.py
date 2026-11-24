"""Django settings for the Melobud backend.

All secrets and environment-specific values come from environment variables
(loaded from backend/.env in local development). See .env.example.
"""
import os
import sys
from datetime import timedelta  # noqa: F401  (kept for readability of time settings)
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


TESTING = "test" in sys.argv or "pytest" in sys.modules

DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG or TESTING:
        SECRET_KEY = "insecure-local-development-key-change-me"
    else:
        raise RuntimeError("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is false.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "127.0.0.1,localhost")
# Render sets RENDER_EXTERNAL_HOSTNAME (e.g. melobud.onrender.com) automatically.
RENDER_HOST = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
if RENDER_HOST:
    ALLOWED_HOSTS.append(RENDER_HOST)

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "accounts",
    "songs",
    "chord_recognition",
    "practice",
    "audio_engine",
    "adminpanel",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database (Supabase Postgres) -------------------------------------------
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
# The test suite never touches the real (Supabase) database: it uses a
# throwaway SQLite database unless TEST_DATABASE_URL is set explicitly.
if TESTING:
    DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=int(os.environ.get("DB_CONN_MAX_AGE", "60")),
            conn_health_checks=True,
            ssl_require=env_bool("DB_SSL_REQUIRE", True),
        )
    }
    # Supabase's transaction pooler (port 6543) does not support server-side
    # cursors or prepared statements.
    if env_bool("DB_TRANSACTION_POOLER", False):
        DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
        DATABASES["default"].setdefault("OPTIONS", {})["prepare_threshold"] = None
    USING_POSTGRES = True
else:
    # Used by the test suite, and as a fallback when no DATABASE_URL is set.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "local-dev.sqlite3",
        }
    }
    USING_POSTGRES = False

AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# In production the built React app (frontend/dist) is served by Django itself,
# so the site and the API share one origin (session cookies stay first-party).
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.is_dir() else None
WHITENOISE_MAX_AGE = 3600
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Sessions / CSRF ----------------------------------------------------------
# The React dev server proxies /api to Django, so cookies are same-origin.
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("COOKIE_SECURE", not DEBUG)
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = env_bool("COOKIE_SECURE", not DEBUG)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
if RENDER_HOST:
    CSRF_TRUSTED_ORIGINS.append(f"https://{RENDER_HOST}")
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_ALLOW_CREDENTIALS = True

# --- Uploads ------------------------------------------------------------------
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "25"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# --- REST framework -----------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["accounts.authentication.CsrfSessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["accounts.permissions.IsVerifiedUser"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "auth_login": os.environ.get("THROTTLE_LOGIN", "10/min"),
        "auth_register": os.environ.get("THROTTLE_REGISTER", "5/hour"),
        "auth_code": os.environ.get("THROTTLE_CODE", "10/min"),
        "auth_email": os.environ.get("THROTTLE_EMAIL", "5/hour"),
        "upload": os.environ.get("THROTTLE_UPLOAD", "30/hour"),
        "live_eval": os.environ.get("THROTTLE_LIVE_EVAL", "120/min"),
    },
    "EXCEPTION_HANDLER": "config.exceptions.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Email (SMTP) ---------------------------------------------------------------
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
EMAIL_HOST = SMTP_HOST
EMAIL_PORT = int(os.environ.get("SMTP_PORT", "587") or 587)
EMAIL_HOST_USER = os.environ.get("SMTP_USERNAME", "")
EMAIL_HOST_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
EMAIL_USE_SSL = EMAIL_PORT == 465 or env_bool("SMTP_USE_SSL", False)
EMAIL_USE_TLS = not EMAIL_USE_SSL and env_bool("SMTP_USE_TLS", True)
EMAIL_TIMEOUT = 20
DEFAULT_FROM_EMAIL = os.environ.get("EMAIL_FROM", "Melobud <no-reply@melobud.local>")
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_CONFIGURED = bool(SMTP_HOST)

FRONTEND_URL = os.environ.get("FRONTEND_URL", f"https://{RENDER_HOST}" if RENDER_HOST else "http://localhost:5173").rstrip("/")
VERIFICATION_CODE_TTL_MINUTES = 15
VERIFICATION_CODE_MAX_ATTEMPTS = 5
VERIFICATION_RESEND_COOLDOWN_SECONDS = 60
PASSWORD_RESET_TIMEOUT = 60 * 60  # 1 hour, used by Django's token generator

# --- Background jobs (Celery + Redis) ---------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "").strip()
CELERY_BROKER_URL = REDIS_URL or "memory://"
CELERY_RESULT_BACKEND = None
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# --- Audio engine -----------------------------------------------------------------
BTC_DIR = BASE_DIR / "vendor" / "BTC"
AUDIO_DEVICE = os.environ.get("AUDIO_DEVICE", "auto")  # auto | cpu | cuda
# Run each analysis in its own process: if it runs out of memory only that
# process dies (the song is marked failed) and the website keeps running.
ANALYSIS_IN_SUBPROCESS = env_bool("ANALYSIS_IN_SUBPROCESS", False)

# --- Security headers (production) --------------------------------------------------
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {"django.db.backends": {"level": "WARNING"}},
}
