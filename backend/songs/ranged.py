"""File response with HTTP Range support so the browser's <audio> element can seek."""
import os
import re

from django.http import FileResponse, HttpResponse, StreamingHttpResponse

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")
CHUNK = 64 * 1024


def _file_iter(handle, start, length):
    try:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            data = handle.read(min(CHUNK, remaining))
            if not data:
                break
            remaining -= len(data)
            yield data
    finally:
        handle.close()


def ranged_file_response(request, path, content_type="audio/mpeg"):
    size = os.path.getsize(path)
    header = request.headers.get("Range", "").strip()
    match = RANGE_RE.match(header) if header else None

    if not match:
        response = FileResponse(open(path, "rb"), content_type=content_type)
        response["Accept-Ranges"] = "bytes"
        response["Content-Length"] = str(size)
        response["Cache-Control"] = "private, max-age=3600"
        return response

    start_s, end_s = match.groups()
    if start_s == "" and end_s == "":
        start, end = 0, size - 1
    elif start_s == "":
        suffix = int(end_s)
        start, end = max(0, size - suffix), size - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else size - 1
    end = min(end, size - 1)

    if start >= size or start > end:
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        return response

    length = end - start + 1
    response = StreamingHttpResponse(_file_iter(open(path, "rb"), start, length), status=206, content_type=content_type)
    response["Content-Length"] = str(length)
    response["Content-Range"] = f"bytes {start}-{end}/{size}"
    response["Accept-Ranges"] = "bytes"
    response["Cache-Control"] = "private, max-age=3600"
    return response
