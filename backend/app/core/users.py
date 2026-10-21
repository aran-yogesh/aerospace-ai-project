"""Fixed dev user. Every row is scoped to a user_id; until auth exists, it is this one."""

from uuid import UUID

DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


def current_user_id() -> UUID:
    """FastAPI dependency. Replaced by real auth in a later phase."""
    return DEV_USER_ID
