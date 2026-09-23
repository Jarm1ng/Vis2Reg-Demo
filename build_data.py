#!/usr/bin/env python3
"""Build local viewer data from the external Patient 4 source.
Exports raw mesh coordinates using one liver-based normalization and saved manual poses.
The earlier layout-tool affine diagnostic was unused by the exported vertices and is omitted.
This does not establish internal registration accuracy or the provenance of an existing export.
Set VIS2REG_SOURCE_ROOT to the patient4 source directory. Output stays beside this script.
Requires NumPy; background images are encoded separately by build_frames.sh (FFmpeg).
"""
import json, os, numpy as np
from pathlib import Path

if not os.environ.get("VIS2REG_SOURCE_ROOT"):
    raise SystemExit("Set VIS2REG_SOURCE_ROOT to the external patient4 source directory before rebuilding.")
ROOT = Path(os.environ["VIS2REG_SOURCE_ROOT"]).expanduser().resolve()
LWT = ROOT / "Liver_with_Tumour"
SESS = ROOT / "patient4_liver1_compressed_clip_0_57_sampled_30pct_manual_registration"
DATA = Path(__file__).resolve().parent / "data"
DATA.mkdir(parents=True, exist_ok=True)
FX = FY = 1920.0; CX = 960.0; CY = 540.0; W = 1920; H = 1080

def load(p):
    vs, fs = [], []
    for ln in Path(p).open(errors="ignore"):
        if ln.startswith("v "):
            a = ln.split(); vs.append([float(a[1]), float(a[2]), float(a[3])])
        elif ln.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in ln.split()[1:] if t.split("/")[0]]
            for i in range(1, len(idx) - 1): fs.append([idx[0], idx[i], idx[i + 1]])
    return np.asarray(vs, float), np.asarray(fs, int)

def rot(rx, ry, rz):
    rx, ry, rz = np.deg2rad([rx, ry, rz])
    cx, sx = np.cos(rx), np.sin(rx); cy, sy = np.cos(ry), np.sin(ry); cz, sz = np.cos(rz), np.sin(rz)
    Rx = np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]]); Ry = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    Rz = np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])
    return Rz @ Ry @ Rx

FILES = {"liver":"patient4_3D-liver-model.obj","tumor2":"tumor2.obj","tumour":"tumour.obj","vena_cava":"vena-cava.obj"}
for source in [*(LWT / name for name in FILES.values()), SESS / "transforms.json"]:
    if not source.is_file():
        raise SystemExit(f"Missing rebuild source: {source}\nSet VIS2REG_SOURCE_ROOT to your patient4 source directory.")
raw = {k: load(LWT/f) for k,f in FILES.items()}
lv = raw["liver"][0]; C_L = lv.mean(0, keepdims=True); E_L = float(np.abs(lv-C_L).max())
def to_video(k):
    # Shared source coordinates; no independent hand-tuned structure transforms.
    return (raw[k][0] - C_L) / E_L
verts = {k: to_video(k) for k in FILES}

# Store an orbit target and extent; do not shift exported vertices.
allv = np.vstack([verts[k] for k in FILES]); ctr = allv.mean(0); rad = float(np.linalg.norm(allv-ctr,axis=1).max())
COLORS = {"liver":[236,238,245],"tumour":[255,200,40],"tumor2":[255,170,60],"vena_cava":[70,120,255]}
meshes = {}
for k in FILES:
    v = verts[k]
    meshes[k] = {"v":[round(x,4) for x in v.flatten().tolist()],
                 "f":raw[k][1].flatten().tolist(),
                 "color":COLORS[k], "n":len(v)}
json.dump({"meshes":meshes,"center":ctr.tolist(),"radius":rad,
           "labels":{"liver":"Liver","tumour":"Tumour 1","tumor2":"Tumour 2","vena_cava":"Vena cava"}},
          open(DATA/"meshes.json","w"))
print("meshes.json written; assembly center",np.round(ctr,3),"radius",round(rad,3))

# per-frame model matrices: world = diag(1,-1,-1) * ( R*s*mirror*p + t )   (column-major 16)
flipYZ = np.diag([1.0,-1.0,-1.0])
data = json.load(open(SESS/"transforms.json")); frames=[]
for fr in data["frames"]:
    p = fr["pose"]; mx = -1.0 if p.get("mirror_x") else 1.0
    L = flipYZ @ rot(p["rx_deg"],p["ry_deg"],p["rz_deg"]) @ (p["scale"]*np.diag([mx,1.0,1.0]))
    T = flipYZ @ np.array([p["tx"],p["ty"],p["tz"]])
    Mcol = [L[0,0],L[1,0],L[2,0],0, L[0,1],L[1,1],L[2,1],0, L[0,2],L[1,2],L[2,2],0, T[0],T[1],T[2],1]
    frames.append({"i":fr["index"],"m":[round(x,6) for x in Mcol],"c":bool(fr.get("confirmed"))})
fov = float(np.degrees(2*np.arctan((H/2)/FY)))
json.dump({"fx":FX,"fy":FY,"cx":CX,"cy":CY,"W":W,"H":H,"fovY":fov,"aspect":W/H,
           "fps":data.get("fps",25),"count":len(frames),"frames":frames}, open(DATA/"frames.json","w"))
print(f"frames.json written: {len(frames)} frames, fovY={fov:.2f}deg")
