"""STEP reading through OCP XCAF: keeps the assembly tree, part names and instance locations.

Geometry is converted to METERS at read time: the XCAF document's length unit is set to meters
before transfer, so STEPCAFControl scales whatever unit the file declares (mm, inch, m, ...).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TCollection import TCollection_ExtendedString
from OCP.TColStd import TColStd_SequenceOfAsciiString
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label, TDF_LabelSequence
from OCP.TDocStd import TDocStd_Document
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Shape
from OCP.UnitsMethods import UnitsMethods_LengthUnit_Meter
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool


class ParserFailure(Exception):
    """Internal: converted to a ParseError at the process boundary."""

    def __init__(self, code: str, detail: str | None = None):
        super().__init__(code, detail)
        self.code = code
        self.detail = detail


@dataclass
class PartSolid:
    """One solid of one part instance, located in the global frame (meters)."""

    index: int  # order of appearance in the assembly tree
    name: str  # product (part) name
    path: str  # instance path, e.g. /feed_line/valve_station/Swagelok_BallValve_Cv6
    solid: TopoDS_Shape


@dataclass
class StepModel:
    solids: list[PartSolid]
    file_length_units: list[str]  # as declared in the file, e.g. ["millimetre"]


def _label_name(label: TDF_Label) -> str | None:
    attr = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
        name = attr.Get().ToExtString().strip()
        return name or None
    return None


def read_step(path: Path) -> StepModel:
    if not path.is_file():
        raise ParserFailure("unreadable_step", f"file not found: {path.name}")

    doc = TDocStd_Document(TCollection_ExtendedString("XmlOcaf"))
    # Target unit: meters. The reader scales the file's declared length unit to this.
    XCAFDoc_DocumentTool.SetLengthUnit_s(doc, 1.0, UnitsMethods_LengthUnit_Meter)

    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(False)
    reader.SetLayerMode(False)
    reader.SetPropsMode(False)
    reader.SetGDTMode(False)
    reader.SetMatMode(False)
    reader.SetViewMode(False)
    status = reader.ReadFile(str(path))
    if status != IFSelect_RetDone:
        raise ParserFailure("unreadable_step", f"STEP reader status {status.name}")

    length_names = TColStd_SequenceOfAsciiString()
    angle_names = TColStd_SequenceOfAsciiString()
    solid_names = TColStd_SequenceOfAsciiString()
    reader.ChangeReader().FileUnits(length_names, angle_names, solid_names)
    units = [length_names.Value(i).ToCString() for i in range(1, length_names.Length() + 1)]

    if not reader.Transfer(doc):
        raise ParserFailure("unreadable_step", "STEP transfer to XCAF document failed")

    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)

    solids: list[PartSolid] = []

    used_paths: dict[str, int] = {}

    def visit(label: TDF_Label, loc: TopLoc_Location, parent_path: str, inst_name: str | None):
        # Path segments use the product (part) name: instance names are often generated
        # ("Part1-1", or a bare number from some exporters). Repeated siblings get "[k]".
        ref_name = _label_name(label)
        name = ref_name or inst_name or f"part{len(solids) + 1}"
        here = f"{parent_path}/{name}"
        used_paths[here] = used_paths.get(here, 0) + 1
        if used_paths[here] > 1:
            here = f"{here}[{used_paths[here]}]"
        if XCAFDoc_ShapeTool.IsAssembly_s(label):
            comps = TDF_LabelSequence()
            XCAFDoc_ShapeTool.GetComponents_s(label, comps, False)
            for i in range(1, comps.Length() + 1):
                comp = comps.Value(i)
                ref = TDF_Label()
                if not XCAFDoc_ShapeTool.GetReferredShape_s(comp, ref):
                    continue
                comp_loc = XCAFDoc_ShapeTool.GetLocation_s(comp)
                visit(ref, loc.Multiplied(comp_loc), here, _label_name(comp))
            return
        shape = XCAFDoc_ShapeTool.GetShape_s(label)
        if shape.IsNull():
            return
        located = shape.Moved(loc)
        exp = TopExp_Explorer(located, TopAbs_SOLID)
        found: list[TopoDS_Shape] = []
        while exp.More():
            found.append(TopoDS.Solid_s(exp.Current()))
            exp.Next()
        part_name = name
        for k, solid in enumerate(found):
            suffix = f"#{k + 1}" if len(found) > 1 else ""
            solids.append(PartSolid(len(solids), part_name + suffix, here + suffix, solid))

    for i in range(1, free.Length() + 1):
        visit(free.Value(i), TopLoc_Location(), "", None)

    if not solids:
        raise ParserFailure("no_solids", "the STEP file contains no solid bodies")
    return StepModel(solids=solids, file_length_units=units)
