from uuid import UUID

from sqlalchemy import JSON, BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UserOwned


class Project(UserOwned, Base):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(200))


class File(UserOwned, Base):
    __tablename__ = "files"

    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(500))
    content_type: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(String(1000))


class Session(UserOwned, Base):
    __tablename__ = "sessions"

    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    title: Mapped[str | None] = mapped_column(String(200))


class ChatMessage(UserOwned, Base):
    __tablename__ = "chat_messages"

    session_id: Mapped[UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict | None] = mapped_column(JSON)
