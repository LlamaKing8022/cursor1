# TowerWatch

MVP lifeguard assist system: **one camera per tower → edge AI → distress alert on a tower tablet**.

This does **not** replace a lifeguard. It watches the water continuously and pings the tower when someone may be in distress so a human can verify and respond.

## Architecture

```text
Tower camera (or demo scene)
        │
        ▼
 Edge worker (Jetson / PC in tower)
   1. detect people
   2. track IDs across frames
   3. score distress cues for ~3s
   4. post alert + annotated frame
        │
        ▼
 FastAPI server
   /api/alerts  /api/stream  /ws/alerts
        │
        ▼
 Tower tablet UI (browser)
   live feed · distress card · acknowledge / respond / false alarm
```

### Distress cues used in the MVP (rule-based)

- Little forward progress (stuck / not making way)
- Upright / vertical posture
- Bobbing in place
- Sudden size drop (possible submersion)

A real deployment would replace the HOG/demo detector with YOLO (or similar) and train a classifier on labeled beach footage from your towers.

## Quick start (demo, no camera needed)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# terminal 1
./scripts/run_server.sh

# terminal 2
./scripts/run_edge.sh
```

Or one command:

```bash
./scripts/run_demo.sh
```

Open **http://127.0.0.1:8000/** on a laptop/tablet.

The demo draws a synthetic ocean scene with swimmers. Every so often one enters a distress pattern; after the score holds for a few seconds, an alert appears on the tablet.

### Troubleshooting 404s

If the browser or devtools show lots of **404** responses:

1. **Wrong branch** — `main` only has a README. You need:
   ```bash
   git checkout cursor/tower-drowning-mvp-5351
   git pull
   ```
2. **Server not running** — start it from the project folder:
   ```bash
   source .venv/bin/activate
   ./scripts/run_demo.sh
   ```
3. **Only the API is running** — `./scripts/run_server.sh` alone is fine for **Video review**, but the live feed needs `./scripts/run_edge.sh` or `./scripts/run_demo.sh`.
4. **Run the doctor**:
   ```bash
   ./scripts/doctor.sh
   ```
5. Check **http://127.0.0.1:8000/api/health** — should return JSON with `"version": "0.3.0"`.

Hard-refresh the page: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows/Linux).

## Analyze real footage (upload a video)

The demo scene is only for wiring things up. To work on real conditions, open the
**Video review** tab and upload footage from a tower camera or a phone.

1. Start the server (`./scripts/run_server.sh`) and open http://127.0.0.1:8000/
2. Click **Video review**
3. Drop in a video (`mp4`, `mov`, `avi`, `mkv`, `webm`) and press **Analyze video**
4. Watch the annotated playback and step through each flagged moment
5. Mark every flag **Real distress**, **False alarm**, or **Unsure**

Analysis runs the same detect → track → score pipeline used live, so what you see in
review is what the tower would have alerted on.

### Detector choices for uploads

| Detector | Best for | Notes |
|----------|----------|-------|
| `motion` | Fixed tower camera | Background subtraction; default, no model download |
| `hog` | Upright bodies, shore/shallow | OpenCV person detector |
| `yolo` | Best accuracy | Needs `pip install ultralytics` |

Threshold and hold-time are adjustable per upload, so you can tune sensitivity against
your own footage instead of guessing.

### How labeling becomes training data

Detection and training are separate steps. The rules ship with sensible defaults, but
they only become beach-specific once they learn from your verdicts. Every label writes:

- a row in `data/labels/labels.jsonl` (time range, score, cues, verdict, notes)
- a padded clip in `data/labels/clips/<verdict>/` cut from the original video

That gives you a labeled clip dataset — the input a supervised distress model needs.
Export the log any time with **Export CSV** or `GET /api/labels/export.csv`.

Aim for a mix: real rescues and near-misses, plus the false alarms (surfers, kids
playing, waves) that a model must learn to ignore.

### No footage yet?

Generate a test clip with a scripted distress event:

```bash
python3 scripts/make_sample_video.py --seconds 70 --distress-at 12
```

Then upload `data/samples/sample_beach.mp4`.

## Use a real tower camera later

Edit `config/default.yaml`:

```yaml
camera:
  source: rtsp://user:pass@camera-ip/stream   # or 0 for webcam, or /path/video.mp4
