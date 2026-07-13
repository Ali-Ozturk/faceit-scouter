import importlib.metadata
import math
import re
from pathlib import Path

from scout_processor.analysis.match_summary import internal_match_fingerprint
from scout_processor.errors.exceptions import ErrorCode, ProcessingError
from scout_processor.ingestion.checksum import sha256_file
from scout_processor.parsing.parser_models import ParsedDemo, ParsedKillEvent, ParsedPlayer, ParsedRound, ParsedTeam

FACEIT_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


def extract_faceit_match_id(file_name: str) -> str | None:
    match = FACEIT_UUID_RE.search(file_name)
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


class DemoParser:
    def parse(self, demo_path: Path, checksum: str | None = None) -> ParsedDemo:
        try:
            from demoparser2 import DemoParser as Demoparser2  # type: ignore
        except Exception as exc:
            raise ProcessingError(ErrorCode.PARSER_FAILED, "demoparser2 is not installed") from exc

        checksum = checksum or sha256_file(demo_path)
        faceit_match_id = extract_faceit_match_id(demo_path.name)

        try:
            parser = Demoparser2(str(demo_path))
            header = parser.parse_header()
            map_name = header.get("map_name") or header.get("map") or "unknown"
            tick_rate = header.get("tick_rate")
            match_start_tick = self._match_start_tick(parser)
            players = self._parse_players(parser, match_start_tick)
            teams = self._build_teams(players)
            rounds = self._parse_rounds(parser, match_start_tick)
            kills = self._apply_scoreboard_stats(parser, players, match_start_tick)
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
            tick_rate=int(tick_rate) if tick_rate else None,
            raw_metadata=sanitize_json_value(dict(header)),
            teams=teams,
            team_1_score=team_1_score,
            team_2_score=team_2_score,
            rounds=rounds,
            kills=kills,
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

        rounds: list[ParsedRound] = []
        for row in rows:
            tick = int(row.get("tick") or 0)
            winner_side = row.get("winner")
            if tick < match_start_tick or not has_value(winner_side):
                continue
            round_number = len(rounds) + 1
            winner_team_number = self._winner_team_number(str(winner_side), round_number)
            rounds.append(
                ParsedRound(
                    round_number=round_number,
                    half=1 if round_number <= 12 else 2,
                    winner_team_number=winner_team_number,
                    winner_side=str(winner_side),
                    reason=str(row["reason"]) if has_value(row.get("reason")) else None,
                    ended_at_demo_time=float(tick),
                )
            )
        return rounds

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
