from scout_processor.parsing.demo_parser import dataframe_to_rows, extract_played_at_from_header, sanitize_json_value
from scout_processor.parsing.demo_parser import DemoParser
from scout_processor.parsing.parser_models import ParsedRound


class PolarsLikeFrame:
    def to_dicts(self):
        return [{"steamid": "1", "name": "A"}]


class PandasLikeFrame:
    def to_dict(self, orient=None):
        assert orient == "records"
        return [{"steamid": "2", "name": "B"}]


def test_dataframe_to_rows_accepts_polars_shape():
    assert dataframe_to_rows(PolarsLikeFrame()) == [{"steamid": "1", "name": "A"}]


def test_dataframe_to_rows_accepts_pandas_shape():
    assert dataframe_to_rows(PandasLikeFrame()) == [{"steamid": "2", "name": "B"}]


def test_parse_players_accepts_team_number_column():
    class Parser:
        def parse_ticks(self, *_args, **_kwargs):
            raise RuntimeError("empty tick sample")

        def parse_player_info(self):
            return PandasLikePlayerInfoFrame()

    players = DemoParser()._parse_players(Parser())
    assert {player.nickname for player in players} == {"A", "B"}
    assert {player.team_number for player in players} == {1, 2}


def test_parse_players_falls_back_when_tick_dataframe_is_empty():
    class EmptyTickParser:
        def parse_ticks(self, *_args, **_kwargs):
            return PandasLikeEmptyFrame()

        def parse_player_info(self):
            return PandasLikePlayerInfoFrame()

    players = DemoParser()._parse_players(EmptyTickParser())
    assert len(players) == 2


def test_parse_players_uses_start_tick_team_membership_over_player_info():
    class Parser:
        def parse_player_info(self):
            return PandasLikePlayerInfoFrame()

        def parse_ticks(self, *_args, **_kwargs):
            return PandasLikeStartTickFrame()

    players = DemoParser()._parse_players(Parser(), match_start_tick=9561)
    by_name = {player.nickname: player.team_number for player in players}
    assert by_name == {"A": 2, "B": 1}


def test_sanitize_json_value_removes_null_bytes():
    value = sanitize_json_value({"demo_file_stamp": "PBDEMS2\x00", "nested": ["a\x00b"]})
    assert value == {"demo_file_stamp": "PBDEMS2", "nested": ["ab"]}


def test_extract_played_at_from_header_accepts_faceit_timestamps():
    value = extract_played_at_from_header({"started_at": 1_720_000_000})

    assert value is not None
    assert value.year == 2024


def test_parse_grenades_extracts_utility_positions():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=500,
        )
    ]

    events = DemoParser()._parse_grenades(GrenadeParser(), rounds, 100)

    assert len(events) == 2
    assert [(event.grenade_type, event.round_number) for event in events] == [
        ("flashbang", 1),
        ("smokegrenade", 1),
    ]
    assert events[0].thrower_steam_id == "765"
    assert events[0].thrown_demo_time == 125
    assert events[0].start_x == 5
    assert events[0].end_x == 10
    assert events[0].end_y == 20
    assert events[1].start_x == 1
    assert events[1].end_x == 40


class PandasLikePlayerInfoFrame:
    def to_dict(self, orient=None):
        assert orient == "records"
        return [
            {"steamid": 7656111, "name": "A", "team_number": 3},
            {"steamid": 7656112, "name": "B", "team_number": 2},
        ]


class PandasLikeEmptyFrame:
    def to_dict(self, orient=None):
        assert orient == "records"
        return []


class PandasLikeStartTickFrame:
    def to_dict(self, orient=None):
        assert orient == "records"
        return [
            {"steamid": 7656111, "name": "A", "team_num": 3, "team_name": "CT"},
            {"steamid": 7656112, "name": "B", "team_num": 2, "team_name": "TERRORIST"},
        ]


class GrenadeParser:
    def parse_event(self, event_name):
        return PandasLikeEventFrame({
            "grenade_thrown": [
                {"tick": 125, "user_steamid": 765.0, "weapon": "flashbang", "x": 5, "y": 6},
            ],
            "flashbang_detonate": [
                {"tick": 150, "user_steamid": 765.0, "x": 10, "y": 20, "z": 30},
            ],
            "smokegrenade_detonate": [
                {"tick": 250, "thrower_steamid": "766", "thrower_x": 1, "thrower_y": 2, "x": 40, "y": 50},
            ],
        }.get(event_name, []))


class PandasLikeEventFrame:
    def __init__(self, rows):
        self.rows = rows

    def to_dict(self, orient=None):
        assert orient == "records"
        return self.rows
