"""Phase 2 API: fluids, materials, setup, resolve, confirm (datasets) and solve runs."""

import uuid
from itertools import pairwise

import pytest
from sqlalchemy import select

from app.api import resolve as resolve_mod
from app.core.users import current_user_id
from app.db.models import Dataset
from app.db.session import get_sessionmaker
from app.schema.geometry import Bend, Pipe, SystemGraph, Transition, Unclassified, Valve
from tests.conftest import FakeOutput, wait_for_status

STEP = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"


def _line(*components) -> SystemGraph:
    ids = [c.id for c in components]
    return SystemGraph(
        components=list(components),
        edges=list(pairwise(ids)),
        inlet_id=ids[0],
        outlet_id=ids[-1],
        ordered_path=ids,
        topology="line",
    )


def _valve(cid, valve_type, cv=None):
    return Valve(
        id=cid,
        confidence=1,
        name=f"V_{valve_type}",
        valve_type=valve_type,
        cv=cv,
        part_path=f"/x/{cid}",
    )


FEED_LINE = _line(  # same geometry as evals/golden/07_feed_line
    Pipe(id="comp_1", confidence=1, inner_diameter_m=0.016, length_m=0.15),
    Bend(
        id="comp_2",
        confidence=1,
        inner_diameter_m=0.016,
        angle_deg=90,
        bend_radius_m=0.032,
        r_over_d=2.0,
    ),
    _valve("comp_3", "BallValve", cv=6.0),
    Transition(
        id="comp_4",
        confidence=1,
        d_in_m=0.016,
        d_out_m=0.01,
        length_m=0.03,
        half_angle_deg=5.71,
        kind="contraction",
    ),
    Bend(
        id="comp_5",
        confidence=1,
        inner_diameter_m=0.01,
        angle_deg=45,
        bend_radius_m=0.02,
        r_over_d=2.0,
    ),
    Pipe(id="comp_6", confidence=1, inner_diameter_m=0.01, length_m=0.2),
)
UNNAMED = _line(  # evals/golden/06_unnamed_part
    Pipe(id="comp_1", confidence=1, inner_diameter_m=0.012, length_m=0.2),
    Unclassified(
        id="comp_2", confidence=0.3, name="Part1", reason="not pipe-like", part_path="/06/Part1"
    ),
    Pipe(id="comp_3", confidence=1, inner_diameter_m=0.012, length_m=0.2),
)
VALVES = _line(
    Pipe(id="comp_1", confidence=1, inner_diameter_m=0.02, length_m=0.1),
    _valve("comp_2", "BallValve"),  # exact key ball_valve, but unverified -> family
    _valve("comp_3", "SwingCheckValve"),
    _valve("comp_4", "Y-pattern globe valve"),  # family only (valve_globe)
    _valve("comp_5", "Widget"),  # nothing -> missing
    Pipe(id="comp_6", confidence=1, inner_diameter_m=0.02, length_m=0.1),
)
NETWORK = FEED_LINE.model_copy(update={"topology": "network", "ordered_path": None})

WATER_20C = {"kind": "coolprop", "name": "Water", "temperature_k": 293.15, "pressure_pa": 1e5}


def setup_body(fluid=None, material="stainless_drawn", overrides=None) -> dict:
    return {"fluid": fluid or WATER_20C, "material_key": material, "k_overrides": overrides or {}}


@pytest.fixture
def parsed(api_client, fake_parser):
    """parsed(graph) -> file id of an uploaded, parsed file with that graph."""
    graphs: list[SystemGraph] = []
    fake_parser(lambda _p: FakeOutput(result=graphs.pop(0), mesh=None, seconds=0.1))
    pid = api_client.post("/projects", json={"name": "solve"}).json()["id"]

    def make(graph: SystemGraph) -> str:
        graphs.append(graph)
        r = api_client.post(f"/projects/{pid}/files", files={"file": ("a.step", STEP)})
        wait_for_status(api_client, r.json()["id"], {"parsed"})
        return r.json()["id"]

    return make


def confirm(client, fid, **setup) -> dict:
    assert client.put(f"/files/{fid}/setup", json=setup_body(**setup)).status_code == 200
    r = client.post(f"/files/{fid}/datasets")
    assert r.status_code == 201, r.text
    return r.json()


