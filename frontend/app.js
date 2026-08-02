const state = {
  alerts: [],
  selectedId: null,
  status: null,
};

const els = {
  liveFeed: document.getElementById("liveFeed"),
  towerLabel: document.getElementById("towerLabel"),
  zoneLabel: document.getElementById("zoneLabel"),
  modeLabel: document.getElementById("modeLabel"),
  connPill: document.getElementById("connPill"),
  trackPill: document.getElementById("trackPill"),
  fpsPill: document.getElementById("fpsPill"),
  openCount: document.getElementById("openCount"),
  activeAlert: document.getElementById("activeAlert"),
  alertList: document.getElementById("alertList"),
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

function openAlerts() {
  return state.alerts.filter((a) => a.status === "open");
}

function selectedAlert() {
  if (state.selectedId) {
    return state.alerts.find((a) => a.id === state.selectedId) || null;
  }
  return openAlerts()[0] || state.alerts[0] || null;
}

async function setStatus(alertId, status) {
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

  els.activeAlert.className = "active-alert";
  const img = alert.frame_jpeg_b64
    ? `<img alt="Alert snapshot" src="data:image/jpeg;base64,${alert.frame_jpeg_b64}" />`
    : "";
  const reasons = (alert.reasons || [])
    .map((r) => `<li>${r}</li>`)
    .join("");

  els.activeAlert.innerHTML = `
    ${img}
    <div class="meta-row">
      <div>
        <strong>Track #${alert.track_id}</strong>
        <div class="tiny">${alert.zone || "Zone"} · ${fmtTime(alert.created_at)}</div>
      </div>
      <div class="score">${Math.round(alert.score * 100)}% score</div>
    </div>
    <ul class="reasons">${reasons}</ul>
    <div class="actions">
      <button class="primary" data-act="responding">Responding</button>
      <button class="secondary" data-act="acknowledged">Acknowledge</button>
      <button class="ghost" data-act="dismissed">False alarm</button>
    </div>
  `;

  els.activeAlert.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => setStatus(alert.id, btn.dataset.act));
  });
}

function renderList() {
  els.openCount.textContent = `${openAlerts().length} open`;
  els.alertList.innerHTML = "";
  state.alerts.slice(0, 30).forEach((alert) => {
    const card = document.createElement("div");
    card.className = "alert-card";
    card.innerHTML = `
      <div class="row">
        <strong>Track #${alert.track_id}</strong>
        <span class="badge ${alert.status}">${alert.status}</span>
      </div>
      <div class="tiny">${fmtTime(alert.created_at)} · score ${alert.score.toFixed(2)}</div>
    `;
    card.addEventListener("click", () => {
      state.selectedId = alert.id;
      renderActive();
      renderList();
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
}

function upsertAlert(alert) {
  const idx = state.alerts.findIndex((a) => a.id === alert.id);
  if (idx >= 0) state.alerts[idx] = alert;
  else state.alerts.unshift(alert);
  if (alert.status === "open") state.selectedId = alert.id;
  renderActive();
  renderList();
}

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
      renderActive();
      renderList();
      renderStatus();
    } else if (msg.type === "alert" || msg.type === "alert_update") {
      upsertAlert(msg.alert);
    } else if (msg.type === "tower_status") {
      state.status = msg.status;
      renderStatus();
    }
  };

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, 15000);
}

function refreshFeed() {
  const img = els.liveFeed;
  const bust = Date.now();
  img.src = `/api/stream/latest.jpg?t=${bust}`;
}

els.liveFeed.onerror = () => {
  // keep polling even before first frame arrives
};

connectWs();
setInterval(refreshFeed, 350);
refreshFeed();
renderActive();
renderList();