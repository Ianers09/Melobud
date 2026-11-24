"""Gunicorn settings for production (Render)."""
import logging
import os
import threading
import urllib.request

bind = f"0.0.0.0:{os.environ.get('PORT', '10000')}"
workers = 1
threads = 4
timeout = 120

# Render's free plan stops a service after 15 minutes without incoming requests.
# While KEEP_AWAKE is on, the server requests its own public URL every 10 minutes
# (through Render's proxy, so it counts as incoming traffic).
KEEP_AWAKE_SECONDS = 10 * 60


def _keep_awake(url):
    log = logging.getLogger("melobud.keep_awake")
    stop = threading.Event()
    while not stop.wait(KEEP_AWAKE_SECONDS):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                log.info("Keep-awake ping: %s", response.status)
        except Exception as exc:  # noqa: BLE001 - never let the pinger die
            log.warning("Keep-awake ping failed: %s", exc)


def post_worker_init(worker):
    host = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "").strip()
    enabled = os.environ.get("KEEP_AWAKE", "true").strip().lower() in {"1", "true", "yes", "on"}
    if host and enabled:
        url = f"https://{host}/api/health/"
        threading.Thread(target=_keep_awake, args=(url,), name="keep-awake", daemon=True).start()
        worker.log.info("Keep-awake enabled: pinging %s every %s s", url, KEEP_AWAKE_SECONDS)
