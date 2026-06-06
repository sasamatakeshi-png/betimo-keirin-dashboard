"""指標スキーマ。"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class MetricDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str
    label: str
    unit: str | None
    entity_type: str
    category: str | None
    aggregation_period: str | None
    display_order: int
    formula: str | None
    is_computed: bool
    is_enabled: bool


class MetricValueOut(BaseModel):
    """latest_metric_values ビュー由来の最新値。値は素のまま（秒・0〜1小数）。"""

    model_config = ConfigDict(from_attributes=True)

    entity_type: str
    entity_id: UUID
    metric_key: str
    value: float
    recorded_at: datetime | None
    source: str | None
    source_file: str | None


class TimeseriesPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    entity_id: UUID
    metric_key: str
    elapsed_seconds: int
    value: float
    recorded_at: datetime | None
    source: str
