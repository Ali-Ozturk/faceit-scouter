import importlib.metadata
import math
import os
import re
from time import perf_counter
import structlog
from datetime import UTC, datetime
from pathlib import Path

from scout_processor.analysis.match_summary import internal_match_fingerprint
from scout_processor.errors.exceptions import ErrorCode, ProcessingError
from scout_processor.ingestion.checksum import sha256_file
from scout_processor.parsing.event_extractors import first_present
from scout_processor.parsing.parser_models import ParsedDemo, ParsedGrenadeEvent, ParsedKillEvent, ParsedPlayer, ParsedPositionSample, ParsedRound, ParsedRoundPlayerLoadout, ParsedTeam

FACEIT_MATCH_ID_RE = re.compile(r"(?:\d-)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
OPENING_SAMPLE_WINDOW_SECONDS = 90
LOADOUT_SAMPLE_SECONDS = (5, 7, 10, 15)
POSITION_TICK_FIELDS = ["steamid", "name", "team_name", "X", "Y", "Z", "is_alive"]
LOADOUT_TICK_FIELDS = [
    "steamid",
    "name",
    "team_name",
    "active_weapon_name",
    "active_weapon",
    "weapon_name",
    "weapon",
    "inventory",
    "inventory_names",
    "weapons",
    "grenades",
    "has_flashbang",
    "has_smokegrenade",
    "has_hegrenade",
    "has_molotov",
    "has_incgrenade",
    "has_decoy",
]
LOADOUT_TICK_FIELD_SETS = [
    LOADOUT_TICK_FIELDS,
    ["steamid", "name", "team_name", "active_weapon_name", "inventory"],
    ["steamid", "name", "team_name", "active_weapon_name"],
    ["steamid", "name", "team_name", "active_weapon"],
    ["steamid", "name", "team_name", "weapon_name"],
    ["steamid", "name", "team_name", "weapon"],
    ["steamid", "name", "team_name", "inventory"],
    ["steamid", "name", "team_name", "inventory_names"],
    ["steamid", "name", "team_name", "weapons"],
    ["steamid", "name", "team_name", "grenades"],
]
PLAYED_AT_HEADER_KEYS = (
    "played_at",
    "playedAt",
    "started_at",
    "startedAt",
    "finished_at",
    "finishedAt",
    "created_at",
    "createdAt",
    "date",
    "match_date",
    "matchDate",
)


def extract_faceit_match_id(file_name: str) -> str | None:
    match = FACEIT_MATCH_ID_RE.search(file_name)
    return match.group(0).lower() if match else None


def parser_version() -> str:
    try:
        return importlib.metadata.version("demoparser2")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def dataframe_to_rows(dataframe) -> list[dict]:
    if hasattr(dataframe, "to_dicts"):
        return dataframe.to_dicts()
    if hasattr(dataframe, "to_dict"):
        return dataframe.to_dict(orient="records")
    raise TypeError(f"Unsupported dataframe type: {type(dataframe).__name__}")


def sanitize_json_value(value):
    if isinstance(value, str):
        return value.replace("\x00", "")
    if isinstance(value, dict):
        return {str(key): sanitize_json_value(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [sanitize_json_value(inner) for inner in value]
    return value


def has_value(value) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and math.isnan(value):
        return False
    return True


def clean_steam_id(value) -> str | None:
    if not has_value(value):
        return None
    return str(int(value)) if isinstance(value, float) else str(value)


def parse_datetime_value(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value <= 0:
            return None
        timestamp = value / 1000 if value > 10_000_000_000 else value
        try:
            parsed = datetime.fromtimestamp(timestamp, UTC)
        except (OverflowError, OSError, ValueError):
            return None
        return parsed if 2000 <= parsed.year <= 2100 else None
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def extract_played_at_from_header(header: dict) -> datetime | None:
    for key in PLAYED_AT_HEADER_KEYS:
        parsed = parse_datetime_value(header.get(key))
        if parsed:
            return parsed
    return None


class EventBatchParser:
    """Reuse one native event scan; preserve individual-query fallbacks."""

    def __init__(self, parser):
        self.parser = parser
        self.events = {}
        self.batched_names = set()
        names = ["begin_new_match", "round_announce_match_start", "round_end",
                 "round_freeze_end", "grenade_thrown", "flashbang_detonate",
                 "hegrenade_detonate", "smokegrenade_detonate", "molotov_detonate",
                 "inferno_startburn", "decoy_detonate"]
        if os.getenv("PARSE_FULL_SCOREBOARD", "false").lower() == "true":
            names.extend(["player_death", "player_hurt"])
        started = perf_counter()
        try:
            self.events = dict(parser.parse_events(names))
            self.batched_names = set(names)
        except Exception:
            # Older native versions/demos may not support batching all events.
            self.events = {}
        structlog.get_logger(__name__).info("parser_event_batch", duration_ms=round((perf_counter()-started)*1000), cached_events=len(self.events))

    def parse_event(self, name):
        if name in self.batched_names and name not in self.events:
            return EmptyEventRows()
        if name not in self.events:
            self.events[name] = self.parser.parse_event(name)
        return self.events[name]

    def __getattr__(self, name):
        return getattr(self.parser, name)


class EmptyEventRows:
    def to_dicts(self):
        return []


class DemoParser:
    def parse(self, demo_path: Path, checksum: str | None = None) -> ParsedDemo:
        try:
            from demoparser2 import DemoParser as Demoparser2  # type: ignore
        except Exception as exc:
            raise ProcessingError(ErrorCode.PARSER_FAILED, "demoparser2 is not installed") from exc

        checksum = checksum or sha256_file(demo_path)
        faceit_match_id = extract_faceit_match_id(demo_path.name)

        try:
            parser = EventBatchParser(Demoparser2(str(demo_path)))
            header = parser.parse_header()
            map_name = header.get("map_name") or header.get("map") or "unknown"
            played_at = extract_played_at_from_header(header)
            tick_rate = header.get("tick_rate")
            match_start_tick = self._match_start_tick(parser)
            players = self._parse_players(parser, match_start_tick)
            teams = self._build_teams(players)
            rounds = self._parse_rounds(parser, match_start_tick)
            kills = []
            if os.getenv("PARSE_FULL_SCOREBOARD", "false").lower() == "true":
                kills = self._apply_scoreboard_stats(parser, players, match_start_tick)
            position_samples = self._parse_position_samples(parser, players, rounds, int(tick_rate or 64))
            player_loadouts = self._parse_player_loadouts(parser, players, rounds, int(tick_rate or 64))
            grenades = self._parse_grenades(parser, rounds, match_start_tick)
            self._apply_team_scores(teams, rounds)
        except Exception as exc:
            raise ProcessingError(ErrorCode.PARSER_FAILED, str(exc)) from exc

        fingerprint = internal_match_fingerprint(
            [faceit_match_id, checksum, map_name, *sorted(player.steam_id for player in players)]
        )
        team_1_score = next((team.score for team in teams if team.team_number == 1), None)
        team_2_score = next((team.score for team in teams if team.team_number == 2), None)
        return ParsedDemo(
            faceit_match_id=faceit_match_id,
            internal_fingerprint=fingerprint,
            map_name=str(map_name),
            played_at=played_at,
            tick_rate=int(tick_rate) if tick_rate else None,
            raw_metadata=sanitize_json_value(dict(header)),
            teams=teams,
            team_1_score=team_1_score,
            team_2_score=team_2_score,
            rounds=rounds,
            kills=kills,
            grenades=grenades,
            position_samples=position_samples,
            player_loadouts=player_loadouts,
        )

    def _parse_players(self, parser, match_start_tick: int = 0) -> list[ParsedPlayer]:
        try:
            info_rows = dataframe_to_rows(parser.parse_player_info())
        except Exception as exc:
            raise ProcessingError(ErrorCode.PARSER_FAILED, f"Could not extract players: {exc}") from exc

        start_rows = []
        if match_start_tick:
            try:
                start_rows = dataframe_to_rows(
                    parser.parse_ticks(["steamid", "name", "team_num", "team_name"], ticks=[match_start_tick])
                )
            except Exception:
                start_rows = []

        rows_by_steam_id = {
            clean_steam_id(row.get("steamid") or row.get("steam_id") or row.get("xuid")): row
            for row in info_rows
        }
        for row in start_rows:
            steam_id = clean_steam_id(row.get("steamid") or row.get("steam_id") or row.get("xuid"))
            if not steam_id:
                continue
            rows_by_steam_id[steam_id] = {**rows_by_steam_id.get(steam_id, {}), **row}

        by_steam_id: dict[str, ParsedPlayer] = {}
        for row in rows_by_steam_id.values():
            steam_id = clean_steam_id(row.get("steamid") or row.get("steam_id") or row.get("xuid"))
            if not steam_id:
                continue
            nickname = row.get("name") or row.get("player_name") or str(steam_id)
            team_number = self._internal_team_number(row)
            by_steam_id[str(steam_id)] = ParsedPlayer(
                steam_id=str(steam_id),
                nickname=str(nickname),
                team_number=team_number or 1,
            )

        if not by_steam_id:
            raise ProcessingError(ErrorCode.PARSED_DATA_INVALID, "No players found in demo")
        return list(by_steam_id.values())

    def _internal_team_number(self, row: dict) -> int:
        team_name = str(row.get("team_name") or "").upper()
        if team_name in ("TERRORIST", "T"):
            return 1
        if team_name == "CT":
            return 2

        live_team_number = row.get("team_num")
        if has_value(live_team_number):
            team_number = int(live_team_number)
            if team_number in (2, 3):
                return 1 if team_number == 2 else 2

        info_team_number = row.get("team_number") or row.get("team")
        if has_value(info_team_number):
            team_number = int(info_team_number)
            if team_number in (2, 3):
                return 1 if team_number == 2 else 2
            return team_number

        return 1

    def _build_teams(self, players: list[ParsedPlayer]) -> list[ParsedTeam]:
        teams: list[ParsedTeam] = []
        for team_number in sorted({player.team_number for player in players}):
            teams.append(
                ParsedTeam(
                    team_number=team_number,
                    starting_side="T" if team_number == 1 else "CT" if team_number == 2 else None,
                    players=[player for player in players if player.team_number == team_number],
                )
            )
        return teams

    def _match_start_tick(self, parser) -> int:
        try:
            rows = dataframe_to_rows(parser.parse_event("begin_new_match"))
            ticks = [int(row["tick"]) for row in rows if has_value(row.get("tick"))]
            if ticks:
                return min(ticks)
        except Exception:
            pass

        try:
            rows = dataframe_to_rows(parser.parse_event("round_announce_match_start"))
            ticks = [int(row["tick"]) for row in rows if has_value(row.get("tick"))]
            if ticks:
                return max(ticks)
        except Exception:
            pass

        return 0

    def _parse_rounds(self, parser, match_start_tick: int) -> list[ParsedRound]:
        try:
            rows = dataframe_to_rows(parser.parse_event("round_end"))
        except Exception:
            return []

        try:
            freeze_end_ticks = [
                int(row["tick"])
                for row in dataframe_to_rows(parser.parse_event("round_freeze_end"))
                if has_value(row.get("tick")) and int(row["tick"]) >= match_start_tick
            ]
        except Exception:
            freeze_end_ticks = []

        rounds: list[ParsedRound] = []
        for row in rows:
            tick = int(row.get("tick") or 0)
            winner_side = row.get("winner")
            if tick < match_start_tick or not has_value(winner_side):
                continue
            round_number = len(rounds) + 1
            started_at = self._round_start_tick(freeze_end_ticks, tick, match_start_tick)
            winner_team_number = self._winner_team_number(str(winner_side), round_number)
            rounds.append(
                ParsedRound(
                    round_number=round_number,
                    half=1 if round_number <= 12 else 2,
                    winner_team_number=winner_team_number,
                    winner_side=str(winner_side),
                    reason=str(row["reason"]) if has_value(row.get("reason")) else None,
                    started_at_demo_time=float(started_at) if started_at else None,
                    ended_at_demo_time=float(tick),
                )
            )
        return rounds

    def _round_start_tick(self, freeze_end_ticks: list[int], end_tick: int, match_start_tick: int) -> int | None:
        starts = [tick for tick in freeze_end_ticks if tick < end_tick]
        return max(starts) if starts else match_start_tick

    def _winner_team_number(self, winner_side: str, round_number: int) -> int | None:
        side = winner_side.upper()
        first_half = round_number <= 12
        if side == "T":
            return 1 if first_half else 2
        if side == "CT":
            return 2 if first_half else 1
        return None

    def _apply_team_scores(self, teams: list[ParsedTeam], rounds: list[ParsedRound]) -> None:
        scores = {team.team_number: 0 for team in teams}
        for round_result in rounds:
            if round_result.winner_team_number in scores:
                scores[round_result.winner_team_number] += 1
        for team in teams:
            team.score = scores.get(team.team_number)

    def _apply_scoreboard_stats(
        self,
        parser,
        players: list[ParsedPlayer],
        match_start_tick: int,
    ) -> list[ParsedKillEvent]:
        by_steam_id = {player.steam_id: player for player in players}
        stats = {
            player.steam_id: {"kills": 0, "deaths": 0, "assists": 0, "headshots": 0, "damage": 0}
            for player in players
        }
        kill_events: list[ParsedKillEvent] = []

        try:
            death_rows = dataframe_to_rows(parser.parse_event("player_death"))
        except Exception:
            death_rows = []

        for row in death_rows:
            tick = int(row.get("tick") or 0)
            if tick < match_start_tick:
                continue
            attacker = clean_steam_id(row.get("attacker_steamid"))
            victim = clean_steam_id(row.get("user_steamid"))
            assister = clean_steam_id(row.get("assister_steamid"))
            if victim in stats:
                stats[victim]["deaths"] += 1
            if attacker in stats and attacker != victim:
                stats[attacker]["kills"] += 1
                if bool(row.get("headshot")):
                    stats[attacker]["headshots"] += 1
            if assister in stats and assister not in (attacker, victim):
                stats[assister]["assists"] += 1
            kill_events.append(
                ParsedKillEvent(
                    sequence_number=len(kill_events) + 1,
                    demo_time=float(tick),
                    attacker_steam_id=attacker,
                    victim_steam_id=victim,
                    assister_steam_id=assister,
                    weapon=str(row["weapon"]) if has_value(row.get("weapon")) else None,
                    headshot=bool(row.get("headshot")) if has_value(row.get("headshot")) else None,
                )
            )

        try:
            hurt_rows = dataframe_to_rows(parser.parse_event("player_hurt"))
        except Exception:
            hurt_rows = []

        for row in hurt_rows:
            tick = int(row.get("tick") or 0)
            if tick < match_start_tick:
                continue
            attacker = clean_steam_id(row.get("attacker_steamid"))
            victim = clean_steam_id(row.get("user_steamid"))
            if attacker in stats and attacker != victim:
                stats[attacker]["damage"] += int(row.get("dmg_health") or 0)

        for steam_id, player_stats in stats.items():
            player = by_steam_id[steam_id]
            player.kills = player_stats["kills"]
            player.deaths = player_stats["deaths"]
            player.assists = player_stats["assists"]
            player.headshots = player_stats["headshots"]
            player.damage = player_stats["damage"]

        return kill_events

    def _parse_position_samples(
        self,
        parser,
        players: list[ParsedPlayer],
        rounds: list[ParsedRound],
        tick_rate: int = 64,
    ) -> list[ParsedPositionSample]:
        steam_ids = {player.steam_id for player in players}
        selected_rounds = rounds if opening_rounds_enabled() else self._default_preview_rounds_by_side(rounds)
        tick_to_round: dict[int, ParsedRound] = {}
        for round_result in selected_rounds:
            if round_result.started_at_demo_time is None or round_result.ended_at_demo_time is None:
                continue
            start = int(round_result.started_at_demo_time)
            end = min(int(round_result.ended_at_demo_time), start + int(OPENING_SAMPLE_WINDOW_SECONDS * tick_rate))
            if end <= start:
                continue
            step = max(1, round(tick_rate / 4))
            ticks = sorted(set([start, *range(start + step, end, step), end]))
            for tick in ticks:
                tick_to_round[tick] = round_result

        if not tick_to_round:
            return []

        try:
            rows = dataframe_to_rows(
                parser.parse_ticks(
                    POSITION_TICK_FIELDS,
                    ticks=sorted(tick_to_round),
                )
            )
        except Exception:
            return []

        samples: list[ParsedPositionSample] = []
        for row in rows:
            steam_id = clean_steam_id(row.get("steamid"))
            tick = int(row.get("tick") or 0)
            round_result = tick_to_round.get(tick)
            if not steam_id or steam_id not in steam_ids or not round_result:
                continue
            if not has_value(row.get("X")) or not has_value(row.get("Y")):
                continue
            start_tick = int(round_result.started_at_demo_time or tick)
            samples.append(
                ParsedPositionSample(
                    round_number=round_result.round_number,
                    side="T" if str(row.get("team_name")).upper() in ("T", "TERRORIST") else "CT",
                    tick=tick,
                    seconds=round((tick - start_tick) / tick_rate, 2),
                    steam_id=steam_id,
                    player_name=str(row.get("name") or steam_id),
                    x=float(row["X"]),
                    y=float(row["Y"]),
                    z=float(row["Z"]) if has_value(row.get("Z")) else None,
                    alive=bool(row.get("is_alive")) if has_value(row.get("is_alive")) else None,
                )
            )
        return samples

    def _parse_player_loadouts(
        self,
        parser,
        players: list[ParsedPlayer],
        rounds: list[ParsedRound],
        tick_rate: int = 64,
    ) -> list[ParsedRoundPlayerLoadout]:
        steam_ids = {player.steam_id for player in players}
        tick_to_round: dict[int, ParsedRound] = {}
        for round_result in rounds:
            if round_result.started_at_demo_time is None or round_result.ended_at_demo_time is None:
                continue
            start = int(round_result.started_at_demo_time)
            end = int(round_result.ended_at_demo_time)
            for seconds in LOADOUT_SAMPLE_SECONDS:
                target = min(end, start + int(seconds * tick_rate))
                if target >= start:
                    tick_to_round[target] = round_result

        if not tick_to_round:
            return []

        rows = parse_loadout_tick_rows(parser, sorted(tick_to_round))
        if not rows:
            return []

        loadouts_by_player_round: dict[tuple[int, str], dict] = {}
        for row in rows:
            steam_id = clean_steam_id(row.get("steamid"))
            tick = int(row.get("tick") or 0)
            round_result = tick_to_round.get(tick)
            if not steam_id or steam_id not in steam_ids or not round_result:
                continue
            key = (round_result.round_number, steam_id)
            start_tick = int(round_result.started_at_demo_time or tick)
            current = loadouts_by_player_round.get(key) or {
                "round_number": round_result.round_number,
                "side": "T" if str(row.get("team_name")).upper() in ("T", "TERRORIST") else "CT",
                "tick": tick,
                "seconds": round((tick - start_tick) / tick_rate, 2),
                "steam_id": steam_id,
                "player_name": str(row.get("name") or steam_id),
                "weapon": None,
                "utility": None,
                "inventory": None,
            }

            inventory_weapon = parse_inventory_weapon(row)
            active_weapon = parse_active_weapon(row)
            current["weapon"] = better_weapon(current["weapon"], inventory_weapon) or better_weapon(current["weapon"], active_weapon)
            current["utility"] = merge_utility_values(current["utility"], parse_utility_inventory(row))
            current["inventory"] = merge_inventory_values(current["inventory"], parse_full_inventory(row))
            loadouts_by_player_round[key] = current

        return [
            ParsedRoundPlayerLoadout(**loadout)
            for loadout in sorted(loadouts_by_player_round.values(), key=lambda item: (item["round_number"], item["player_name"]))
        ]

    def _first_rounds_by_side(self, rounds: list[ParsedRound]) -> list[ParsedRound]:
        first_t = next((round_result for round_result in rounds if round_result.round_number <= 12), None)
        first_ct = next((round_result for round_result in rounds if round_result.round_number > 12), None)
        return [round_result for round_result in (first_t, first_ct) if round_result]

    def _default_preview_rounds_by_side(self, rounds: list[ParsedRound]) -> list[ParsedRound]:
        selected: list[ParsedRound] = []
        by_round_number = {round_result.round_number: round_result for round_result in rounds}
        for first_round in self._first_rounds_by_side(rounds):
            selected.append(first_round)
            second_round = by_round_number.get(first_round.round_number + 1)
            if second_round:
                selected.append(second_round)
        return selected

    def _parse_grenades(
        self,
        parser,
        rounds: list[ParsedRound],
        match_start_tick: int,
    ) -> list[ParsedGrenadeEvent]:
        event_names = {
            "flashbang_detonate": "flashbang",
            "hegrenade_detonate": "hegrenade",
            "smokegrenade_detonate": "smokegrenade",
            "molotov_detonate": "molotov",
            "inferno_startburn": "molotov",
            "decoy_detonate": "decoy",
        }
        thrown_events = self._parse_grenade_throws(parser, rounds, match_start_tick)
        events: list[ParsedGrenadeEvent] = []
        for event_name, grenade_type in event_names.items():
            try:
                rows = dataframe_to_rows(parser.parse_event(event_name))
            except Exception:
                continue
            for row in rows:
                tick = int(first_present(row, ["tick", "Tick"]) or 0)
                if tick < match_start_tick:
                    continue
                end_x = float_value(first_present(row, ["x", "X", "pos_x", "position_x", "grenade_x"]))
                end_y = float_value(first_present(row, ["y", "Y", "pos_y", "position_y", "grenade_y"]))
                end_z = float_value(first_present(row, ["z", "Z", "pos_z", "position_z", "grenade_z"]))
                start_x = float_value(first_present(row, ["thrower_x", "start_x", "player_x"]))
                start_y = float_value(first_present(row, ["thrower_y", "start_y", "player_y"]))
                start_z = float_value(first_present(row, ["thrower_z", "start_z", "player_z"]))
                thrower_steam_id = clean_steam_id(first_present(row, [
                    "user_steamid",
                    "thrower_steamid",
                    "attacker_steamid",
                    "player_steamid",
                    "steamid",
                ]))
                round_number = self._round_number_for_tick(rounds, tick)
                thrown = self._matching_grenade_throw(thrown_events, thrower_steam_id, grenade_type, tick, round_number)
                events.append(
                    ParsedGrenadeEvent(
                        sequence_number=len(events) + 1,
                        round_number=round_number,
                        thrower_steam_id=thrower_steam_id,
                        grenade_type=grenade_type,
                        thrown_demo_time=float(thrown["tick"]) if thrown else None,
                        demo_time=float(tick),
                        start_x=float_value(thrown.get("x")) if thrown else start_x,
                        start_y=float_value(thrown.get("y")) if thrown else start_y,
                        start_z=float_value(thrown.get("z")) if thrown else start_z,
                        end_x=end_x,
                        end_y=end_y,
                        end_z=end_z,
                    )
                )
        events.sort(key=lambda event: event.demo_time or 0)
        for index, event in enumerate(events, start=1):
            event.sequence_number = index
        return events

    def _parse_grenade_throws(self, parser, rounds: list[ParsedRound], match_start_tick: int) -> list[dict]:
        try:
            rows = dataframe_to_rows(parser.parse_event("grenade_thrown"))
        except Exception:
            return []

        throws = []
        for row in rows:
            tick = int(first_present(row, ["tick", "Tick"]) or 0)
            if tick < match_start_tick:
                continue
            grenade_type = str(first_present(row, ["weapon", "grenade_type", "grenade", "entity"]) or "").lower()
            throws.append({
                "tick": tick,
                "round_number": self._round_number_for_tick(rounds, tick),
                "thrower_steam_id": clean_steam_id(first_present(row, [
                    "user_steamid",
                    "thrower_steamid",
                    "player_steamid",
                    "steamid",
                ])),
                "grenade_type": normalize_grenade_type(grenade_type),
                "x": first_present(row, ["x", "X", "thrower_x", "player_x", "start_x"]),
                "y": first_present(row, ["y", "Y", "thrower_y", "player_y", "start_y"]),
                "z": first_present(row, ["z", "Z", "thrower_z", "player_z", "start_z"]),
            })
        return throws

    def _matching_grenade_throw(self, throws: list[dict], thrower_steam_id: str | None, grenade_type: str, detonate_tick: int, round_number: int | None) -> dict | None:
        matching = [
            row for row in throws
            if row["tick"] <= detonate_tick
            and (round_number is None or row.get("round_number") == round_number)
            and (not thrower_steam_id or row.get("thrower_steam_id") == thrower_steam_id)
            and (not row.get("grenade_type") or row.get("grenade_type") == normalize_grenade_type(grenade_type))
        ]
        return max(matching, key=lambda row: row["tick"], default=None)

    def _round_number_for_tick(self, rounds: list[ParsedRound], tick: int) -> int | None:
        for round_result in rounds:
            start = round_result.started_at_demo_time
            end = round_result.ended_at_demo_time
            if start is not None and end is not None and int(start) <= tick <= int(end):
                return round_result.round_number
        return None


def float_value(value) -> float | None:
    if not has_value(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def opening_rounds_enabled() -> bool:
    return os.getenv("OPENING_TENDENCY_PREVIEWS_ENABLED", "false").lower() == "true"


def normalize_grenade_type(value: str) -> str:
    lower = value.lower().replace("weapon_", "")
    if "flash" in lower:
        return "flashbang"
    if "smoke" in lower:
        return "smokegrenade"
    if "molotov" in lower or "inc" in lower or "inferno" in lower:
        return "molotov"
    if "he" in lower or "frag" in lower:
        return "hegrenade"
    if "decoy" in lower:
        return "decoy"
    return lower


def parse_loadout_tick_rows(parser, ticks: list[int]) -> list[dict]:
    for fields in LOADOUT_TICK_FIELD_SETS:
        try:
            return dataframe_to_rows(parser.parse_ticks(fields, ticks=ticks))
        except Exception:
            continue
    return []


def parse_active_weapon(row: dict) -> str | None:
    for key in ["active_weapon_name", "weapon_name", "weapon", "active_weapon"]:
        value = row.get(key)
        if not has_value(value):
            continue
        normalized = normalize_weapon_name(str(value))
        if normalized:
            return normalized
    return None


def parse_inventory_weapon(row: dict) -> str | None:
    weapons: list[str] = []
    for key in ["inventory", "inventory_names", "weapons"]:
        weapons.extend(weapon_names_from_value(row.get(key)))
    return best_weapon(weapons)


def parse_full_inventory(row: dict) -> str | None:
    items: list[str] = []
    for key in ["inventory", "inventory_names", "weapons", "grenades"]:
        items.extend(inventory_items_from_value(row.get(key)))

    active_item = parse_active_inventory_item(row)
    if active_item:
        items.append(active_item)

    utility_keys = {
        "has_flashbang": "flashbang",
        "has_smokegrenade": "smokegrenade",
        "has_hegrenade": "hegrenade",
        "has_molotov": "molotov",
        "has_incgrenade": "incgrenade",
        "has_decoy": "decoy",
    }
    for key, item_name in utility_keys.items():
        if is_truthy_inventory_value(row.get(key)):
            items.append(item_name)

    unique = sorted({item for item in items if item}, key=inventory_item_sort_key, reverse=True)
    return ", ".join(unique) if unique else None


def parse_active_inventory_item(row: dict) -> str | None:
    for key in ["active_weapon_name", "weapon_name", "weapon", "active_weapon"]:
        value = row.get(key)
        if not has_value(value):
            continue
        normalized = normalize_inventory_item_name(str(value))
        if normalized:
            return normalized
    return None


def normalize_weapon_name(value: str) -> str | None:
    cleaned = value.strip().lower().replace("weapon_", "").replace("-", "_")
    if (
        not cleaned
        or cleaned in {"none", "unknown", "nan"}
        or cleaned.isdigit()
        or is_knife_name(cleaned)
        or is_utility_name(cleaned)
        or is_objective_item_name(cleaned)
    ):
        return None
    return cleaned


def normalize_inventory_item_name(value: str) -> str | None:
    cleaned = value.strip().lower().replace("weapon_", "").replace("-", "_")
    if not cleaned or cleaned in {"none", "unknown", "nan"} or cleaned.isdigit():
        return None
    cleaned = re.sub(r"\s+", "_", cleaned)
    if cleaned == "incgrenade":
        return "molotov"
    return normalize_grenade_type(cleaned) if is_utility_name(cleaned) else cleaned


def inventory_items_from_value(value) -> list[str]:
    if not has_value(value):
        return []
    if isinstance(value, dict):
        names: list[str] = []
        for key, inner in value.items():
            normalized_key = normalize_inventory_item_name(str(key))
            if is_truthy_inventory_value(inner) and normalized_key:
                names.append(normalized_key)
            names.extend(inventory_items_from_value(inner))
        return names
    if isinstance(value, (list, tuple, set)):
        names = []
        for item in value:
            names.extend(inventory_items_from_value(item))
        return names

    text = str(value).strip()
    if not text:
        return []
    parts = re.split(r"[,;|]+", text)
    if len(parts) == 1 and "weapon_" in text:
        parts = re.split(r"\s+", text)
    return [
        normalized
        for part in parts
        if (normalized := normalize_inventory_item_name(part))
    ]


def weapon_names_from_value(value) -> list[str]:
    if not has_value(value):
        return []
    if isinstance(value, dict):
        names: list[str] = []
        for key, inner in value.items():
            normalized_key = normalize_weapon_name(str(key))
            if is_truthy_inventory_value(inner) and normalized_key:
                names.append(normalized_key)
            names.extend(weapon_names_from_value(inner))
        return names
    if isinstance(value, (list, tuple, set)):
        names = []
        for item in value:
            names.extend(weapon_names_from_value(item))
        return names

    text = str(value)
    return [
        normalized
        for part in re.split(r"[,;|\s]+", text)
        if (normalized := normalize_weapon_name(part))
    ]


def better_weapon(current: str | None, candidate: str | None) -> str | None:
    if not candidate:
        return current
    if not current or weapon_priority(candidate) > weapon_priority(current):
        return candidate
    return current


def best_weapon(weapons: list[str]) -> str | None:
    return max(weapons, key=weapon_priority, default=None)


def weapon_priority(weapon: str) -> int:
    normalized = weapon.lower()
    if normalized in {"awp", "scar20", "g3sg1"}:
        return 50
    if normalized in {"ak47", "m4a1", "m4a1_silencer", "sg556", "aug", "galilar", "famas"}:
        return 40
    if normalized in {"p90", "mp9", "mac10", "mp7", "mp5sd", "ump45", "bizon"}:
        return 30
    if normalized in {"xm1014", "mag7", "nova", "sawedoff", "m249", "negev"}:
        return 25
    if normalized in {"deagle", "revolver", "elite", "fiveseven", "tec9", "p250", "usp_silencer", "hkp2000", "glock"}:
        return 20
    return 10


def inventory_item_sort_key(item: str) -> tuple[int, str]:
    if is_knife_name(item):
        return (90, item)
    if is_utility_name(item):
        return (80, item)
    if is_objective_item_name(item):
        return (70, item)
    return (100 + weapon_priority(item), item)


def merge_inventory_values(left: str | None, right: str | None) -> str | None:
    values = []
    for value in [left, right]:
        if value:
            values.extend(part.strip() for part in value.split(",") if part.strip())
    unique = sorted({value for value in values if value}, key=inventory_item_sort_key, reverse=True)
    return ", ".join(unique) if unique else None


def is_knife_name(value: str) -> bool:
    normalized = value.replace("_", " ")
    knife_families = {
        "bayonet",
        "bowie",
        "butterfly",
        "classic",
        "falchion",
        "flip",
        "gut",
        "huntsman",
        "karambit",
        "kukri",
        "m9 bayonet",
        "navaja",
        "nomad",
        "paracord",
        "shadow daggers",
        "skeleton",
        "stiletto",
        "survival",
        "talon",
        "ursus",
    }
    return "knife" in normalized or normalized in knife_families


def is_objective_item_name(value: str) -> bool:
    normalized = value.replace("_", " ")
    return normalized in {"c4", "c4 explosive", "bomb"}


def parse_utility_inventory(row: dict) -> str | None:
    utilities: list[str] = []
    for key in ["inventory", "inventory_names", "weapons", "grenades"]:
        utilities.extend(utility_names_from_value(row.get(key)))

    utility_keys = {
        "has_flashbang": "flashbang",
        "has_smokegrenade": "smokegrenade",
        "has_hegrenade": "hegrenade",
        "has_molotov": "molotov",
        "has_incgrenade": "incgrenade",
        "has_decoy": "decoy",
    }
    for key, grenade_type in utility_keys.items():
        value = row.get(key)
        if is_truthy_inventory_value(value):
            utilities.append(grenade_type)

    unique = sorted({normalize_grenade_type(name) for name in utilities if name})
    return ", ".join(unique) if unique else None


def merge_utility_values(left: str | None, right: str | None) -> str | None:
    values = []
    for value in [left, right]:
        if value:
            values.extend(part.strip() for part in value.split(",") if part.strip())
    unique = sorted({normalize_grenade_type(value) for value in values})
    return ", ".join(unique) if unique else None


def utility_names_from_value(value) -> list[str]:
    if not has_value(value):
        return []
    if isinstance(value, dict):
        names: list[str] = []
        for key, inner in value.items():
            if is_truthy_inventory_value(inner) and is_utility_name(str(key)):
                names.append(str(key))
            names.extend(utility_names_from_value(inner))
        return names
    if isinstance(value, (list, tuple, set)):
        names = []
        for item in value:
            names.extend(utility_names_from_value(item))
        return names

    text = str(value)
    return [part for part in re.split(r"[,;|\s]+", text) if is_utility_name(part)]


def is_truthy_inventory_value(value) -> bool:
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    if not has_value(value):
        return False
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value > 0
    if isinstance(value, str):
        return value.strip().lower() not in {"", "0", "false", "none", "nan"}
    return bool(value)


def is_utility_name(value: str) -> bool:
    normalized = normalize_grenade_type(value)
    return normalized in {"flashbang", "smokegrenade", "hegrenade", "molotov", "decoy"}
