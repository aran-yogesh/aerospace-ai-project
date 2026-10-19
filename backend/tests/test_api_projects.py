import uuid

from app.core.users import DEV_USER_ID
from app.db.models import Project
from app.db.session import get_sessionmaker


def test_create_and_get_project(api_client):
    r = api_client.post("/projects", json={"name": "  Feed line  "})
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Feed line"
    assert body["latest_file"] is None
    uuid.UUID(body["id"])
    assert body["created_at"]

    r = api_client.get(f"/projects/{body['id']}")
    assert r.status_code == 200
    assert r.json() == {**body, "files": []}


def test_list_projects_newest_first(api_client):
    ids = [api_client.post("/projects", json={"name": f"p{i}"}).json()["id"] for i in range(3)]
    r = api_client.get("/projects")
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["items"]] == ids[::-1]


def test_list_is_scoped_to_dev_user(api_client):
    with get_sessionmaker()() as db:
        other = Project(user_id=uuid.uuid4(), name="someone else")
        db.add(other)
        db.commit()
        other_id = other.id
    mine = api_client.post("/projects", json={"name": "mine"}).json()
    assert [p["id"] for p in api_client.get("/projects").json()["items"]] == [mine["id"]]
    assert api_client.get(f"/projects/{other_id}").status_code == 404
    assert other_id != DEV_USER_ID


def test_get_unknown_project_404(api_client):
    for pid in (uuid.uuid4(), "not-a-uuid"):
        r = api_client.get(f"/projects/{pid}")
        assert r.status_code == 404
        assert r.json()["error"] == "not_found"


def test_create_project_validation(api_client):
    for payload in ({"name": ""}, {"name": "   "}, {"name": "x" * 201}, {}, {"name": 3}):
        r = api_client.post("/projects", json=payload)
        assert r.status_code == 422, payload
        assert r.json()["error"] == "validation_error"
    assert api_client.post("/projects", json={"name": "x" * 200}).status_code == 201
