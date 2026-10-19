import os
from pathlib import Path

import pytest

from scripts.gen_ts_types import render_api

API_TYPES_OUT = Path(os.environ.get("TYPES_OUT", "/types/geometry.ts")).with_name("api.ts")


@pytest.mark.skipif(not API_TYPES_OUT.parent.is_dir(), reason="desktop types dir not mounted")
def test_desktop_api_types_are_up_to_date():
    assert API_TYPES_OUT.read_text() == render_api(), "run `make types`"


def test_api_types_cover_contract_models():
    text = render_api()
    for name in ("Project", "ProjectDetail", "FileInfo", "FileStatusEvent", "ProjectList"):
        assert f"export interface {name} {{" in text
    assert 'import type { ParseError } from "./geometry"' in text
    assert '"uploaded" | "parsing" | "parsed" | "failed"' in text
