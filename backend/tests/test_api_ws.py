import uuid

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import wait_for_status
from tests.test_api_files import failed_output, ok_output, upload


@pytest.fixture
def project_id(api_client) -> str:
    return api_client.post("/projects", json={"name": "ws"}).json()["id"]


def _collect(ws) -> list[dict]:
    events = []
    while True:
        try:
            events.append(ws.receive_json())
        except WebSocketDisconnect as exc:
            assert exc.code == 1000
            return events


def test_ws_pushes_status_until_parsed(api_client, project_id, fake_parser):
    fake = fake_parser(ok_output)
    fake.gate.clear()
    fid = upload(api_client, project_id).json()["id"]
    wait_for_status(api_client, fid, {"parsing"})

    with api_client.websocket_connect(f"/ws/files/{fid}") as ws:
        first = ws.receive_json()
        assert first == {
            "file_id": fid,
            "status": "parsing",
            "error": None,
            "parse_seconds": None,
            "component_count": None,
        }
        fake.gate.set()
        rest = _collect(ws)
    assert [e["status"] for e in rest] == ["parsed"]
    assert rest[-1]["component_count"] == 1
    assert rest[-1]["parse_seconds"] == pytest.approx(0.25)


def test_ws_pushes_failure_with_error(api_client, project_id, fake_parser):
    fake = fake_parser(failed_output)
    fake.gate.clear()
    fid = upload(api_client, project_id).json()["id"]
    with api_client.websocket_connect(f"/ws/files/{fid}") as ws:
        first = ws.receive_json()
        assert first["status"] in {"uploaded", "parsing"}
        fake.gate.set()
        events = [first, *_collect(ws)]
    statuses = [e["status"] for e in events]
    assert statuses[-1] == "failed"
    assert set(statuses) <= {"uploaded", "parsing", "failed"}
    assert len(statuses) == len(set(statuses))  # no duplicate pushes
    assert events[-1]["error"] == {"error": "no_solids", "detail": "No solids found"}


def test_ws_already_terminal_sends_once_and_closes(api_client, project_id, fake_parser):
    fake_parser(ok_output)
    fid = upload(api_client, project_id).json()["id"]
    wait_for_status(api_client, fid, {"parsed"})
    with api_client.websocket_connect(f"/ws/files/{fid}") as ws:
        events = _collect(ws)
    assert [e["status"] for e in events] == ["parsed"]


def test_ws_unknown_file(api_client):
    for fid in (uuid.uuid4(), "bogus"):
        with api_client.websocket_connect(f"/ws/files/{fid}") as ws:
            with pytest.raises(WebSocketDisconnect) as exc:
                ws.receive_json()
            assert exc.value.code == 4404


def test_ws_echo_still_works(api_client):
    with api_client.websocket_connect("/ws") as ws:
        ws.send_text("hi")
        assert ws.receive_text() == "hi"