# ---- fluids and materials ---------------------------------------------------------------


def test_fluids(api_client):
    items = {f["name"]: f for f in api_client.get("/fluids").json()["items"]}
    assert set(items) == {"Water", "Oxygen", "Nitrogen", "Hydrogen", "Methane", "RP-1", "Custom"}
    assert items["Water"]["group"] == "REFERENCE"
    assert {items[n]["group"] for n in ("Oxygen", "Nitrogen", "Hydrogen", "Methane")} == {
        "CRYOGENIC"
    }
    assert items["RP-1"] | {"source": None} == {
        "name": "RP-1",
        "kind": "table",
        "group": "PROPELLANT",
        "t_min_k": 250.0,
        "t_max_k": 350.0,
        "source": None,
    }
    assert items["Custom"]["kind"] == "custom" and items["Custom"]["t_min_k"] is None
    assert items["Water"]["t_min_k"] == pytest.approx(273.16)
    assert items["Water"]["t_max_k"] == pytest.approx(647.096)


def test_materials(api_client):
    body = api_client.get("/materials").json()
    rough = {m["key"]: m["roughness_m"] for m in body["items"]}
    assert rough == {
        "stainless_drawn": 1.524e-6,
        "stainless_commercial": 4.572e-5,
        "carbon_steel_commercial": 4.572e-5,
        "copper_drawn": 1.524e-6,
        "ptfe_lined": 1.524e-6,
    }
    assert body["version"]


def test_k_table_is_never_exposed(api_client):
    paths = api_client.get("/openapi.json").json()["paths"]
    assert not any("k_value" in p or "constants" in p for p in paths)


# ---- setup --------------------------------------------------------------------------------


def test_setup_default_and_404(api_client, parsed):
    fid = parsed(FEED_LINE)
    body = api_client.get(f"/files/{fid}/setup").json()
    assert body["updated_at"] is None and body["latest_dataset"] is None
    assert body["fluid"]["name"] == "Water" and body["material_key"] == "stainless_drawn"
    assert body["props"]["density_kg_m3"]["value"] == pytest.approx(998.2, abs=0.05)
    assert body["props"]["viscosity_pa_s"]["value"] == pytest.approx(1.0016e-3, rel=1e-3)
    assert body["props"]["density_kg_m3"]["source"].startswith("CoolProp")
    assert body["roughness"] == {
        "value": 1.524e-6,
        "unit": "m",
        "source": "Crane TP-410, A-23: drawn tubing, e = 0.000005 ft (materials 2026.10.0)",
    }
    for bad in (uuid.uuid4(), "nope"):
        assert api_client.get(f"/files/{bad}/setup").status_code == 404
        r = api_client.put(f"/files/{bad}/setup", json=setup_body())
        assert r.status_code == 404 and r.json()["error"] == "not_found"


def test_setup_put_saves_and_round_trips(api_client, parsed):
    fid = parsed(FEED_LINE)
    body = setup_body(
        fluid={"kind": "coolprop", "name": "Nitrogen", "temperature_k": 77, "pressure_pa": 3e5},
        material="copper_drawn",
        overrides={"comp_3": {"value": 1.5, "note": "datasheet"}, "comp_4": "no_loss"},
    )
    r = api_client.put(f"/files/{fid}/setup", json=body)
    assert r.status_code == 200, r.text
    view = r.json()
    assert view["updated_at"] and view["props_error"] is None
    assert view["props"]["density_kg_m3"]["value"] == pytest.approx(806, rel=0.01)
    again = api_client.get(f"/files/{fid}/setup").json()
    assert again["k_overrides"] == body["k_overrides"] and again["material_key"] == "copper_drawn"


