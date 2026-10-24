"""Integration: golden 07_feed_line through the real parser and the real solver, via the API."""

import json

import pytest

import app.cad_parser
from app.core.config import get_settings
from tests.conftest import wait_for_status

GOLDEN = get_settings().evals_dir / "golden"


def _upload(client, name: str) -> str:
    pid = client.post("/projects", json={"name": "golden"}).json()["id"]
    path = GOLDEN / name
    r = client.post(f"/projects/{pid}/files", files={"file": (path.name, path.read_bytes())})
    return wait_for_status(client, r.json()["id"], {"parsed"}, timeout=60)["id"]


@pytest.mark.skipif(not hasattr(app.cad_parser, "parse_file"), reason="parser not built yet")
@pytest.mark.skipif(not (GOLDEN / "07_feed_line.step").is_file(), reason="golden not generated")
def test_feed_line_setup_resolve_confirm_solve(api_client):
    fid = _upload(api_client, "07_feed_line.step")
    setup = api_client.get(f"/files/{fid}/setup").json()  # default: Water 20 C, 1 bar
    resolved = api_client.post(f"/files/{fid}/resolve").json()
    assert resolved["counts"]["missing"] == 0  # every K in 07 resolves (valve via Cv)
    assert resolved["counts"]["computed"] == 6

    r = api_client.post(f"/files/{fid}/datasets")
    assert r.status_code == 201, r.text
    ds = r.json()
    url = f"/datasets/{ds['id']}/solve"
    fwd = api_client.post(url, json={"mode": "dp", "value": 0.2}).json()
    assert fwd["status"] == "complete" and fwd["result"]["total_dp_pa"] > 0
    inv = api_client.post(url, json={"mode": "flow", "value": fwd["result"]["total_dp_pa"]}).json()
    assert inv["result"]["mdot_kg_s"] == pytest.approx(0.2, rel=1e-6)

    print("\nSETUP", json.dumps(setup, indent=1))
    print("RESOLVE", json.dumps(resolved, indent=1))
    print("DATASET", json.dumps(ds, indent=1))
    print("SOLVE", json.dumps(fwd, indent=1))
    print("INVERSE", json.dumps(inv, indent=1))


@pytest.mark.skipif(not hasattr(app.cad_parser, "parse_file"), reason="parser not built yet")
@pytest.mark.skipif(not (GOLDEN / "06_unnamed_part.step").is_file(), reason="not generated")
def test_unnamed_part_needs_a_k(api_client):
    fid = _upload(api_client, "06_unnamed_part.step")
    r = api_client.post(f"/files/{fid}/datasets")
    assert r.status_code == 409 and r.json()["error"] == "unresolved"
    (missing,) = r.json()["components"]
    body = {
        "fluid": {"kind": "coolprop", "name": "Water", "temperature_k": 293.15, "pressure_pa": 1e5},
        "material_key": "stainless_drawn",
        "k_overrides": {missing: {"value": 0.5}},
    }
    assert api_client.put(f"/files/{fid}/setup", json=body).status_code == 200
    assert api_client.post(f"/files/{fid}/datasets").status_code == 201
