"""既存スキーマ(001_init.sql)へマッピングする ORM モデル。

注意: スキーマは変更しない。これらは既存テーブル/ビューを読み書きするための
マッピング定義であり、Base.metadata.create_all() は呼ばない。
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from app.core.db import Base

# ORM 経由で INSERT するテーブルの id はサーバ生成（既存スキーマの DEFAULT を利用）
_GEN_UUID = text("gen_random_uuid()")


class Channel(Base):
    __tablename__ = "channels"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
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

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
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

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    entity_type = Column(Text, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    metric_key = Column(Text, nullable=False)
    elapsed_seconds = Column(Integer, nullable=False)
    value = Column(Numeric, nullable=False)
    recorded_at = Column(DateTime(timezone=True))
    source = Column(Text, nullable=False)


class IngestionLog(Base):
    __tablename__ = "ingestion_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    source_type = Column(Text, nullable=False)
    file_name = Column(Text)
    records_processed = Column(Integer, nullable=False)
    records_failed = Column(Integer, nullable=False)
    status = Column(Text, nullable=False)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    error_log = Column(JSONB)


class AnalysisTemplate(Base):
    __tablename__ = "analysis_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    name = Column(Text, nullable=False)
    screen_type = Column(Text)
    prompt = Column(Text, nullable=False)
    reference_data_keys = Column(ARRAY(Text), nullable=False)
    comparison_target = Column(Text)
    tone = Column(Text)
    length = Column(Text)
    is_default = Column(Boolean, nullable=False)
    is_enabled = Column(Boolean, nullable=False)
    created_by = Column(UUID(as_uuid=True))
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    template_id = Column(UUID(as_uuid=True))
    entity_type = Column(Text)
    entity_id = Column(UUID(as_uuid=True))
    generated_text = Column(Text, nullable=False)
    input_data_snapshot = Column(JSONB)
    user_edits = Column(Text)
    generated_at = Column(DateTime(timezone=True), nullable=False)


class MonthlyChannelMetric(Base):
    """月次・チャンネル全体の数値（数値CSVの合計行を segment ごと1行）。

    003_monthly_channel_data.sql で新設。既存 metric_values とは独立。
    % は生の百分率(例 45.2)のまま格納する。
    """

    __tablename__ = "monthly_channel_metrics"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("channels.id"), nullable=False)
    year_month = Column(Text, nullable=False)  # 'YYYY-MM'
    segment = Column(Text, nullable=False)  # all / live / short
    avg_view_duration_seconds = Column(Integer)
    avg_view_percentage = Column(Numeric)
    unique_viewers = Column(Integer)
    new_viewers = Column(Integer)
    repeat_viewers = Column(Integer)
    view_count = Column(BigInteger)
    total_watch_time_hours = Column(Numeric)
    subscribers = Column(Integer)
    impressions = Column(BigInteger)
    impressions_ctr = Column(Numeric)
    source_file = Column(Text)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class MonthlyDemographic(Base):
    """月次・性別年齢分布（各行 = 年齢層 × 性別 × 視聴回数% × 総再生時間%）。

    003_monthly_channel_data.sql で新設。% は生の百分率のまま格納する。
    """

    __tablename__ = "monthly_demographics"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=_GEN_UUID)
    channel_id = Column(UUID(as_uuid=True), ForeignKey("channels.id"), nullable=False)
    year_month = Column(Text, nullable=False)  # 'YYYY-MM'
    segment = Column(Text, nullable=False)  # all / live / short
    age_band = Column(Text, nullable=False)  # '13-17' ... '65-'
    gender = Column(Text, nullable=False)  # male / female / other
    views_pct = Column(Numeric)
    watch_time_pct = Column(Numeric)
    source_file = Column(Text)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


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
