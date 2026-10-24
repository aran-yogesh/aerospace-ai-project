"""Constants loader: the shipped files are valid; invalid files stop the app from starting."""

import shutil

import pytest

from app.constants import ConstantsError, get_constants, load
from app.core.config import get_settings

SHIPPED = get_settings().data_dir / "constants"


def test_shipped_constants_load():
    c = load(SHIPPED)
    assert 18 <= len(c.k_values.entries) <= 25
    # Nothing is presented as verified until Rohith checks it.
    assert {e.status for e in c.k_values.entries.values()} == {"unverified"}
    assert all("Crane TP-410" in e.source for e in c.k_values.entries.values())
    assert c.materials.entries["stainless_drawn"].roughness_m == 1.524e-6
    assert set(c.fluids.coolprop) == {"Water", "Oxygen", "Nitrogen", "Hydrogen", "Methane"}
    assert "RP-1" in c.fluids.tables


@pytest.mark.parametrize(
    ("filename", "old", "new"),
    [
        ("k_values.yaml", "    status: unverified", "    status: maybe"),
        ("k_values.yaml", "family: valve_ball", "family: valve_magic"),
        ("k_values.yaml", "value: 0.069", "value: -1"),
        ("k_values.yaml", 'version: "2026.10.1"', "version: [oops"),
        ("materials.yaml", "roughness_m: 1.524e-6", "roughness_m: lots"),
        ("materials.yaml", "    label:", "    colour: red\n    label:"),
        ("fluids.yaml", "t_k: 270.0", "t_k: 240.0"),
        ("fluids.yaml", "Water: REFERENCE", "Mercury: REFERENCE"),
    ],
)
def test_invalid_file_is_refused(tmp_path, monkeypatch, filename, old, new):
    shutil.copytree(SHIPPED, tmp_path / "constants")
    path = tmp_path / "constants" / filename
    text = path.read_text()
    assert old in text
    path.write_text(text.replace(old, new, 1))
    with pytest.raises(ConstantsError, match=filename):
        load(tmp_path / "constants")

    # And the app refuses to start.
    from app.main import create_app

    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    get_constants.cache_clear()
    try:
        with pytest.raises(ConstantsError):
            create_app()
    finally:
        get_constants.cache_clear()


def test_missing_file_is_refused(tmp_path):
    shutil.copytree(SHIPPED, tmp_path / "constants")
    (tmp_path / "constants" / "materials.yaml").unlink()
    with pytest.raises(ConstantsError, match=r"materials\.yaml"):
        load(tmp_path / "constants")
