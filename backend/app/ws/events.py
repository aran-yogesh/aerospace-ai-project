"""In-process pub/sub for file status events.

Phase 1 runs one lemma-core instance, so parse jobs (worker threads) publish straight to
WebSocket subscribers in the same process. With more than one instance, a job may run in
a different process than the socket, so this must move to Postgres LISTEN/NOTIFY (or
similar) keyed by file id. The interface (subscribe/unsubscribe/publish) stays the same.
"""

import asyncio
import logging
import threading
from collections import defaultdict
from uuid import UUID

from app.schema.api import FileStatusEvent

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_subscribers: dict[UUID, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = defaultdict(set)


def subscribe(file_id: UUID) -> asyncio.Queue[FileStatusEvent]:
    """Call from a coroutine. Returns a queue that receives every event for file_id."""
    queue: asyncio.Queue[FileStatusEvent] = asyncio.Queue()
    with _lock:
        _subscribers[file_id].add((asyncio.get_running_loop(), queue))
    return queue


def unsubscribe(file_id: UUID, queue: asyncio.Queue) -> None:
    with _lock:
        subs = _subscribers.get(file_id)
        if not subs:
            return
        for entry in [e for e in subs if e[1] is queue]:
            subs.discard(entry)
        if not subs:
            del _subscribers[file_id]


def publish(event: FileStatusEvent) -> None:
    """Thread-safe; callable from worker threads or the event loop."""
    with _lock:
        targets = list(_subscribers.get(event.file_id, ()))
    for loop, queue in targets:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, event)
        except RuntimeError:  # subscriber's loop already closed
            logger.debug("dropping event for closed loop", exc_info=True)


def subscriber_count(file_id: UUID) -> int:
    with _lock:
        return len(_subscribers.get(file_id, ()))
