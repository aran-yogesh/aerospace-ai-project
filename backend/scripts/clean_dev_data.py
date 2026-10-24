"""Delete dev-database projects named "Test · ..." and their uploaded files.

Usage (inside the lemma-core container): python -m scripts.clean_dev_data
"""

from sqlalchemy import delete, select

from app.core import storage
from app.db.models import CadFile, Project, SystemGraphRow
from app.db.session import get_sessionmaker

PREFIX = "Test ·"


def main() -> None:
    with get_sessionmaker()() as db:
        ids = db.scalars(select(Project.id).where(Project.name.startswith(PREFIX))).all()
        keys = db.scalars(select(CadFile.storage_key).where(CadFile.project_id.in_(ids))).all()
        keys += db.scalars(
            select(SystemGraphRow.mesh_key)
            .join(CadFile, CadFile.id == SystemGraphRow.file_id)
            .where(CadFile.project_id.in_(ids), SystemGraphRow.mesh_key.is_not(None))
        ).all()
        db.execute(delete(Project).where(Project.id.in_(ids)))  # files and graphs cascade
        db.commit()
    for key in keys:
        storage.resolve(key).unlink(missing_ok=True)
    print(f"deleted {len(ids)} test projects and {len(keys)} stored files")


if __name__ == "__main__":
    main()
