from __future__ import annotations

import asyncio
from collections import deque
from typing import Any

from ..models.schemas import Alert, AlertCreate, TowerStatus


class AlertStore:
    """In-memory alert + tower status store for the MVP."""

    def __init__(self, max_alerts: int = 200) -> None:
        self._alerts: deque[Alert] = deque(maxlen=max_alerts)
        self._by_id: dict[str, Alert] = {}
        self._tower: TowerStatus | None = None
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=64)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    async def _broadcast(self, event: dict[str, Any]) -> None:
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(queue)
        for queue in dead:
            self._subscribers.discard(queue)

    async def create_alert(self, payload: AlertCreate) -> Alert:
        async with self._lock:
            alert = Alert(**payload.model_dump())
            self._alerts.appendleft(alert)
            self._by_id[alert.id] = alert
        await self._broadcast({"type": "alert", "alert": alert.model_dump(mode="json")})
        return alert

    async def list_alerts(self, status: str | None = None) -> list[Alert]:
        async with self._lock:
            alerts = list(self._alerts)
        if status:
            alerts = [a for a in alerts if a.status == status]
        return alerts

    async def get_alert(self, alert_id: str) -> Alert | None:
        async with self._lock:
            return self._by_id.get(alert_id)

    async def update_status(self, alert_id: str, status: str) -> Alert | None:
        async with self._lock:
            alert = self._by_id.get(alert_id)
            if not alert:
                return None
            updated = alert.model_copy(update={"status": status})
            self._by_id[alert_id] = updated
            for idx, item in enumerate(self._alerts):
                if item.id == alert_id:
                    self._alerts[idx] = updated
                    break
        await self._broadcast(
            {"type": "alert_update", "alert": updated.model_dump(mode="json")}
        )
        return updated

    async def open_count(self) -> int:
        async with self._lock:
            return sum(1 for a in self._alerts if a.status == "open")

    async def set_tower_status(self, status: TowerStatus) -> None:
        async with self._lock:
            self._tower = status
        await self._broadcast(
            {"type": "tower_status", "status": status.model_dump(mode="json")}
        )

    async def get_tower_status(self) -> TowerStatus | None:
        async with self._lock:
            return self._tower


store = AlertStore()