"""Background parse jobs: uploaded -> parsing -> parsed | failed.

Jobs run on a small thread pool, off the request path. Each job calls
app.cad_parser.parse_file, which never raises and isolates parsing in its own
subprocess (timeout + memory cap), so a worker thread only ever blocks waiting on it.
All state lives in Postgres and the uploads volume; the pool itself holds nothing that a
restart can lose except in-flight work, which recover_interrupted() handles on startup.
"""

import json
import logging
import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select, update

from app.core import storage
from app.core.config import get_settings
from app.db.models import CadFile, SystemGraphRow
from app.db.session import get_sessionmaker
from app.schema.api import FileStatusEvent
from app.schema.geometry import PARSER_VERSION, ParseError, SystemGraph
from app.ws import events

logger = logging.getLogger(__name__)

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=get_settings().parse_workers, thread_name_prefix="parse-job"
            )
        return _executor


def submit(file_id: UUID) -> Future:
    return _get_executor().submit(run_parse_job, file_id)


def shutdown() -> None:
    """Stop accepting jobs. Running parses finish; queued ones are recovered on next start."""
    global _executor
    with _executor_lock:
        if _executor is not None:
            _executor.shutdown(wait=False, cancel_futures=True)
            _executor = None


def status_event(row: CadFile) -> FileStatusEvent:
    return FileStatusEvent(
        file_id=row.id,
        status=row.status,
        error=row.error,
        parse_seconds=row.parse_seconds,
        component_count=row.component_count,
    )


def run_parse_job(file_id: UUID) -> None:
    try:
        _run(file_id)
    except Exception:
        logger.exception("parse job crashed for file %s", file_id)
        _finish_failed(
            file_id,
            ParseError(error="internal_error", detail="The parse job failed unexpectedly."),
            seconds=None,
        )


def _run(file_id: UUID) -> None:
    Session = get_sessionmaker()
    with Session() as db:
        # Atomic claim: only an "uploaded" row moves to "parsing", so a job never runs twice.
        claimed = db.execute(
            update(CadFile)
            .where(CadFile.id == file_id, CadFile.status == "uploaded")
            .values(status="parsing", error=None)
            .returning(CadFile.id)
        ).scalar_one_or_none()
        db.commit()
        if claimed is None:
            logger.info("parse job for %s skipped: not in 'uploaded' state", file_id)
            return
        row = db.get(CadFile, file_id)
        if row is None:
            return
        events.publish(status_event(row))
        user_id, step_path = row.user_id, storage.resolve(row.storage_key)

    result, mesh, seconds = _call_parser(step_path)

    if isinstance(result, ParseError):
        _finish_failed(file_id, result, seconds)
        return

    mesh_key = mesh_bytes = None
    if mesh is not None:
        mesh_key = storage.mesh_key(user_id, file_id)
        mesh_bytes = _write_json(storage.resolve(mesh_key), mesh)

    with Session() as db:
        row = db.get(CadFile, file_id)
        if row is None:  # deleted while parsing
            return
        db.add(
            SystemGraphRow(
                user_id=user_id,
                file_id=file_id,
                graph=result.model_dump(mode="json"),
                mesh_key=mesh_key,
                mesh_bytes=mesh_bytes,
            )
        )
        row.status = "parsed"
        row.error = None
        row.parser_version = result.parser_version
        row.parse_seconds = seconds
        row.component_count = len(result.components)
        db.commit()
        events.publish(status_event(row))


def _call_parser(path: Path) -> tuple[SystemGraph | ParseError, dict | None, float | None]:
    try:
        from app.cad_parser import parse_file
    except ImportError:
        return (
            ParseError(error="parser_unavailable", detail="CAD parser is not installed."),
            None,
            None,
        )

    settings = get_settings()
    out = parse_file(path, timeout_s=settings.parse_timeout_s, memory_mb=settings.parse_memory_mb)
    result: Any = out.result
    if not isinstance(result, SystemGraph | ParseError):
        # Accept plain dicts too; anything else is a parser contract violation.
        if isinstance(result, dict) and "error" in result:
            result = ParseError.model_validate(result)
        else:
            result = SystemGraph.model_validate(result)
    return result, out.mesh, out.seconds


def _finish_failed(file_id: UUID, error: ParseError, seconds: float | None) -> None:
    with get_sessionmaker()() as db:
        row = db.get(CadFile, file_id)
        if row is None:
            return
        row.status = "failed"
        row.error = error.model_dump(mode="json")
        row.parser_version = PARSER_VERSION
        row.parse_seconds = seconds
        row.component_count = None
        db.commit()
        events.publish(status_event(row))


def _json_default(value: Any) -> Any:
    if hasattr(value, "tolist"):  # numpy arrays / scalars from ocp-tessellate
        return value.tolist()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def _write_json(path: Path, data: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    payload = json.dumps(data, separators=(",", ":"), default=_json_default).encode()
    tmp.write_bytes(payload)
    os.replace(tmp, path)
    return len(payload)


def recover_interrupted() -> None:
    """On startup: rows left in "parsing" by a previous process can never finish, so mark
    them failed; rows still "uploaded" were queued but never started, so queue them again."""
    with get_sessionmaker()() as db:
        stuck = (
            db.execute(
                update(CadFile)
                .where(CadFile.status == "parsing")
                .values(
                    status="failed",
                    error=ParseError(
                        error="interrupted", detail="The server restarted while parsing."
                    ).model_dump(mode="json"),
                )
                .returning(CadFile.id)
            )
            .scalars()
            .all()
        )
        db.commit()
        queued = db.execute(select(CadFile.id).where(CadFile.status == "uploaded")).scalars().all()
    if stuck:
        logger.warning("marked %d interrupted parse(s) as failed", len(stuck))
    for file_id in queued:
        submit(file_id)
