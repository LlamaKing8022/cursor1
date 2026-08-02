const state = {
  alerts: [],
  selectedId: null,
  status: null,
  jobs: [],
  activeJobId: null,
  labelSummary: null,
  labeled: new Set(),
};

const $ = (id) => document.getElementById(id);

const els = {
  liveFeed: $("liveFeed"),
  towerLabel: $("towerLabel"),
  zoneLabel: $("zoneLabel"),
  modeLabel: $("modeLabel"),
  connPill: $("connPill"),
  versionPill: $("versionPill"),
  ripPill: $("ripPill"),
  trackPill: $("trackPill"),
  fpsPill: $("fpsPill"),
  openCount: $("openCount"),
  activeAlert: $("activeAlert"),
  alertList: $("alertList"),
  viewLive: $("viewLive"),
  viewReview: $("viewReview"),
  uploadForm: $("uploadForm"),
  fileInput: $("fileInput"),
  fileDrop: $("fileDrop"),
  fileName: $("fileName"),
  detectorSelect: $("detectorSelect"),
  fpsInput: $("fpsInput"),
  thresholdInput: $("thresholdInput"),
  holdInput: $("holdInput"),
  uploadBtn: $("uploadBtn"),
  uploadStatus: $("uploadStatus"),
  progressWrap: $("progressWrap"),
  progressBar: $("progressBar"),
  reviewVideo: $("reviewVideo"),
  playerTitle: $("playerTitle"),
  playerMeta: $("playerMeta"),
  eventList: $("eventList"),
  eventCount: $("eventCount"),
  labelSummary: $("labelSummary"),
  jobList: $("jobList"),
};

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- live tower view ---------- */

function openAlerts() {
  return state.alerts.filter((a) => a.status === "open");
}

function selectedAlert() {
  if (state.selectedId) {
    return state.alerts.find((a) => a.id === state.selectedId) || null;
  }
  return openAlerts()[0] || state.alerts[0] || null;
}

