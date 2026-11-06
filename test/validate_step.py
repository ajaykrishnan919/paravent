"""Validates every STEP file produced by scripts/make-samples.mjs with OpenCascade.

Checks for each file: it loads, the B-rep is valid (BRepCheck), the solid count matches,
and the total volume matches the analytic expectation to 1e-4 relative error.
Requires: pip install cadquery-ocp     Usage: python3 test/validate_step.py out
"""
import sys, glob, os, json
from OCP.STEPControl import STEPControl_Reader
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_SOLID
d = sys.argv[1]; exp = json.load(open(os.path.join(d, 'expected.json'))); ok = True
for f in sorted(glob.glob(os.path.join(d, '*.step'))):
    b = os.path.basename(f); r = STEPControl_Reader()
    if r.ReadFile(f) != IFSelect_RetDone: print('READ FAIL', b); ok = False; continue
    r.TransferRoots(); s = r.OneShape()
    valid = BRepCheck_Analyzer(s).IsValid()
    n = 0; vol = 0; neg = 0; e = TopExp_Explorer(s, TopAbs_SOLID)
    while e.More():
        g = GProp_GProps(); BRepGProp.VolumeProperties_s(e.Current(), g); v = g.Mass(); vol += v; neg += v < 0; n += 1; e.Next()
    E = exp[b]; err = abs(vol - E['expVol']) / max(E['expVol'], 1e-9)
    good = valid and neg == 0 and n == E['solids'] and err < 1e-4
    ok &= good
    print(f"{'OK ' if good else 'BAD'} {b:52s} valid={valid} solids={n}/{E['solids']} vol={vol:10.3f} exp={E['expVol']:10.3f} relerr={err:.1e}")
print('ALL OK' if ok else 'FAILURES')