@pytest.mark.parametrize(
    ("fluid", "error"),
    [
        ({**WATER_20C, "temperature_k": 400}, "not_liquid"),
        ({**WATER_20C, "temperature_k": 200}, "out_of_range"),
        ({**WATER_20C, "temperature_k": 700}, "out_of_range"),
        ({**WATER_20C, "pressure_pa": 1e10}, "out_of_range"),
        ({**WATER_20C, "name": "Mercury"}, "unknown_fluid"),
        ({"kind": "table", "name": "Jet-A", "temperature_k": 300}, "unknown_fluid"),
        ({"kind": "table", "name": "RP-1", "temperature_k": 360}, "out_of_range"),
        ({"kind": "table", "name": "RP-1"}, "invalid_input"),
        ({"kind": "custom", "name": "Mine", "density_kg_m3": 900}, "invalid_input"),
        ({"kind": "coolprop", "name": "Water", "temperature_k": 293.15}, "invalid_input"),
    ],
)
def test_setup_props_errors_are_inline(api_client, parsed, fluid, error):
    fid = parsed(FEED_LINE)
    r = api_client.put(f"/files/{fid}/setup", json=setup_body(fluid=fluid))
    assert r.status_code == 200, r.text
    assert r.json()["props"] is None
    assert r.json()["props_error"]["error"] == error
    assert r.json()["updated_at"]  # saved anyway


def test_setup_table_and_custom_fluids(api_client, parsed):
    fid = parsed(FEED_LINE)
    rp1 = {"kind": "table", "name": "RP-1", "temperature_k": 280}
    props = api_client.put(f"/files/{fid}/setup", json=setup_body(fluid=rp1)).json()["props"]
    assert props["density_kg_m3"]["value"] == pytest.approx((822 + 808) / 2)
    assert props["viscosity_pa_s"]["value"] == pytest.approx((3.0e-3 + 2.15e-3) / 2)
    assert "linear interpolation" in props["density_kg_m3"]["source"]
    edge = {"kind": "table", "name": "RP-1", "temperature_k": 350}
    props = api_client.put(f"/files/{fid}/setup", json=setup_body(fluid=edge)).json()["props"]
    assert props["density_kg_m3"]["value"] == pytest.approx(765)
    custom = {"kind": "custom", "name": "Mine", "density_kg_m3": 900, "viscosity_pa_s": 0.01}
    props = api_client.put(f"/files/{fid}/setup", json=setup_body(fluid=custom)).json()["props"]
    assert props["density_kg_m3"] == {"value": 900, "unit": "kg/m^3", "source": "user"}


@pytest.mark.parametrize(
    "body",
    [
        setup_body(material="unobtainium"),
        setup_body(fluid={**WATER_20C, "temperature_k": -5}),
        setup_body(fluid={**WATER_20C, "kind": "magic"}),
        setup_body(overrides={"valve": {"value": 1}}),
        setup_body(overrides={"comp_1": {"value": -1}}),
        setup_body(overrides={"comp_1": "zero"}),
        {"fluid": WATER_20C},
        {**setup_body(), "extra": 1},
    ],
)
def test_setup_rejects_bad_input(api_client, parsed, body):
    fid = parsed(FEED_LINE)
    r = api_client.put(f"/files/{fid}/setup", json=body)
    assert r.status_code == 422
    assert r.json()["error"] in {"validation_error", "unknown_material"}


# ---- resolve ------------------------------------------------------------------------------


def test_resolve_feed_line_all_computed(api_client, parsed):
    fid = parsed(FEED_LINE)
    r = api_client.post(f"/files/{fid}/resolve")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {"computed": 6, "exact": 0, "family": 0, "user": 0, "missing": 0}
    rows = {row["component_id"]: row for row in body["rows"]}
    assert [row["component_id"] for row in body["rows"]] == FEED_LINE.ordered_path
    assert rows["comp_1"]["k"] is None and rows["comp_1"]["match"] == "computed"
    assert rows["comp_3"]["k_ref_d_m"] == 0.016  # Cv referenced to the upstream pipe ID
    # K = 891 d^4 / Cv^2, d in inches.
    assert rows["comp_3"]["k"] == pytest.approx(891 * (0.016 / 0.0254) ** 4 / 36, rel=1e-6)
    assert rows["comp_4"]["k_ref_d_m"] == 0.01  # smaller diameter
    assert all(rows[c]["k"] > 0 for c in ("comp_2", "comp_3", "comp_4", "comp_5"))


