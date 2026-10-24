"""Phase 2 endpoints: fluids, materials, setup, K resolve, datasets (confirm) and solve runs.

Frozen vs free (docs/decisions/0006-dataset-confirm.md): a dataset freezes everything that
determines the answer except the operating point; solving at a new flow or dP reuses it.
"""

import time
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import solver
from app.api import resolve
from app.api.deps import load_owned
from app.api.files import _parsed_graph
from app.constants import Constants, get_constants
from app.constants.fluids import fluid_props, list_fluids
from app.core.errors import AppError
from app.core.users import current_user_id
from app.db.models import CadFile, Dataset, SolveRun, SolveSetup, SystemGraphRow
from app.db.session import get_db
from app.schema import solve as s
from app.schema.geometry import SystemGraph

router = APIRouter(tags=["solve"])

Db = Annotated[Session, Depends(get_db)]
UserId = Annotated[UUID, Depends(current_user_id)]
Consts = Annotated[Constants, Depends(get_constants)]

DEFAULT_SETUP = s.SetupIn(
    fluid=s.FluidIn(kind="coolprop", name="Water", temperature_k=293.15, pressure_pa=1.0e5),
    material_key="stainless_drawn",
)


@router.get("/fluids", response_model=s.FluidList)
def get_fluids(constants: Consts) -> s.FluidList:
    return s.FluidList(items=list_fluids(constants))


@router.get("/materials", response_model=s.MaterialList)
def get_materials(constants: Consts) -> s.MaterialList:
    m = constants.materials
    return s.MaterialList(
        version=m.version,
        items=[s.MaterialInfo(key=k, **e.model_dump()) for k, e in m.entries.items()],
    )


# ---- helpers ----------------------------------------------------------------------------


def _setup_row(db: Session, file_id: UUID) -> SolveSetup | None:
    return db.scalar(select(SolveSetup).where(SolveSetup.file_id == file_id))


def _current_setup(db: Session, file_id: UUID) -> s.SetupIn:
    row = _setup_row(db, file_id)
    if row is None:
        return DEFAULT_SETUP
    return s.SetupIn(fluid=row.fluid, material_key=row.material_key, k_overrides=row.k_overrides)


def _roughness(key: str, constants: Constants) -> s.Provenanced | None:
    m = constants.materials.entries.get(key)
    if m is None:  # a saved key that a newer materials.yaml dropped
        return None
    src = f"{m.source} (materials {constants.materials.version})"
    return s.Provenanced(value=m.roughness_m, unit="m", source=src)


def _graph_hash(row: SystemGraphRow) -> str:
    return resolve.sha256(row.graph)


def _line_graph(db: Session, file_id: str, user_id: UUID) -> tuple[SystemGraphRow, SystemGraph]:
    row = _parsed_graph(db, file_id, user_id)
    graph = SystemGraph.model_validate(row.graph)
    if graph.topology != "line" or not graph.ordered_path:
        detail = f"Only single-line systems solve; topology is {graph.topology}."
        raise AppError("network_topology", detail, 409)
    return row, graph


def _setup_snapshot(setup: s.SetupIn) -> dict:
    return setup.model_dump(mode="json")


def _is_stale(db: Session, ds: Dataset) -> bool:
    latest = db.scalar(
        select(Dataset.id)
        .where(Dataset.file_id == ds.file_id, Dataset.user_id == ds.user_id)
        .order_by(Dataset.created_at.desc())
        .limit(1)
    )
    if latest != ds.id:
        return True
    if _setup_snapshot(s.SetupIn.model_validate(ds.setup)) != _setup_snapshot(
        _current_setup(db, ds.file_id)
    ):
        return True
    graph = db.scalar(select(SystemGraphRow).where(SystemGraphRow.file_id == ds.file_id))
    return graph is None or _graph_hash(graph) != ds.graph_hash


def _latest_ref(db: Session, file_id: UUID) -> s.DatasetRef | None:
    ds = db.scalar(
        select(Dataset)
        .where(Dataset.file_id == file_id)
        .order_by(Dataset.created_at.desc())
        .limit(1)
    )
    if ds is None:
        return None
    return s.DatasetRef(
        id=ds.id,
        short_hash=ds.content_hash[:4].upper(),
        content_hash=ds.content_hash,
        created_at=ds.created_at,
        stale=_is_stale(db, ds),
    )


def _view(db: Session, file: CadFile, constants: Constants) -> s.SetupView:
    row = _setup_row(db, file.id)
    setup = _current_setup(db, file.id)
    props = fluid_props(setup.fluid, constants)
    return s.SetupView(
        **setup.model_dump(),
        updated_at=row.updated_at if row else None,
        props=props if isinstance(props, s.FluidProps) else None,
        props_error=props if isinstance(props, s.PropsError) else None,
        roughness=_roughness(setup.material_key, constants),
        latest_dataset=_latest_ref(db, file.id),
    )


def _dataset_view(db: Session, ds: Dataset) -> s.Dataset:
    return s.Dataset(
        id=ds.id,
        file_id=ds.file_id,
        content_hash=ds.content_hash,
        short_hash=ds.content_hash[:4].upper(),
        created_at=ds.created_at,
        stale=_is_stale(db, ds),
        graph_hash=ds.graph_hash,
        setup=ds.setup,
        resolved_k=ds.resolved_k,
        segments=ds.segments,
        fluid_props=ds.fluid_props,
        roughness=ds.roughness,
        constants_versions=ds.constants_versions,
        solver_version=ds.solver_version,
    )


