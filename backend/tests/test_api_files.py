import uuid

import pytest

from app.core.users import DEV_USER_ID
from app.db.models import CadFile, Project
from app.db.session import get_sessionmaker
from app.schema.geometry import ParseError, Pipe, SystemGraph
from tests.conftest import FakeOutput, wait_for_status

STEP = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"

GRAPH = SystemGraph(
    components=[Pipe(id="comp_1", confidence=1.0, inner_diameter_m=0.012, length_m=0.5)],
    edges=[],
    inlet_id="comp_1",
    outlet_id="comp_1",
    ordered_path=["comp_1"],
    topology="line",
)
MESH = {
    "version": 3,
    "id": "/system",
    "name": "system",
    "parts": [{"id": "/system/comp_1", "name": "comp_1", "shape": {"vertices": [0.0]}}],
}


def ok_output(_path) -> FakeOutput:
    return FakeOutput(result=GRAPH, mesh=MESH, seconds=0.25)


def failed_output(_path) -> FakeOutput:
    return FakeOutput(ParseError(error="no_solids", detail="No solids found"), None, 0.1)


@pytest.fixture
def project_id(api_client) -> str:
    return api_client.post("/projects", json={"name": "files"}).json()["id"]


def upload(client, project_id, content=STEP, filename="line.step"):
    return client.post(f"/projects/{project_id}/files", files={"file": (filename, content)})


# ---- upload validation ---------------------------------------------------------------


@pytest.mark.parametrize("name", ["model.iges", "model.stl", "model", "model.step.txt"])
def test_upload_rejects_extension(api_client, project_id, fake_parser, name):
    fake = fake_parser(ok_output)
    r = upload(api_client, project_id, filename=name)
    assert r.status_code == 415
    assert r.json()["error"] == "unsupported_file_type"
    assert fake.calls == []


@pytest.mark.parametrize("name", ["A.STEP", "b.Stp", "c.stp"])
def test_upload_extension_case_insensitive(api_client, project_id, fake_parser, name):
    fake_parser(ok_output)
    r = upload(api_client, project_id, filename=name)
    assert r.status_code == 202
    assert r.json()["filename"] == name
    wait_for_status(api_client, r.json()["id"], {"parsed"})


def test_upload_too_large(api_client, api_settings, project_id, fake_parser, monkeypatch):
    fake_parser(ok_output)
    monkeypatch.setattr(api_settings, "max_upload_bytes", 1024)
    r = upload(api_client, project_id, content=STEP + b"x" * 2048)
    assert r.status_code == 413
    assert r.json()["error"] == "file_too_large"
    # Exactly at the limit is fine.
    r = upload(api_client, project_id, content=STEP + b"x" * (1024 - len(STEP)))
    assert r.status_code == 202


def test_upload_too_large_by_content_length(api_client, api_settings, project_id, monkeypatch):
    monkeypatch.setattr(api_settings, "max_upload_bytes", 1024)
    r = upload(api_client, project_id, content=STEP + b"x" * (200 * 1024))
    assert r.status_code == 413
    assert not any(p.is_file() for p in api_settings.uploads_dir.rglob("*"))


@pytest.mark.parametrize("content", [b"solid cube\nendsolid\n", b"", b"ISO-10303"])
def test_upload_rejects_non_step(api_client, api_settings, project_id, content):
    r = upload(api_client, project_id, content=content)
    assert r.status_code == 422
    assert r.json()["error"] == "not_step_file"
    assert not any(p.is_file() for p in api_settings.uploads_dir.rglob("*"))


def test_upload_accepts_bom_and_whitespace(api_client, project_id, fake_parser):
    fake_parser(ok_output)
    r = upload(api_client, project_id, content=b"\xef\xbb\xbf \r\n" + STEP)
    assert r.status_code == 202


def test_upload_unknown_project(api_client):
    for pid in (uuid.uuid4(), "nope"):
        r = upload(api_client, pid)
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"


def test_upload_missing_field(api_client, project_id):
    r = api_client.post(f"/projects/{project_id}/files", files={"other": ("a.step", STEP)})
    assert r.status_code == 422
    assert r.json()["error"] == "validation_error"


