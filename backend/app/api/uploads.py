"""Streaming multipart upload straight to the uploads volume.

The request body is fed chunk by chunk to python-multipart's push parser and the "file"
part is written directly to its final directory, so a 50 MB upload is never held in
memory and never copied through a temp spool. The size cap is enforced while streaming
(and up front from Content-Length), so oversize uploads stop early.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path, PurePath
from typing import IO

from fastapi import Request
from python_multipart import MultipartParser
from python_multipart.multipart import parse_options_header

from app.core.errors import AppError

ALLOWED_SUFFIXES = (".step", ".stp")
STEP_MAGIC = b"ISO-10303-21"
_SNIFF_BYTES = 256
# Multipart framing (boundaries, part headers) on top of the file bytes.
_FRAMING_SLACK = 64 * 1024


def unsupported_type(filename: str) -> AppError:
    return AppError(
        "unsupported_file_type",
        f"{filename!r} is not a STEP file; only .step and .stp are accepted.",
        status_code=415,
    )


def too_large(limit: int) -> AppError:
    return AppError(
        "file_too_large", f"Uploads are limited to {limit // (1024 * 1024)} MB.", status_code=413
    )


def looks_like_step(head: bytes) -> bool:
    head = head.removeprefix(b"\xef\xbb\xbf").lstrip()
    return head.startswith(STEP_MAGIC)


@dataclass
class StoredUpload:
    filename: str
    size_bytes: int


@dataclass
class _State:
    dest: Path
    limit: int
    header_field: bytearray = field(default_factory=bytearray)
    header_value: bytearray = field(default_factory=bytearray)
    headers: dict[bytes, bytes] = field(default_factory=dict)
    in_file_part: bool = False
    seen_file: bool = False
    filename: str = ""
    size: int = 0
    head: bytearray = field(default_factory=bytearray)
    fh: IO[bytes] | None = None
    error: AppError | None = None


async def receive_step_upload(request: Request, dest: Path, limit: int) -> StoredUpload:
    """Stream the multipart field "file" into dest. On any error dest does not exist."""
    content_type, params = parse_options_header(request.headers.get("content-type", ""))
    boundary = params.get(b"boundary")
    if content_type != b"multipart/form-data" or not boundary:
        raise AppError("validation_error", "Expected multipart/form-data with a 'file' field.", 422)

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + _FRAMING_SLACK:
        raise too_large(limit)

    st = _State(dest=dest, limit=limit)
    partial = dest.with_name(dest.name + ".part")
    dest.parent.mkdir(parents=True, exist_ok=True)

    def on_header_field(data: bytes, start: int, end: int) -> None:
        st.header_field += data[start:end]

    def on_header_value(data: bytes, start: int, end: int) -> None:
        st.header_value += data[start:end]

    def on_header_end() -> None:
        st.headers[bytes(st.header_field).lower()] = bytes(st.header_value)
        st.header_field.clear()
        st.header_value.clear()

    def on_headers_finished() -> None:
        _, disp = parse_options_header(st.headers.get(b"content-disposition", b""))
        st.headers.clear()
        if disp.get(b"name") != b"file" or st.seen_file or st.error:
            return
        st.seen_file = True
        raw_name = disp.get(b"filename", b"").decode("utf-8", "replace")
        st.filename = PurePath(raw_name.replace("\\", "/")).name[:255]
        if not st.filename.lower().endswith(ALLOWED_SUFFIXES):
            st.error = unsupported_type(st.filename or "(no filename)")
            return
        st.fh = open(partial, "wb")  # noqa: SIM115 - closed in on_part_end/finally
        st.in_file_part = True

    def on_part_data(data: bytes, start: int, end: int) -> None:
        if not st.in_file_part or st.error:
            return
        chunk = data[start:end]
        st.size += len(chunk)
        if st.size > st.limit:
            st.error = too_large(st.limit)
            return
        if len(st.head) < _SNIFF_BYTES:
            st.head += chunk[: _SNIFF_BYTES - len(st.head)]
        if st.fh is not None:
            st.fh.write(chunk)

    def on_part_end() -> None:
        if st.in_file_part and st.fh is not None:
            st.fh.close()
        st.in_file_part = False

    parser = MultipartParser(
        boundary,
        {
            "on_header_field": on_header_field,
            "on_header_value": on_header_value,
            "on_header_end": on_header_end,
            "on_headers_finished": on_headers_finished,
            "on_part_data": on_part_data,
            "on_part_end": on_part_end,
        },
    )
    try:
        async for chunk in request.stream():
            parser.write(chunk)
            if st.error:
                raise st.error
        parser.finalize()
        if not st.seen_file:
            raise AppError("validation_error", "Missing multipart field 'file'.", 422)
        if st.size == 0 or not looks_like_step(bytes(st.head)):
            raise AppError(
                "not_step_file",
                "File does not start with the ISO-10303-21 STEP header.",
                status_code=422,
            )
        if st.fh is not None and not st.fh.closed:
            st.fh.close()
        os.replace(partial, dest)
    except AppError:
        raise
    except Exception as exc:
        raise AppError("validation_error", f"Malformed multipart body: {exc}", 422) from exc
    finally:
        if st.fh is not None and not st.fh.closed:
            st.fh.close()
        partial.unlink(missing_ok=True)
    return StoredUpload(filename=st.filename, size_bytes=st.size)
