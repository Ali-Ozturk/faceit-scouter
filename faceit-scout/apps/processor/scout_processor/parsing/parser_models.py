from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ParsedPlayer(BaseModel):
    steam_id: str
    nickname: str
    team_number: int
    kills: int | None = None
    deaths: int | None = None
    assists: int | None = None
    headshots: int | None = None
    damage: int | None = None


class ParsedTeam(BaseModel):
    team_number: int
    starting_side: str | None = None
    score: int | None = None
    players: list[ParsedPlayer] = Field(default_factory=list)


class ParsedRound(BaseModel):
    round_number: int
    half: int | None = None
    winner_team_number: int | None = None
    winner_side: str | None = None
    reason: str | None = None
    bombsite: str | None = None
    bomb_planted: bool | None = None
    duration_seconds: float | None = None
    started_at_demo_time: float | None = None
    ended_at_demo_time: float | None = None


class ParsedKillEvent(BaseModel):
    sequence_number: int
    round_number: int | None = None
    demo_time: float | None = None
    attacker_steam_id: str | None = None
    victim_steam_id: str | None = None
    assister_steam_id: str | None = None
    weapon: str | None = None
    headshot: bool | None = None
    opening_kill: bool | None = None


class ParsedBombEvent(BaseModel):
    sequence_number: int
    round_number: int | None = None
    event_type: str
    player_steam_id: str | None = None
    site: str | None = None
    demo_time: float | None = None


class ParsedGrenadeEvent(BaseModel):
    sequence_number: int
    round_number: int | None = None
    thrower_steam_id: str | None = None
    grenade_type: str
    demo_time: float | None = None


class ParsedPositionSample(BaseModel):
    round_number: int
    side: str
    tick: int
    seconds: float
    steam_id: str
    player_name: str
    x: float
    y: float
    z: float | None = None
    alive: bool | None = None


class ParsedDemo(BaseModel):
    faceit_match_id: str | None = None
    internal_fingerprint: str
    map_name: str
    played_at: datetime | None = None
    duration_seconds: int | None = None
    team_1_score: int | None = None
    team_2_score: int | None = None
    overtime_rounds: int | None = None
    tick_rate: int | None = None
    raw_metadata: dict[str, Any] = Field(default_factory=dict)
    teams: list[ParsedTeam]
    rounds: list[ParsedRound] = Field(default_factory=list)
    kills: list[ParsedKillEvent] = Field(default_factory=list)
    bombs: list[ParsedBombEvent] = Field(default_factory=list)
    grenades: list[ParsedGrenadeEvent] = Field(default_factory=list)
    position_samples: list[ParsedPositionSample] = Field(default_factory=list)
