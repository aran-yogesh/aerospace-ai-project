from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


@router.websocket("/ws")
async def echo(websocket: WebSocket) -> None:
    """Echo stub. The session protocol replaces this in a later phase."""
    await websocket.accept()
    try:
        while True:
            await websocket.send_text(await websocket.receive_text())
    except WebSocketDisconnect:
        return
