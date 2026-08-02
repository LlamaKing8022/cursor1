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
backend/app/          FastAPI server + alert store + pipeline library
edge/worker.py        Camera loop that posts frames + alerts
frontend/             Tower tablet UI
config/default.yaml   Tower / camera / thresholds
scripts/              run_server / run_edge / run_demo
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
| WS | `/ws/alerts` | Live alert push |

## Next upgrades

- YOLO person detection on an NVIDIA Jetson in each tower
- Thermal camera for glare / dusk
- Multi-tower map on a central board
- Rip-current zone overlays
- Supervised model trained on your beach’s labeled clips