def test_resolve_valve_table_lookup(api_client, parsed):
    fid = parsed(VALVES)
    body = api_client.post(f"/files/{fid}/resolve").json()
    rows = {row["component_id"]: row for row in body["rows"]}
    assert rows["comp_2"]["match"] == "family"  # exact key, unverified -> approximate
    assert rows["comp_2"]["verified"] is False and rows["comp_2"]["k"] == 0.069
    assert "Crane TP-410" in rows["comp_2"]["source"]
    assert rows["comp_3"]["method"] == "K table entry swing_check_valve"
    assert rows["comp_4"]["match"] == "family" and rows["comp_4"]["k"] == 7.82  # first globe
    assert rows["comp_5"]["match"] == "missing" and rows["comp_5"]["k"] is None
    assert body["counts"] == {"computed": 2, "exact": 0, "family": 3, "user": 0, "missing": 1}


def test_verified_exact_key_is_exact():
    from app.constants import get_constants

    c = get_constants()
    entries = dict(c.k_values.entries)
    entries["ball_valve"] = entries["ball_valve"].model_copy(update={"status": "verified"})
    c = c.model_copy(update={"k_values": c.k_values.model_copy(update={"entries": entries})})
    row = resolve_mod.resolve(VALVES, setup_from(), 1.5e-6, c)[1]
    assert (row.match, row.verified, row.note) == ("exact", True, None)


def setup_from(**kw):
    from app.schema.solve import SetupIn

    return SetupIn.model_validate(setup_body(**kw))


def test_resolve_missing_and_overrides(api_client, parsed):
    fid = parsed(UNNAMED)
    body = api_client.post(f"/files/{fid}/resolve").json()
    assert body["counts"]["missing"] == 1 and body["rows"][1]["k_ref_d_m"] == 0.012
    api_client.put(f"/files/{fid}/setup", json=setup_body(overrides={"comp_2": {"value": 0.4}}))
    row = api_client.post(f"/files/{fid}/resolve").json()["rows"][1]
    assert (row["k"], row["match"], row["source"]) == (0.4, "user", "user")
    api_client.put(f"/files/{fid}/setup", json=setup_body(overrides={"comp_2": "no_loss"}))
    row = api_client.post(f"/files/{fid}/resolve").json()["rows"][1]
    assert (row["k"], row["match"], row["source"]) == (0.0, "user", "user: no loss")


def test_user_override_beats_computed(api_client, parsed):
    fid = parsed(FEED_LINE)
    api_client.put(f"/files/{fid}/setup", json=setup_body(overrides={"comp_3": {"value": 2}}))
    body = api_client.post(f"/files/{fid}/resolve").json()
    assert body["rows"][2]["match"] == "user" and body["counts"]["user"] == 1


def test_resolve_and_confirm_409s(api_client, parsed, fake_parser):
    fid = parsed(NETWORK)
    for path in ("resolve", "datasets"):
        r = api_client.post(f"/files/{fid}/{path}")
        assert (r.status_code, r.json()["error"]) == (409, "network_topology")
    # A file whose parse failed is not_parsed.
    from app.schema.geometry import ParseError

    fake_parser(lambda _p: FakeOutput(ParseError(error="no_solids"), None, 0.1))
    pid = api_client.post("/projects", json={"name": "x"}).json()["id"]
    bad = api_client.post(f"/projects/{pid}/files", files={"file": ("a.step", STEP)}).json()["id"]
    wait_for_status(api_client, bad, {"failed"})
    for path in ("resolve", "datasets"):
        r = api_client.post(f"/files/{bad}/{path}")
        assert (r.status_code, r.json()["error"]) == (409, "not_parsed")
    assert api_client.post(f"/files/{uuid.uuid4()}/resolve").status_code == 404


# ---- datasets -----------------------------------------------------------------------------


def test_confirm_unresolved_then_ok(api_client, parsed):
    fid = parsed(UNNAMED)
    r = api_client.post(f"/files/{fid}/datasets")
    assert r.status_code == 409
    assert r.json()["error"] == "unresolved" and r.json()["components"] == ["comp_2"]
    ds = confirm(api_client, fid, overrides={"comp_2": {"value": 0.4, "note": "guess"}})
    assert ds["resolved_k"][1]["k"] == 0.4 and ds["segments"][1]["k_match"] == "user"
    assert ds["segments"][1] | {"k_source": None} == {
        "component_id": "comp_2",
        "type": "unclassified",
        "d_m": 0.012,
        "length_m": 0.0,
        "k": 0.4,
        "k_ref_d_m": 0.012,
        "k_source": None,
        "k_match": "user",
    }


