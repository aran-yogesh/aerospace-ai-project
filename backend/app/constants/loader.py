"""Loads versioned constants tables from data/constants/*.yaml (stub)."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from app.core.config import get_settings


class ConstantsError(ValueError):
    pass


@dataclass(frozen=True)
class ConstantsTable:
    name: str
    version: str
    entries: dict[str, Any] = field(default_factory=dict)


def load_table(path: Path) -> ConstantsTable:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ConstantsError(f"{path.name}: top level must be a mapping")
    version = raw.get("version")
    if not version:
        raise ConstantsError(f"{path.name}: missing required 'version' field")
    entries = raw.get("entries", {})
    if not isinstance(entries, dict):
        raise ConstantsError(f"{path.name}: 'entries' must be a mapping")
    return ConstantsTable(name=path.stem, version=str(version), entries=entries)


def load_constants(directory: Path | None = None) -> dict[str, ConstantsTable]:
    """Load every *.yaml in the constants directory, keyed by file stem."""
    directory = directory or get_settings().data_dir / "constants"
    if not directory.is_dir():
        raise ConstantsError(f"constants directory not found: {directory}")
    return {p.stem: load_table(p) for p in sorted(directory.glob("*.yaml"))}
