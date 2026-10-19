import os
from pathlib import Path

import pytest

from scripts.gen_ts_types import render

TYPES_OUT = Path(os.environ.get("TYPES_OUT", "/types/geometry.ts"))


@pytest.mark.skipif(not TYPES_OUT.parent.is_dir(), reason="desktop types dir not mounted")
def test_desktop_types_are_up_to_date():
    assert TYPES_OUT.read_text() == render(), "run `make types`"
