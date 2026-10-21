"""Upload storage layout inside settings.uploads_dir (a Docker named volume, never the repo).

Keys are relative paths stored in the database, so the volume can be remounted elsewhere:
    <user_id>/<file_id>.step        the uploaded STEP file, byte for byte
    <user_id>/<file_id>.mesh.json   tessellated three-cad-viewer Shapes dict
"""

from pathlib import Path
from uuid import UUID

from app.core.config import get_settings


def step_key(user_id: UUID, file_id: UUID) -> str:
    return f"{user_id}/{file_id}.step"


def mesh_key(user_id: UUID, file_id: UUID) -> str:
    return f"{user_id}/{file_id}.mesh.json"


def resolve(key: str) -> Path:
    root = get_settings().uploads_dir.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"storage key escapes uploads dir: {key!r}")
    return path
