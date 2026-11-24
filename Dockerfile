# Melobud — one container: Django API + the built React app.

# --- 1. Build the frontend ---------------------------------------------------------
FROM node:22-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- 2. Backend runtime --------------------------------------------------------------
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    TORCH_HOME=/app/.torch
RUN apt-get update \
 && apt-get install -y --no-install-recommends git libsndfile1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

# CPU-only PyTorch (Render has no GPU), then the rest of the requirements.
RUN pip install torch==2.14.1 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

# Download the Beat This! checkpoint at build time so cold starts don't fetch it.
RUN python -c "from beat_this.inference import Audio2Beats; Audio2Beats(checkpoint_path='final0', device='cpu', dbn=False)"

COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
RUN DJANGO_SECRET_KEY=build-only python manage.py collectstatic --noinput

ENV ANALYSIS_IN_SUBPROCESS=true AUDIO_DEVICE=cpu
EXPOSE 10000
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn -c gunicorn.conf.py config.wsgi:application"]