async function setAlertStatus(alertId, status) {
  await fetch(`/api/alerts/${alertId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

function renderActive() {
  const alert = selectedAlert();
  if (!alert) {
    els.activeAlert.className = "active-alert empty";
    els.activeAlert.innerHTML = `
      <p class="empty-title">No active distress</p>
      <p class="empty-copy">
        When the edge model holds a high score, the clip and reasons appear here.
      </p>`;
    return;
  }

  const isRip = alert.kind === "rip_advisory";
  els.activeAlert.className = `active-alert${isRip ? " advisory" : ""}`;
  const img = alert.frame_jpeg_b64
    ? `<img alt="Alert snapshot" src="data:image/jpeg;base64,${alert.frame_jpeg_b64}" />`
    : "";
  const reasons = (alert.reasons || []).map((r) => `<li>${r}</li>`).join("");
  const heading = isRip ? "Rip current advisory" : "Possible distress";

  els.activeAlert.innerHTML = `
    ${img}
    <div class="meta-row">
      <div>
        <strong>${heading} · track #${alert.track_id}</strong>
        <div class="tiny">${alert.zone || "Zone"} · ${fmtTime(alert.created_at)}</div>
      </div>
      <div class="score">${
        isRip
          ? `rip ${Math.round((alert.rip_risk || 0) * 100)}%`
          : `${Math.round(alert.score * 100)}% score`
      }</div>
    </div>
    <ul class="reasons">${reasons}</ul>
    <div class="actions">
      <button class="primary" data-act="responding">Responding</button>
      <button class="secondary" data-act="acknowledged">Acknowledge</button>
      <button class="ghost" data-act="dismissed">False alarm</button>
    </div>`;

  els.activeAlert.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => setAlertStatus(alert.id, btn.dataset.act));
  });
}

function renderAlertList() {
  els.openCount.textContent = `${openAlerts().length} open`;
  els.alertList.innerHTML = "";
  state.alerts.slice(0, 30).forEach((alert) => {
    const card = document.createElement("div");
    const isRip = alert.kind === "rip_advisory";
    card.className = "alert-card";
    card.innerHTML = `
      <div class="row">
        <strong>${isRip ? "Rip" : "Distress"} · #${alert.track_id}</strong>
        <span class="badge ${alert.status}">${alert.status}</span>
      </div>
      <div class="tiny">${fmtTime(alert.created_at)} · ${
        isRip
          ? `rip risk ${(alert.rip_risk || 0).toFixed(2)}`
          : `score ${alert.score.toFixed(2)}`
      }</div>`;
    card.addEventListener("click", () => {
      state.selectedId = alert.id;
      renderActive();
      renderAlertList();
    });
    els.alertList.appendChild(card);
  });
}

function renderStatus() {
  const s = state.status;
  if (!s) return;
  els.towerLabel.textContent = `${s.tower_name} · ${s.zone || "patrol zone"}`;
  els.zoneLabel.textContent = s.zone || "Zone";
  els.modeLabel.textContent = `source: ${s.pipeline_mode}`;
  els.trackPill.textContent = `${s.tracks} tracks`;
  els.fpsPill.textContent = `${s.fps} fps`;
  if (s.rip_enabled) {
    els.ripPill.classList.remove("hidden");
    els.ripPill.textContent = `rip zones ${Math.round((s.rip_coverage || 0) * 100)}%`;
  } else {
    els.ripPill.classList.add("hidden");
  }
}

/* ---------- video review view ---------- */

function activeJob() {
  return state.jobs.find((j) => j.id === state.activeJobId) || null;
}

function renderJobs() {
  els.jobList.innerHTML = "";
  if (!state.jobs.length) {
    els.jobList.innerHTML = `<p class="empty-copy tiny">Nothing analyzed yet.</p>`;
    return;
  }
  state.jobs.slice(0, 12).forEach((job) => {
    const row = document.createElement("div");
    row.className = "alert-card" + (job.id === state.activeJobId ? " selected" : "");
    const count = job.result ? job.result.events.length : 0;
    row.innerHTML = `
      <div class="row">
        <strong title="${job.video_name}">${job.video_name}</strong>
        <span class="badge ${job.status === "done" ? "acknowledged" : job.status === "error" ? "open" : "dismissed"}">${job.status}</span>
      </div>
      <div class="tiny">${job.status === "done" ? `${count} events` : job.message}</div>`;
    row.addEventListener("click", () => selectJob(job.id));
    els.jobList.appendChild(row);
  });
}

function renderEvents() {
  const job = activeJob();
  els.eventList.innerHTML = "";
  if (!job || !job.result) {
    els.eventCount.textContent = "0";
    els.eventList.innerHTML = `<p class="empty-copy">Upload footage to see flagged moments here.</p>`;
    return;
  }
  const events = job.result.events || [];
  els.eventCount.textContent = String(events.length);
  if (!events.length) {
    els.eventList.innerHTML = `
      <p class="empty-copy">
        No distress flagged. Try a lower threshold or shorter hold time, then re-run.
      </p>`;
    return;
  }

  events.forEach((event) => {
    const key = `${job.id}:${event.index}`;
    const card = document.createElement("div");
    card.className = "event-card";
    const snapshot = event.snapshot
      ? `<img alt="Event ${event.index}" src="/api/analysis/${job.id}/snapshots/${event.snapshot}" />`
      : "";
    const reasons = (event.reasons || []).map((r) => `<li>${r}</li>`).join("");
    card.innerHTML = `
      ${snapshot}
      <div class="meta-row">
        <div>
          <strong>${fmtClock(event.start_time)}</strong>
          <div class="tiny">track #${event.track_id} · ${event.duration.toFixed(1)}s</div>
        </div>
        <div class="score">${Math.round(event.peak_score * 100)}%</div>
      </div>
      <ul class="reasons tiny">${reasons}</ul>
      <div class="actions">
        <button class="secondary" data-seek="1">Jump to ${fmtClock(event.start_time)}</button>
      </div>
      <div class="actions label-actions">
        <button class="primary" data-label="true_positive">Real distress</button>
        <button class="ghost" data-label="false_positive">False alarm</button>
        <button class="ghost" data-label="unsure">Unsure</button>
      </div>
      <div class="label-state tiny" data-state="1">${
        state.labeled.has(key) ? "labeled ✓" : ""
      }</div>`;

    card.querySelector("[data-seek]").addEventListener("click", () => {
      els.reviewVideo.currentTime = Math.max(0, event.start_time - 1.5);
      els.reviewVideo.play().catch(() => {});
      els.reviewVideo.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    card.querySelectorAll("button[data-label]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const stateEl = card.querySelector("[data-state]");
        stateEl.textContent = "saving…";
        try {
          const res = await fetch(
            `/api/analysis/${job.id}/events/${event.index}/label`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: btn.dataset.label }),
            }
          );
          if (!res.ok) throw new Error(await res.text());
          state.labeled.add(key);
          stateEl.textContent = `saved: ${btn.dataset.label.replace("_", " ")} ✓`;
        } catch (err) {
          stateEl.textContent = "could not save label";
        }
      });
    });

    els.eventList.appendChild(card);
  });
}

function renderPlayer() {
  const job = activeJob();
  if (!job) {
    els.playerTitle.textContent = "Reviewed footage";
    els.playerMeta.textContent = "";
    return;
  }
  els.playerTitle.textContent = job.video_name;
  if (job.result) {
    const r = job.result;
    els.playerMeta.textContent = `${fmtClock(r.duration)} · ${r.detector} detector · analyzed at ${r.processed_fps.toFixed(1)} fps`;
    const src = r.annotated_video
      ? `/api/analysis/${job.id}/video`
      : `/api/analysis/${job.id}/source`;
    if (!els.reviewVideo.src.endsWith(src)) {
      els.reviewVideo.src = src;
    }
  } else {
    els.playerMeta.textContent = job.message || job.status;
  }
}

function selectJob(jobId) {
  state.activeJobId = jobId;
  renderJobs();
  renderPlayer();
  renderEvents();
}

function renderLabelSummary() {
  const summary = state.labelSummary;
  if (!summary || !summary.total) {
    els.labelSummary.textContent = "No labels yet.";
    return;
  }
  const counts = summary.counts || {};
  const parts = Object.entries(counts).map(
    ([k, v]) => `<span class="chip">${k.replace("_", " ")}: ${v}</span>`
  );
  els.labelSummary.innerHTML = `<strong>${summary.total} labeled</strong><div class="chips">${parts.join("")}</div>`;
}

function upsertJob(job) {
  const idx = state.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) state.jobs[idx] = job;
  else state.jobs.unshift(job);

  if (!state.activeJobId || state.activeJobId === job.id) {
    state.activeJobId = job.id;
  }

  if (job.status === "running") {
    els.progressWrap.classList.remove("hidden");
    els.progressBar.style.width = `${job.progress}%`;
    els.uploadStatus.textContent = `${job.video_name}: ${job.message}`;
  } else if (job.status === "done") {
    els.progressWrap.classList.add("hidden");
    els.uploadBtn.disabled = false;
    els.uploadStatus.textContent = `${job.video_name}: ${job.message}`;
  } else if (job.status === "error") {
    els.progressWrap.classList.add("hidden");
    els.uploadBtn.disabled = false;
    els.uploadStatus.textContent = `Failed: ${job.error}`;
  }

  renderJobs();
  renderPlayer();
  renderEvents();
}

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files[0];
  els.fileName.textContent = file ? file.name : "Choose a video file";
});

["dragover", "dragenter"].forEach((evt) =>
  els.fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    els.fileDrop.classList.add("hover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.fileDrop.addEventListener(evt, (e) => {
    e.preventDefault();
    els.fileDrop.classList.remove("hover");
  })
);
els.fileDrop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) {
    els.fileInput.files = e.dataTransfer.files;
    els.fileName.textContent = file.name;
  }
});

els.uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = els.fileInput.files[0];
  if (!file) {
    els.uploadStatus.textContent = "Pick a video file first.";
    return;
  }
  const form = new FormData();
  form.append("file", file);
  form.append("detector", els.detectorSelect.value);
  form.append("target_fps", els.fpsInput.value);
  form.append("score_threshold", els.thresholdInput.value);
  form.append("confirm_seconds", els.holdInput.value);

  els.uploadBtn.disabled = true;
  els.uploadStatus.textContent = "Uploading…";
  els.progressWrap.classList.remove("hidden");
  els.progressBar.style.width = "2%";

  try {
    const res = await fetch("/api/videos", { method: "POST", body: form });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: "upload failed" }));
      throw new Error(detail.detail || "upload failed");
    }
    const job = await res.json();
    els.uploadStatus.textContent = "Queued for analysis…";
    upsertJob(job);
  } catch (err) {
    els.uploadStatus.textContent = `Error: ${err.message}`;
    els.uploadBtn.disabled = false;
    els.progressWrap.classList.add("hidden");
  }
});

/* ---------- tabs + socket ---------- */

function showView(view) {
  const review = view === "review";
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === (review ? "review" : "live"));
  });
  els.viewReview.classList.toggle("hidden", !review);
  els.viewLive.classList.toggle("hidden", review);
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    location.hash = tab.dataset.view === "review" ? "#review" : "#live";
  });
});

window.addEventListener("hashchange", () => showView(location.hash.replace("#", "")));
showView(location.hash.replace("#", "") || "live");

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/alerts`);

  ws.onopen = () => {
    els.connPill.textContent = "Live";
    els.connPill.className = "pill ok";
  };
  ws.onclose = () => {
    els.connPill.textContent = "Reconnecting";
    els.connPill.className = "pill bad";
    setTimeout(connectWs, 1500);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === "snapshot") {
      state.alerts = msg.alerts || [];
      state.status = msg.status;
      state.jobs = msg.jobs || [];
      state.labelSummary = msg.label_summary;
      if (!state.activeJobId && state.jobs.length) state.activeJobId = state.jobs[0].id;
      renderActive();
      renderAlertList();
      renderStatus();
      renderJobs();
      renderPlayer();
      renderEvents();
      renderLabelSummary();
    } else if (msg.type === "alert" || msg.type === "alert_update") {
      const alert = msg.alert;
      const idx = state.alerts.findIndex((a) => a.id === alert.id);
      if (idx >= 0) state.alerts[idx] = alert;
      else state.alerts.unshift(alert);
      if (alert.status === "open") state.selectedId = alert.id;
      renderActive();
      renderAlertList();
    } else if (msg.type === "tower_status") {
      state.status = msg.status;
      renderStatus();
    } else if (msg.type === "analysis_job") {
      upsertJob(msg.job);
    } else if (msg.type === "label") {
      state.labelSummary = msg.summary;
      renderLabelSummary();
    }
  };

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 15000);
}

function refreshFeed() {
  if (els.viewLive.classList.contains("hidden")) return;
  els.liveFeed.src = `/api/stream/latest.jpg?t=${Date.now()}`;
}

fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    els.versionPill.textContent = `v${h.version}`;
    if (!h.has_live_frame && h.hint) {
      els.towerLabel.textContent = h.hint;
      els.modeLabel.textContent = "camera idle";
    }
  })
  .catch(() => {
    els.towerLabel.textContent = "Cannot reach server — is ./scripts/run_server.sh running?";
    els.connPill.textContent = "Offline";
    els.connPill.className = "pill bad";
  });

connectWs();
setInterval(refreshFeed, 350);
refreshFeed();
renderActive();
renderAlertList();
renderJobs();
renderEvents();
renderLabelSummary();