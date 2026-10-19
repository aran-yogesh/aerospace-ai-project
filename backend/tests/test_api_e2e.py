"""End-to-end: a golden STEP file through upload -> real parser -> graph + mesh."""

import pytest

import app.cad_parser
from app.core.config import get_settings
from app.schema.geometry import SystemGraph
from tests.conftest import wait_for_status

GOLDEN = get_settings().evals_dir / "golden" / "07_feed_line.step"


@pytest.mark.skipif(not hasattr(app.cad_parser, "parse_file"), reason="parser not built yet")
@pytest.mark.skipif(not GOLDEN.is_file(), reason=f"{GOLDEN} not generated yet")
def test_feed_line_end_to_end(api_client):
    pid = api_client.post("/projects", json={"name": "e2e"}).json()["id"]
    r = api_client.post(
        f"/projects/{pid}/files",
        files={"file": (GOLDEN.name, GOLDEN.read_bytes(), "application/octet-stream")},
    )
    assert r.status_code == 202, r.text
    fid = r.json()["id"]

    with api_client.websocket_connect(f"/ws/files/{fid}") as ws:
        while (event := ws.receive_json())["status"] not in {"parsed", "failed"}:
            pass
    assert event["status"] == "parsed", event

    done = wait_for_status(api_client, fid, {"parsed"}, timeout=5)
    graph = SystemGraph.model_validate(api_client.get(f"/files/{fid}/graph").json())
    assert done["component_count"] == len(graph.components) > 0

    mesh = api_client.get(f"/files/{fid}/mesh").json()
    leaf_ids = set()

    def walk(node):
        if "parts" in node:
            for part in node["parts"]:
                walk(part)
        else:
            leaf_ids.add(node["id"])

    walk(mesh)
    assert {f"/system/{c.id}" for c in graph.components} <= leaf_ids
