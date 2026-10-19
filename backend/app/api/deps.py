from uuid import UUID

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.base import UserOwned


def parse_id(raw: str) -> UUID | None:
    try:
        return UUID(raw)
    except ValueError:
        return None


def load_owned[T: UserOwned](db: Session, model: type[T], raw_id: str, user_id: UUID) -> T:
    """Fetch a row by id scoped to user_id. Malformed ids and other users' rows are 404."""
    row_id = parse_id(raw_id)
    row = db.get(model, row_id) if row_id else None
    if row is None or row.user_id != user_id:
        raise AppError("not_found", f"{model.__name__} {raw_id} not found.", status_code=404)
    return row
