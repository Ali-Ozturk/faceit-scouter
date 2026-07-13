from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Double, Enum, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.sql import func


class Base(DeclarativeBase):
    pass


class ImportStatus(str, enum.Enum):
    DISCOVERED = "DISCOVERED"
    WAITING_FOR_STABILITY = "WAITING_FOR_STABILITY"
    CLAIMED = "CLAIMED"
    DECOMPRESSING = "DECOMPRESSING"
    PARSING = "PARSING"
    PERSISTING = "PERSISTING"
    COMPLETED = "COMPLETED"
    DUPLICATE = "DUPLICATE"
    FAILED = "FAILED"


class ImportedDemo(Base):
    __tablename__ = "imported_demo"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_name: Mapped[str] = mapped_column(Text)
    original_path: Mapped[str] = mapped_column(Text)
    current_path: Mapped[str | None] = mapped_column(Text)
    source_extension: Mapped[str] = mapped_column(Text)
    file_size: Mapped[int] = mapped_column(Integer)
    sha256_checksum: Mapped[str | None] = mapped_column(Text)
    faceit_match_id: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ImportStatus] = mapped_column(Enum(ImportStatus, name="import_status"))
    error_code: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    parser_name: Mapped[str | None] = mapped_column(Text)
    parser_version: Mapped[str | None] = mapped_column(Text)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processing_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    parsed_match_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    duplicate_of_import_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class CsMatch(Base):
    __tablename__ = "cs_match"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    faceit_match_id: Mapped[str | None] = mapped_column(Text)
    internal_fingerprint: Mapped[str] = mapped_column(Text, unique=True)
    map_name: Mapped[str] = mapped_column(Text)
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    team_1_score: Mapped[int | None] = mapped_column(Integer)
    team_2_score: Mapped[int | None] = mapped_column(Integer)
    overtime_rounds: Mapped[int | None] = mapped_column(Integer)
    tick_rate: Mapped[int | None] = mapped_column(Integer)
    raw_metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Player(Base):
    __tablename__ = "player"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    steam_id: Mapped[str] = mapped_column(Text, unique=True)
    faceit_player_id: Mapped[str | None] = mapped_column(Text)
    latest_nickname: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MatchTeam(Base):
    __tablename__ = "match_team"
    __table_args__ = (UniqueConstraint("match_id", "team_number", name="match_team_match_number_unique"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    team_number: Mapped[int] = mapped_column(Integer)
    starting_side: Mapped[str | None] = mapped_column(Text)
    score: Mapped[int | None] = mapped_column(Integer)
    exact_lineup_fingerprint: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(Text)


class MatchPlayer(Base):
    __tablename__ = "match_player"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    match_team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id", ondelete="CASCADE"))
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id", ondelete="CASCADE"))
    nickname_in_match: Mapped[str] = mapped_column(Text)
    kills: Mapped[int | None] = mapped_column(Integer)
    deaths: Mapped[int | None] = mapped_column(Integer)
    assists: Mapped[int | None] = mapped_column(Integer)
    headshots: Mapped[int | None] = mapped_column(Integer)
    damage: Mapped[int | None] = mapped_column(Integer)
    kast: Mapped[float | None] = mapped_column(Double)
    rating: Mapped[float | None] = mapped_column(Double)


class Round(Base):
    __tablename__ = "round"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    round_number: Mapped[int] = mapped_column(Integer)
    half: Mapped[int | None] = mapped_column(Integer)
    winner_match_team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id"))
    winner_side: Mapped[str | None] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    bombsite: Mapped[str | None] = mapped_column(Text)
    bomb_planted: Mapped[bool | None] = mapped_column(Boolean)
    duration_seconds: Mapped[float | None] = mapped_column(Double)
    started_at_demo_time: Mapped[float | None] = mapped_column(Double)
    ended_at_demo_time: Mapped[float | None] = mapped_column(Double)


class KillEvent(Base):
    __tablename__ = "kill_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    round_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("round.id", ondelete="CASCADE"))
    sequence_number: Mapped[int] = mapped_column(Integer)
    demo_time: Mapped[float | None] = mapped_column(Double)
    attacker_player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id"))
    victim_player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id"))
    assister_player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id"))
    attacker_team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id"))
    victim_team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id"))
    weapon: Mapped[str | None] = mapped_column(Text)
    headshot: Mapped[bool | None] = mapped_column(Boolean)
    opening_kill: Mapped[bool | None] = mapped_column(Boolean)


class BombEvent(Base):
    __tablename__ = "bomb_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    round_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("round.id", ondelete="CASCADE"))
    sequence_number: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(Text)
    player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id"))
    site: Mapped[str | None] = mapped_column(Text)
    demo_time: Mapped[float | None] = mapped_column(Double)


class GrenadeEvent(Base):
    __tablename__ = "grenade_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    round_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("round.id", ondelete="CASCADE"))
    sequence_number: Mapped[int] = mapped_column(Integer)
    thrower_player_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id"))
    thrower_team_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id"))
    grenade_type: Mapped[str] = mapped_column(Text)
    demo_time: Mapped[float | None] = mapped_column(Double)


class RoundPositionSample(Base):
    __tablename__ = "round_position_sample"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("cs_match.id", ondelete="CASCADE"))
    match_team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id", ondelete="CASCADE"))
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id", ondelete="CASCADE"))
    round_number: Mapped[int] = mapped_column(Integer)
    side: Mapped[str] = mapped_column(Text)
    tick: Mapped[int] = mapped_column(Integer)
    seconds: Mapped[float] = mapped_column(Double)
    player_name: Mapped[str] = mapped_column(Text)
    x: Mapped[float] = mapped_column(Double)
    y: Mapped[float] = mapped_column(Double)
    z: Mapped[float | None] = mapped_column(Double)
    alive: Mapped[bool | None] = mapped_column(Boolean)


class TeamLineup(Base):
    __tablename__ = "team_lineup"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fingerprint: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str] = mapped_column(Text)
    player_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TeamLineupMember(Base):
    __tablename__ = "team_lineup_member"

    team_lineup_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("team_lineup.id", ondelete="CASCADE"), primary_key=True)
    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("player.id", ondelete="CASCADE"), primary_key=True)


class MatchTeamLineup(Base):
    __tablename__ = "match_team_lineup"

    match_team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("match_team.id", ondelete="CASCADE"), primary_key=True)
    team_lineup_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("team_lineup.id", ondelete="CASCADE"), primary_key=True)