def test_confirm_setup_invalid(api_client, parsed):
    fid = parsed(FEED_LINE)
    api_client.put(
        f"/files/{fid}/setup", json=setup_body(fluid={**WATER_20C, "temperature_k": 400})
    )
    r = api_client.post(f"/files/{fid}/datasets")
    assert (r.status_code, r.json()["error"]) == (422, "setup_invalid")
    assert r.json()["detail"]["error"] == "not_liquid"


def test_dataset_contents_and_get(api_client, parsed):
    fid = parsed(FEED_LINE)
    ds = confirm(api_client, fid)
    assert ds["short_hash"] == ds["content_hash"][:4].upper() and len(ds["content_hash"]) == 64
    assert ds["stale"] is False and ds["file_id"] == fid
    assert ds["constants_versions"] == {
        "k_values": "2026.10.1",
        "materials": "2026.10.0",
        "fluids": "2026.10.1",
    }
    seg = {g["component_id"]: g for g in ds["segments"]}
    assert seg["comp_1"] == {
        "component_id": "comp_1",
        "type": "pipe",
        "d_m": 0.016,
        "length_m": 0.15,
        "k": None,
        "k_ref_d_m": None,
        "k_source": None,
        "k_match": None,
    }
    assert seg["comp_2"]["length_m"] == pytest.approx(0.05026548245743669)  # arc = angle * R
    assert seg["comp_3"]["length_m"] == 0 and seg["comp_3"]["d_m"] == 0.016
    assert (seg["comp_4"]["d_m"], seg["comp_4"]["length_m"]) == (0.01, 0.03)
    assert api_client.get(f"/datasets/{ds['id']}").json() == ds
    assert api_client.get(f"/files/{fid}/setup").json()["latest_dataset"] == {
        k: ds[k] for k in ("id", "short_hash", "content_hash", "created_at", "stale")
    }
    for bad in (uuid.uuid4(), "nope"):
        assert api_client.get(f"/datasets/{bad}").status_code == 404


def test_identical_confirms_share_content_hash(api_client, parsed):
    fid = parsed(FEED_LINE)
    a, b = confirm(api_client, fid), confirm(api_client, fid)
    assert a["id"] != b["id"] and a["content_hash"] == b["content_hash"]
    # Only the newest is current.
    assert api_client.get(f"/datasets/{a['id']}").json()["stale"] is True
    assert api_client.get(f"/datasets/{b['id']}").json()["stale"] is False
    c = confirm(api_client, fid, material="stainless_commercial")
    assert c["content_hash"] != a["content_hash"]


def test_content_hash_is_canonical():
    assert resolve_mod.sha256({"b": 1.0, "a": [0.1]}) == resolve_mod.sha256({"a": [0.1], "b": 1.0})
    assert resolve_mod.canonical_json({"b": 0.1, "a": 1e-6}) == '{"a":1e-06,"b":0.1}'


def test_datasets_are_immutable(api_client, parsed):
    import app.api.solve as routes

    assert not [n for n in dir(routes) if "update" in n.lower() and "dataset" in n.lower()]
    assert not any(
        "PATCH" in r.methods or "PUT" in r.methods
        for r in routes.router.routes
        if "/datasets" in r.path
    )
    ds = confirm(api_client, parsed(FEED_LINE))
    with get_sessionmaker()() as db:
        row = db.scalar(select(Dataset).where(Dataset.id == uuid.UUID(ds["id"])))
        row.solver_version = "tampered"
        with pytest.raises(RuntimeError, match="immutable"):
            db.commit()


