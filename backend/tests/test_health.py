from app.db import session


def test_health_pings_database(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_health_reports_database_down(client, monkeypatch):
    def fail() -> None:
        raise OSError("connection refused")

    monkeypatch.setattr(session, "ping", fail)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": "down"}


def test_cors_allows_desktop_dev_origin(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_allows_other_localhost_port_outside_production(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5174"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5174"


def test_cors_rejects_foreign_origin(client):
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_unknown_route_returns_structured_error(client):
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json() == {"error": "not_found", "detail": "Not Found"}


def test_ws_echo(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_text("hi")
        assert ws.receive_text() == "hi"
