"""WebSocket channel for a live session. Echo stub for now."""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def session_socket(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_text()
            await websocket.send_json({"session_id": session_id, "echo": message})
    except WebSocketDisconnect:
        return
