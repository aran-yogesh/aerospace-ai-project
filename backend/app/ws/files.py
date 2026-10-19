import asyncio
import contextlib
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from app.api.deps import parse_id
from app.api.parse_jobs import status_event
from app.core.users import DEV_USER_ID
from app.db.models import TERMINAL_STATUSES, CadFile
from app.db.session import get_sessionmaker
from app.schema.api import FileStatusEvent
from app.ws import events

router = APIRouter()

# Application close codes (4000-4999). 1000 = normal close after a terminal status.
CLOSE_NOT_FOUND = 4404


def _load_event(file_id: UUID) -> FileStatusEvent | None:
    with get_sessionmaker()() as db:
        row = db.get(CadFile, file_id)
        if row is None or row.user_id != DEV_USER_ID:
            return None
        return status_event(row)


@router.websocket("/ws/files/{file_id}")
async def file_status(websocket: WebSocket, file_id: str) -> None:
    """Push FileStatusEvent JSON on connect and on every change; close after parsed/failed."""
    await websocket.accept()
    fid = parse_id(file_id)
    if fid is None:
        await websocket.close(code=CLOSE_NOT_FOUND, reason="not_found")
        return

    # Subscribe before reading the current state so no transition can slip between them.
    queue = events.subscribe(fid)
    receiver = asyncio.create_task(_drain(websocket))
    try:
        current = await run_in_threadpool(_load_event, fid)
        if current is None:
            await websocket.close(code=CLOSE_NOT_FOUND, reason="not_found")
            return
        last = current
        await websocket.send_json(current.model_dump(mode="json"))
        while last.status not in TERMINAL_STATUSES:
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({getter, receiver}, return_when=asyncio.FIRST_COMPLETED)
            if receiver in done:  # client went away
                getter.cancel()
                return
            event = getter.result()
            if event == last:
                continue
            last = event
            await websocket.send_json(event.model_dump(mode="json"))
        await websocket.close(code=1000)
    except WebSocketDisconnect:
        return
    finally:
        events.unsubscribe(fid, queue)
        receiver.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await receiver


async def _drain(websocket: WebSocket) -> None:
    """Ignore client messages; return when the client disconnects."""
    with contextlib.suppress(WebSocketDisconnect):
        while True:
            await websocket.receive_text()