def test_setup_change_makes_dataset_stale(api_client, parsed):
    fid = parsed(FEED_LINE)
    ds = confirm(api_client, fid)
    api_client.put(f"/files/{fid}/setup", json=setup_body(material="copper_drawn"))
    # Same roughness value, but the setup changed: stale. The dataset itself is untouched.
    got = api_client.get(f"/datasets/{ds['id']}").json()
    assert got["stale"] is True and got | {"stale": False} == ds
    assert api_client.get(f"/files/{fid}/setup").json()["latest_dataset"]["stale"] is True
    r = api_client.post(f"/datasets/{ds['id']}/solve", json={"mode": "dp", "value": 0.2})
    assert (r.status_code, r.json()["error"]) == (409, "dataset_stale")


# ---- solve --------------------------------------------------------------------------------


def test_solve_runs(api_client, parsed):
    fid = parsed(FEED_LINE)
    ds = confirm(api_client, fid)
    url = f"/datasets/{ds['id']}/solve"

    r = api_client.post(url, json={"mode": "dp", "value": 0.2})
    assert r.status_code == 201, r.text
    run = r.json()
    assert run["status"] == "complete" and run["result"]["total_dp_pa"] > 0
    assert run["dataset_id"] == ds["id"] and run["input_value"] == 0.2 and run["runtime_ms"] >= 0
    assert [g["component_id"] for g in run["result"]["segments"]] == FEED_LINE.ordered_path
    assert api_client.get(f"/solve_runs/{run['id']}").json() == run

    # Same dataset + same input = same result.
    again = api_client.post(url, json={"mode": "dp", "value": 0.2}).json()
    assert again["id"] != run["id"] and again["result"] == run["result"]

    # A different input needs no new dataset.
    other = api_client.post(url, json={"mode": "dp", "value": 0.3}).json()
    assert other["result"]["total_dp_pa"] > run["result"]["total_dp_pa"]
    inverse = api_client.post(url, json={"mode": "flow", "value": run["result"]["total_dp_pa"]})
    assert inverse.status_code == 201
    assert inverse.json()["result"]["mdot_kg_s"] == pytest.approx(0.2, rel=1e-6)
    assert api_client.get(f"/datasets/{ds['id']}").json()["stale"] is False
    with get_sessionmaker()() as db:
        assert len(db.scalars(select(Dataset)).all()) == 1

    for bad in (uuid.uuid4(), "nope"):
        assert api_client.get(f"/solve_runs/{bad}").status_code == 404
        assert (
            api_client.post(f"/datasets/{bad}/solve", json={"mode": "dp", "value": 1}).status_code
            == 404
        )


@pytest.mark.parametrize(
    "body",
    [
        {"mode": "dp", "value": 0},
        {"mode": "dp", "value": -1},
        {"mode": "pressure", "value": 1},
        {"mode": "dp"},
        {"mode": "dp", "value": "fast"},
        {"mode": "dp", "value": 1, "extra": True},
    ],
)
def test_solve_rejects_bad_input(api_client, parsed, body):
    ds = confirm(api_client, parsed(FEED_LINE))
    r = api_client.post(f"/datasets/{ds['id']}/solve", json=body)
    assert (r.status_code, r.json()["error"]) == (422, "validation_error")


# ---- ownership ------------------------------------------------------------------------------


def test_other_user_gets_404(api_client, parsed):
    fid = parsed(UNNAMED)
    ds = confirm(api_client, fid, overrides={"comp_2": "no_loss"})
    run = api_client.post(f"/datasets/{ds['id']}/solve", json={"mode": "dp", "value": 0.01}).json()

    api_client.app.dependency_overrides[current_user_id] = lambda: uuid.uuid4()
    try:
        calls = [
            ("get", f"/files/{fid}/setup", None),
            ("put", f"/files/{fid}/setup", setup_body()),
            ("post", f"/files/{fid}/resolve", None),
            ("post", f"/files/{fid}/datasets", None),
            ("get", f"/datasets/{ds['id']}", None),
            ("post", f"/datasets/{ds['id']}/solve", {"mode": "dp", "value": 1}),
            ("get", f"/solve_runs/{run['id']}", None),
        ]
        for method, path, body in calls:
            r = api_client.request(method, path, json=body)
            assert (r.status_code, r.json()["error"]) == (404, "not_found"), path
    finally:
        api_client.app.dependency_overrides.clear()
    # User A's setup is unchanged by user B's attempt.
    assert api_client.get(f"/files/{fid}/setup").json()["k_overrides"] == {"comp_2": "no_loss"}
