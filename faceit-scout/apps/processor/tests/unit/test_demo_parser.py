from scout_processor.parsing.demo_parser import dataframe_to_rows, sanitize_json_value
from scout_processor.parsing.demo_parser import DemoParser


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