def test_upload_stores_file_under_user_dir(api_client, api_settings, project_id, fake_parser):
    fake = fake_parser(ok_output)
    body = upload(api_client, project_id).json()
    wait_for_status(api_client, body["id"], {"parsed"})
    stored = api_settings.uploads_dir / str(DEV_USER_ID) / f"{body['id']}.step"
    assert stored.read_bytes() == STEP
    assert fake.calls == [stored.resolve()]
    assert body["size_bytes"] == len(STEP)


# ---- status flow -------------------------------------------------------------------


def test_status_flow_to_parsed(api_client, project_id, fake_parser):
    fake = fake_parser(ok_output)
    fake.gate.clear()
    r = upload(api_client, project_id)
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "uploaded"
    assert body["error"] is None
    fid = body["id"]

    assert wait_for_status(api_client, fid, {"parsing"})["status"] == "parsing"
    assert api_client.get(f"/files/{fid}/graph").status_code == 409
    fake.gate.set()

    done = wait_for_status(api_client, fid, {"parsed", "failed"})
    assert done["status"] == "parsed"
    assert done["error"] is None
    assert done["component_count"] == 1
    assert done["parse_seconds"] == pytest.approx(0.25)
    assert done["parser_version"] == GRAPH.parser_version

    project = api_client.get(f"/projects/{project_id}").json()
    assert project["latest_file"] == done
    assert project["files"] == [done]


def test_status_flow_to_failed(api_client, project_id, fake_parser):
    fake_parser(failed_output)
    fid = upload(api_client, project_id).json()["id"]
    done = wait_for_status(api_client, fid, {"parsed", "failed"})
    assert done["status"] == "failed"
    assert done["error"] == {"error": "no_solids", "detail": "No solids found"}
    assert done["component_count"] is None
    r = api_client.get(f"/files/{fid}/graph")
    assert r.status_code == 409
    assert r.json()["error"] == "not_parsed"
    assert api_client.get(f"/files/{fid}/mesh").status_code == 409


def test_parser_crash_marks_failed(api_client, project_id, fake_parser):
    def boom(_path):
        raise RuntimeError("bug in fake")

    fake_parser(boom)
    fid = upload(api_client, project_id).json()["id"]
    done = wait_for_status(api_client, fid, {"parsed", "failed"})
    assert done["status"] == "failed"
    assert done["error"]["error"] == "internal_error"


def test_project_files_newest_first(api_client, project_id, fake_parser):
    fake_parser(ok_output)
    ids = [upload(api_client, project_id).json()["id"] for _ in range(3)]
    for fid in ids:
        wait_for_status(api_client, fid, {"parsed"})
    detail = api_client.get(f"/projects/{project_id}").json()
    assert [f["id"] for f in detail["files"]] == ids[::-1]
    assert detail["latest_file"]["id"] == ids[-1]
    listed = api_client.get("/projects").json()["items"][0]
    assert listed["latest_file"]["id"] == ids[-1]


def test_startup_marks_stuck_parsing_failed(api_settings, fake_parser):
    from fastapi.testclient import TestClient

    from app.main import create_app

    fake = fake_parser(ok_output)
    with get_sessionmaker()() as db:
        project = Project(user_id=DEV_USER_ID, name="restart")
        db.add(project)
        db.flush()
        stuck = CadFile(
            user_id=DEV_USER_ID,
            project_id=project.id,
            filename="a.step",
            size_bytes=1,
            storage_key="x/a.step",
            status="parsing",
        )
        db.add(stuck)
        db.commit()
        stuck_id = str(stuck.id)

    with TestClient(create_app()) as c:
        body = c.get(f"/files/{stuck_id}").json()
        assert body["status"] == "failed"
        assert body["error"]["error"] == "interrupted"
    assert fake.calls == []


# ---- graph + mesh ----------------------------------------------------------------


def test_graph_and_mesh_after_parse(api_client, project_id, fake_parser):
    fake_parser(ok_output)
    fid = upload(api_client, project_id).json()["id"]
    wait_for_status(api_client, fid, {"parsed"})

    r = api_client.get(f"/files/{fid}/graph")
    assert r.status_code == 200
    graph = SystemGraph.model_validate(r.json())
    assert graph == GRAPH

    r = api_client.get(f"/files/{fid}/mesh")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json() == MESH


def test_graph_mesh_file_404(api_client):
    for suffix in ("", "/graph", "/mesh"):
        for fid in (uuid.uuid4(), "bogus"):
            r = api_client.get(f"/files/{fid}{suffix}")
            assert r.status_code == 404
            assert r.json()["error"] == "not_found"
