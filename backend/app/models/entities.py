"""既存スキーマ(001_init.sql)へマッピングする ORM モデル。

注意: スキーマは変更しない。これらは既存テーブル/ビューを読み書きするための
マッピング定義であり、Base.metadata.create_all() は呼ばない。
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID

from app.core.db import Base


class Channel(Base):
    __tablename__ = "channels"

    id = Column(UUID(as_uuid=True), primary_key=True)
    youtube_channel_id = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    handle = Column(Text)
    is_own = Column(Boolean, nullable=False)
    is_default_competitor = Column(Boolean, nullable=False)
    is_enabled = Column(Boolean, nullable=False)
    keyword_filter = Column(ARRAY(Text), nullable=False)
    monitoring_interval_minutes = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class Event(Base):
    __tablename__ = "events"

    id = Column(UUID(as_uuid=True), primary_key=True)
    name = Column(Text, nullable=False)
    venue = Column(Text)
    grade = Column(Text)
    start_date = Column(Date)
    end_date = Column(Date)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class Video(Base):
    __tablename__ = "videos"

    id = Column(UUID(as_uuid=True), primary_key=True)
    youtube_video_id = Column(Text)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("channels.id"), nullable=False)
    event_id = Column(UUID(as_uuid=True), ForeignKey("events.id"))
    title = Column(Text, nullable=False)
    published_at = Column(DateTime(timezone=True))
    duration_seconds = Column(Integer)
    venue = Column(Text)
    grade = Column(Text)
    title_tag = Column(Text)
    program_type = Column(Text)
    cast_members = Column(ARRAY(Text), nullable=False)
    thumbnail_url = Column(Text)
    is_competitor = Column(Boolean, nullable=False)
    content_type = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class MetricDefinition(Base):
    __tablename__ = "metric_definitions"

    id = Column(UUID(as_uuid=True), primary_key=True)
    key = Column(Text, nullable=False)
    label = Column(Text, nullable=False)
    unit = Column(Text)
    entity_type = Column(Text, nullable=False)
    category = Column(Text)
    aggregation_period = Column(Text)
    display_order = Column(Integer, nullable=False)
    formula = Column(Text)
    is_computed = Column(Boolean, nullable=False)
    is_enabled = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class MetricValue(Base):
    __tablename__ = "metric_values"

    id = Column(UUID(as_uuid=True), primary_key=True)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    metric_key = Column(Text, nullable=False)
    value = Column(Numeric, nullable=False)
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    source = Column(Text, nullable=False)
    source_file = Column(Text)
    created_at = Column(DateTime(timezone=True), nullable=False)


class MetricTimeseries(Base):
    __tablename__ = "metric_timeseries"

    id = Column(UUID(as_uuid=True), primary_key=True)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    metric_key = Column(Text, nullable=False)
    elapsed_seconds = Column(Integer, nullable=False)
    value = Column(Numeric, nullable=False)
    recorded_at = Column(DateTime(timezone=True))
    source = Column(Text, nullable=False)


class LatestMetricValue(Base):
    """ビュー latest_metric_values への読み取り専用マッピング。

    ビューに物理PKは無いが、ORM 用に (entity_type, entity_id, metric_key) を
    複合主キーとして扱う（DISTINCT ON により一意）。
    """

    __tablename__ = "latest_metric_values"

    entity_type = Column(Text, primary_key=True)
    entity_id = Column(UUID(as_uuid=True), primary_key=True)
    metric_key = Column(Text, primary_key=True)
    value = Column(Numeric)
    recorded_at = Column(DateTime(timezone=True))
    source = Column(Text)
    source_file = Column(Text)