# ---- setup --------------------------------------------------------------------------------


@router.get("/files/{file_id}/setup", response_model=s.SetupView)
def get_setup(file_id: str, db: Db, user_id: UserId, constants: Consts) -> s.SetupView:
    return _view(db, load_owned(db, CadFile, file_id, user_id), constants)


@router.put("/files/{file_id}/setup", response_model=s.SetupView)
def put_setup(
    file_id: str, body: s.SetupIn, db: Db, user_id: UserId, constants: Consts
) -> s.SetupView:
    file = load_owned(db, CadFile, file_id, user_id)
    if body.material_key not in constants.materials.entries:
        raise AppError("unknown_material", f"No material {body.material_key!r}.", 422)
    data = body.model_dump(mode="json")
    row = _setup_row(db, file.id)
    if row is None:
        db.add(SolveSetup(user_id=user_id, file_id=file.id, **data))
    else:
        row.fluid, row.material_key, row.k_overrides = (
            data["fluid"],
            data["material_key"],
            data["k_overrides"],
        )
    db.commit()
    return _view(db, file, constants)


# ---- resolve and confirm ---------------------------------------------------------------


@router.post(
    "/files/{file_id}/resolve",
    response_model=s.ResolveResult,
    responses={409: {"description": "not_parsed | network_topology"}},
)
def post_resolve(file_id: str, db: Db, user_id: UserId, constants: Consts) -> s.ResolveResult:
    graph_row, graph = _line_graph(db, file_id, user_id)
    setup = _current_setup(db, graph_row.file_id)
    roughness = _roughness(setup.material_key, constants)
    if roughness is None:
        raise AppError("setup_invalid", f"Unknown material {setup.material_key!r}.", 422)
    rows = resolve.resolve(graph, setup, roughness.value, constants)
    return s.ResolveResult(rows=rows, counts=resolve.counts(rows))


@router.post(
    "/files/{file_id}/datasets",
    status_code=201,
    response_model=s.Dataset,
    responses={
        409: {"description": "not_parsed | network_topology | unresolved"},
        422: {"description": "setup_invalid"},
    },
)
def confirm_dataset(file_id: str, db: Db, user_id: UserId, constants: Consts) -> s.Dataset:
    graph_row, graph = _line_graph(db, file_id, user_id)
    setup = _current_setup(db, graph_row.file_id)
    roughness = _roughness(setup.material_key, constants)
    if roughness is None:
        raise AppError("setup_invalid", f"Unknown material {setup.material_key!r}.", 422)
    rows = resolve.resolve(graph, setup, roughness.value, constants)
    missing = [r.component_id for r in rows if r.match == "missing"]
    if missing:
        raise AppError(
            "unresolved", f"{len(missing)} component(s) have no K.", 409, components=missing
        )
    props = fluid_props(setup.fluid, constants)
    if isinstance(props, s.PropsError):
        raise AppError("setup_invalid", props.model_dump(), 422)

    frozen = {
        "graph_hash": _graph_hash(graph_row),
        "setup": _setup_snapshot(setup),
        "resolved_k": [r.model_dump(mode="json") for r in rows],
        "segments": [g.model_dump(mode="json") for g in resolve.segments(graph, rows)],
        "fluid_props": props.model_dump(mode="json"),
        "roughness": roughness.model_dump(mode="json"),
        "constants_versions": constants.versions(),
        "solver_version": solver.SOLVER_VERSION,
    }
    ds = Dataset(
        user_id=user_id,
        file_id=graph_row.file_id,
        content_hash=resolve.sha256(frozen),
        **frozen,
    )
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return _dataset_view(db, ds)


@router.get("/datasets/{dataset_id}", response_model=s.Dataset)
def get_dataset(dataset_id: str, db: Db, user_id: UserId) -> s.Dataset:
    return _dataset_view(db, load_owned(db, Dataset, dataset_id, user_id))


# ---- solve --------------------------------------------------------------------------------


@router.post(
    "/datasets/{dataset_id}/solve",
    status_code=201,
    response_model=s.SolveRun,
    responses={409: {"description": "dataset_stale"}, 422: {"description": "solve_failed"}},
)
def solve_dataset(dataset_id: str, body: s.SolveIn, db: Db, user_id: UserId) -> s.SolveRun:
    ds = load_owned(db, Dataset, dataset_id, user_id)
    if _is_stale(db, ds):
        raise AppError("dataset_stale", "The setup or graph changed since this dataset.", 409)
    segments = [s.SegmentInput.model_validate(g) for g in ds.segments]
    fluid = s.FluidProps.model_validate(ds.fluid_props)
    roughness = ds.roughness["value"]
    start = time.perf_counter()
    try:
        if body.mode == "dp":
            result = solver.solve_forward(segments, fluid, roughness, body.value)
        else:
            result = solver.solve_inverse(segments, fluid, roughness, body.value)
    except ValueError as exc:
        raise AppError("solve_failed", str(exc), 422) from exc
    runtime_ms = (time.perf_counter() - start) * 1000
    run = SolveRun(
        user_id=user_id,
        dataset_id=ds.id,
        mode=body.mode,
        input_value=body.value,
        status=result.status,
        result=result.model_dump(mode="json"),
        runtime_ms=runtime_ms,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return s.SolveRun.model_validate(run)


@router.get("/solve_runs/{run_id}", response_model=s.SolveRun)
def get_solve_run(run_id: str, db: Db, user_id: UserId) -> s.SolveRun:
    return s.SolveRun.model_validate(load_owned(db, SolveRun, run_id, user_id))