```

Then restart the edge worker. For production accuracy, swap `HogPersonDetector` in `backend/app/pipeline/detector.py` for a YOLO model — the tracker / scorer / alert path stays the same.

## Suggested beach rollout

1. Mount one fixed camera per tower with a clear swim-zone view.
2. Run the edge box + tablet in the tower as an assist feed.
3. Log every alert outcome (true / false / unsure) from the tablet buttons.
4. Retrain distress scoring from those labels for your beach conditions.
5. Keep humans in the loop — never auto-dispatch from the model alone.

## Project layout

```text
backend/app/pipeline/   Detectors, tracker, distress scoring, rip zones
backend/app/analysis/   Video upload analysis, annotated output, label store
backend/app/alerts/     In-memory alert + status store
backend/app/main.py     FastAPI routes and WebSocket
edge/worker.py          Live camera loop that posts frames + alerts
frontend/               Tower tablet UI (live + video review)
config/default.yaml     Tower / camera / thresholds / rip / analysis settings
models/                 Install rip_seg.pt here after training
scripts/                run_*, make_sample_video, fetch/prepare/train RipVIS, smoke_test
data/                   uploads, analysis, labels, ripvis download (gitignored)
```

## API (MVP)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Tower tablet UI |
| GET | `/api/health` | Health check |
| POST | `/api/alerts` | Edge posts a distress alert |
| GET | `/api/alerts` | List alerts |
| POST | `/api/alerts/{id}/status` | Acknowledge / respond / dismiss |
| POST | `/api/stream/frame` | Edge uploads latest JPEG |
| GET | `/api/stream/latest.jpg` | Tablet polls live frame |
| POST | `/api/videos` | Upload footage and start analysis |
| GET | `/api/analysis/jobs` | List analysis jobs |
| GET | `/api/analysis/{id}/video` | Annotated review video |
| GET | `/api/analysis/{id}/snapshots/{name}` | Event snapshot |
| POST | `/api/analysis/{id}/events/{n}/label` | Save a verdict + training clip |
| GET | `/api/labels/export.csv` | Export the label log |
| WS | `/ws/alerts` | Live alerts + analysis progress |

## Tests

```bash
python3 scripts/smoke_test.py          # includes an end-to-end video analysis check
python3 scripts/smoke_test.py --fast   # skip the video test
```

## Rip current detection (RipVIS)

Most open-water rescues happen in rips. TowerWatch can overlay likely rip zones
and raise a **preventive advisory** when a swimmer stays inside one — before any
distress cue appears. That model is trained on **[RipVIS](https://huggingface.co/datasets/Irikos/RipVIS)**
(Dumitriu et al., CVPR 2025).

### License first

RipVIS is **CC BY-NC 4.0** with extra conditions: non-commercial, attribution
required, no full-dataset redistribution. Cite Dumitriu et al., CVPR 2025 if you
publish results. For commercial use contact the authors.

### One-time setup

```bash
# 1. Optional dependency for YOLO segmentation
pip install ultralytics

# 2. Download RipVIS (images ~8 GB for train+val; annotations-only is a few MB)
python3 scripts/fetch_ripvis.py                  # full train+val images
# python3 scripts/fetch_ripvis.py --annotations-only   # dry run
# python3 scripts/fetch_ripvis.py --videos             # also full videos (huge)

# 3. Convert to an Ultralytics YOLO-seg dataset
python3 scripts/prepare_ripvis.py

# 4. Train and install weights at models/rip_seg.pt
python3 scripts/train_rip_model.py               # GPU strongly recommended
# python3 scripts/train_rip_model.py --device cpu --epochs 5   # smoke train only

# 5. Turn it on
```

In `config/default.yaml`:

```yaml
rip:
  enabled: true
  weights: models/rip_seg.pt
```

Restart the edge worker / server. Live and video-review feeds will tint rip zones
and can raise `rip_advisory` alerts when a tracked swimmer stays inside one.

### How it plugs into distress scoring

- Swimmers inside a rip get a score boost.
- Being *carried seaward* in a rip is treated as danger, not “strong swimming”.
- A separate timer raises a preventive advisory after ~6s in a rip, even with no
  distress cues yet.

RipVIS is a head start on ocean geometry — still fine-tune later on your own
tower camera once you have labeled beach footage.

## Next upgrades

- YOLO person detection on an NVIDIA Jetson in each tower
- Thermal camera for glare / dusk
- Multi-tower map on a central board
- Supervised distress model trained on your beach’s labeled clips
- Fine-tune the RipVIS rip model on local tower footage