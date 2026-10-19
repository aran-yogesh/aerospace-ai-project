from uuid import uuid4

from app.constants.loader import load_constants
from app.db import Base


def test_unknown_route_returns_structured_error(client):
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "not_found", "detail": "Not Found"}


def test_missing_user_returns_structured_error(client):
    response = client.get("/projects")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthenticated"


def test_stub_router_lists_and_rejects_create(client):
    headers = {"X-User-Id": str(uuid4())}
    assert client.get("/projects", headers=headers).json() == {"items": []}
    response = client.post("/projects", headers=headers)
    assert response.status_code == 501
    assert response.json()["error"] == "not_implemented"


def test_ws_echo(client):
    with client.websocket_connect("/ws/session/abc") as ws:
        ws.send_text("hi")
        assert ws.receive_json() == {"session_id": "abc", "echo": "hi"}


def test_every_table_has_user_id():
    for table in Base.metadata.tables.values():
        assert "user_id" in table.columns, table.name


def test_constants_have_versions():
    tables = load_constants()
    assert "k_values" in tables
    assert all(t.version for t in tables.values())
