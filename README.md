# Vis2Reg — Liver AR Studio

An interactive browser demonstration for exploring 3D liver anatomy alongside a recorded laparoscopic sequence.

**[Open the live demo](https://jarm1ng.github.io/Vis2Reg-Demo/)** · **[Open the third keyframe](https://jarm1ng.github.io/Vis2Reg-Demo/?case=p4video&frame=204)**

AE-CAI × PRiSM, MICCAI 2026 · AI in Medicine and Surgery Group, University of Leeds.

## Explore

- Switch between **AR overlay**, **Original**, a draggable **Compare** view, and orbitable **3D anatomy**.
- Reveal internal structures with liver transparency, individual layers, structure highlighting, and camera presets.
- Play, step through, or jump between keyframes of the **511-frame Patient 04 sequence** (approximately 56.9 seconds).
- Save up to 24 named views in your browser, including the camera, frame, layers and comparison position.
- Export a 1920-pixel-wide PNG with case and frame information.
- Use presentation mode, fullscreen, a guided tour, and light or dark themes.
- Explore manual pose, structure and deformation controls. Edits remain in your browser and can be exported as JSON.

The public site opens at **frame 204 (22.8 seconds)**, the third keyframe thumbnail. Add `?frame=0` to open the beginning, or `?frame=204` to link to a particular frame. Frames are zero-indexed.

## Run locally

Clone the repository, then double-click `launch.command` on macOS, or run:

```bash
git clone https://github.com/Jarm1ng/Vis2Reg-Demo.git
cd Vis2Reg-Demo
./serve.sh
```

Open **http://127.0.0.1:8777/index.html**. Keep the terminal running; press `Ctrl-C` to stop. Use `./serve.sh 8778` if the port is occupied. Python 3.7+ and a WebGL-capable browser are required. Opening `index.html` directly with `file://` is not supported.

All scripts, models and frames are bundled; no inference server, API key, CDN, or sign-in is required. Once downloaded, the local server can run without internet access.

**中文：** 克隆仓库后，在 macOS 双击 `launch.command`，或执行 `./serve.sh`，再打开上面的本地网址。公开版只包含 Patient 04 长视频病例；默认展示第 3 张关键帧（Frame 204，22.8 秒）。

## Controls

| Action | Key |
| --- | --- |
| AR / original / comparison / 3D | `1` / `2` / `3` / `4` |
| Play / pause | `Space` |
| Previous / next frame | `←` / `→` |
| Return to camera view | `R` |
| Save a view / export an image | `B` / `E` |
| Move / rotate / scale while editing | `G` / `T` / `S` |
| Close dialog or guide | `Esc` |

Input controls and dialogs retain their normal keyboard behavior. In 3D mode, drag to orbit and scroll to zoom.

## Data and scientific scope

This public release contains **only Patient 04**, with a liver mesh, two illustrative tumour structures, a vena cava structure, and a prepared laparoscopic sequence. The four LLR-LUS image sets used in the local workspace are **not distributed** here.

The viewer replays **saved manual liver registration**. It does not run the Vis2Reg registration inference pipeline or process a live surgical stream. Internal anatomy alignment is illustrative and unvalidated; camera lens distortion is not applied. This is a research demonstration, not a clinical navigation tool or a registration-accuracy benchmark.

Images were encoded for browser playback and meshes were converted to the bundled JSON representation. No additional accuracy claim follows from the visualization. See [DATA_NOTICE.md](DATA_NOTICE.md) for the asset scope and reuse notice.

## Browser storage

Views and edits use `localStorage` on the current website origin. They are not uploaded to a server. Localhost and the hosted website have separate storage. Export edits before changing browsers, changing ports, or clearing site data. Saved views store display settings, not copies of anatomical edits.

## Project

**Demonstration:** Jiaming Feng and Sharib Ali, AI in Medicine and Surgery Group, University of Leeds.

**Research:** Jiaming Feng, Xukun Zhang, Shahid Farid and Sharib Ali, *Vis2Reg: Visibility-Aware Landmark-Free Geometric 3D–2D Registration for Liver Laparoscopy*, MICCAI 2026. [Research implementation](https://github.com/aimsgroup-Leeds/Vis2Reg).

**Funding:** EPSRC Grant UKRI914.

## Development and deployment

```bash
node --check app.js
node --check experience.js
node --check studio.js
node --check saved-views.js
node --check case-library.js
node --test tests/*.test.cjs
bash -n serve.sh launch.command build_frames.sh
```

Node.js 18+ is needed only for these checks. The UI and WebGL rendering should also be checked in a real browser.

GitHub Pages serves the repository root from `main`. The `.nojekyll` file disables Jekyll processing; no build step is needed. Assets use relative URLs so that project-site paths work correctly.

To rebuild prepared data from separately obtained source files, set `VIS2REG_SOURCE_ROOT` and run `build_data.py` (NumPy) and `build_frames.sh` (FFmpeg). Rebuilding is optional and is not needed to run this repository.

## Notices

Three.js r128 and its controls retain their original MIT terms; see [lib/LICENSE.threejs.txt](lib/LICENSE.threejs.txt). No new reuse license is assigned here to project-authored code or demonstration data. Contact the maintainers regarding reuse; third-party notices apply to their respective files.
