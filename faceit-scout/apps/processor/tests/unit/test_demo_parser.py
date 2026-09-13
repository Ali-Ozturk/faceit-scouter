from scout_processor.parsing.demo_parser import dataframe_to_rows, extract_played_at_from_header, sanitize_json_value
from scout_processor.parsing.demo_parser import DemoParser
from scout_processor.parsing.demo_parser import EventBatchParser
from scout_processor.parsing.parser_models import ParsedPlayer, ParsedRound


class PolarsLikeFrame:
    def to_dicts(self):
        return [{"steamid": "1", "name": "A"}]


class PandasLikeFrame:
    def to_dict(self, orient=None):
        assert orient == "records"
        return [{"steamid": "2", "name": "B"}]


def test_event_batch_reuses_results_and_does_not_rescan_absent_events():
    class Native:
        def parse_events(self, names):
            assert 'round_end' in names
            return [('round_end', PolarsLikeFrame())]

        def parse_event(self, name):
            raise AssertionError('Unexpected repeated event scan')

    parser = EventBatchParser(Native())
    assert dataframe_to_rows(parser.parse_event('round_end')) == [{'steamid': '1', 'name': 'A'}]
    assert dataframe_to_rows(parser.parse_event('grenade_thrown')) == []


def test_event_batch_failure_preserves_individual_fallback():
    class Native:
        def parse_events(self, names):
            raise ValueError('unsupported batch')

        def parse_event(self, name):
            return PolarsLikeFrame()

    assert dataframe_to_rows(EventBatchParser(Native()).parse_event('round_end'))


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


def test_parse_player_loadouts_extracts_weapon_and_utility():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=104,
        )
    ]
    players = [ParsedPlayer(steam_id="765", nickname="A", team_number=2)]

    loadouts = DemoParser()._parse_player_loadouts(LoadoutTickParser(), players, rounds, tick_rate=4)

    assert len(loadouts) == 1
    assert loadouts[0].tick == 104
    assert loadouts[0].seconds == 1
    assert loadouts[0].weapon == "ak47"
    assert loadouts[0].utility == "flashbang, smokegrenade"
    assert loadouts[0].inventory == "ak47, smokegrenade, flashbang"


def test_parse_player_loadouts_ignores_numeric_weapon_handles():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=104,
        )
    ]
    players = [ParsedPlayer(steam_id="765", nickname="A", team_number=2)]

    loadouts = DemoParser()._parse_player_loadouts(NumericWeaponTickParser(), players, rounds, tick_rate=4)

    assert len(loadouts) == 1
    assert loadouts[0].weapon is None


def test_parse_player_loadouts_prefers_inventory_weapon_over_active_knife():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=200,
        )
    ]
    players = [ParsedPlayer(steam_id="765", nickname="A", team_number=2)]

    loadouts = DemoParser()._parse_player_loadouts(KnifeWithRifleInventoryTickParser(), players, rounds, tick_rate=4)

    assert len(loadouts) == 1
    assert loadouts[0].weapon == "ak47"
    assert loadouts[0].inventory == "ak47, glock, knife, flashbang"


def test_parse_player_loadouts_uses_later_non_knife_active_weapon_without_inventory():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=200,
        )
    ]
    players = [ParsedPlayer(steam_id="765", nickname="A", team_number=2)]

    loadouts = DemoParser()._parse_player_loadouts(ActiveWeaponSwitchTickParser(), players, rounds, tick_rate=4)

    assert len(loadouts) == 1
    assert loadouts[0].weapon == "ak47"


def test_parse_player_loadouts_ignores_knife_skins_and_utility_items():
    rounds = [
        ParsedRound(
            round_number=1,
            started_at_demo_time=100,
            ended_at_demo_time=200,
        )
    ]
    players = [ParsedPlayer(steam_id="765", nickname="A", team_number=2)]

    loadouts = DemoParser()._parse_player_loadouts(KnifeSkinAndUtilityTickParser(), players, rounds, tick_rate=4)

    assert len(loadouts) == 1
    assert loadouts[0].weapon is None
    assert loadouts[0].inventory == "m9_bayonet, gut, flip, smokegrenade"


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


class LoadoutTickParser:
    def parse_ticks(self, fields, ticks):
        assert "active_weapon_name" in fields
        assert "inventory" in fields
        return PandasLikeEventFrame([
            {
                "tick": tick,
                "steamid": 765.0,
                "name": "A",
                "team_name": "TERRORIST",
                "X": 1,
                "Y": 2,
                "Z": 3,
                "is_alive": True,
                "active_weapon_name": "weapon_ak47",
                "inventory": ["weapon_flashbang", "weapon_smokegrenade", "weapon_ak47"],
            }
            for tick in ticks
        ])


class NumericWeaponTickParser:
    def parse_ticks(self, fields, ticks):
        return PandasLikeEventFrame([
            {
                "tick": tick,
                "steamid": 765.0,
                "name": "A",
                "team_name": "TERRORIST",
                "active_weapon": 9568734,
            }
            for tick in ticks
        ])


class KnifeWithRifleInventoryTickParser:
    def parse_ticks(self, fields, ticks):
        return PandasLikeEventFrame([
            {
                "tick": tick,
                "steamid": 765.0,
                "name": "A",
                "team_name": "TERRORIST",
                "active_weapon_name": "weapon_knife",
                "inventory": ["weapon_knife", "weapon_glock", "weapon_ak47", "weapon_flashbang"],
            }
            for tick in ticks
        ])


class ActiveWeaponSwitchTickParser:
    def parse_ticks(self, fields, ticks):
        first_tick = min(ticks)
        return PandasLikeEventFrame([
            {
                "tick": tick,
                "steamid": 765.0,
                "name": "A",
                "team_name": "TERRORIST",
                "active_weapon_name": "weapon_knife" if tick == first_tick else "weapon_ak47",
            }
            for tick in ticks
        ])


class KnifeSkinAndUtilityTickParser:
    def parse_ticks(self, fields, ticks):
        values = ["Gut", "Flip", "M9 Bayonet", "Smoke Grenade"]
        return PandasLikeEventFrame([
            {
                "tick": tick,
                "steamid": 765.0,
                "name": "A",
                "team_name": "TERRORIST",
                "active_weapon_name": values[index % len(values)],
            }
            for index, tick in enumerate(ticks)
        ])


class PandasLikeEventFrame:
    def __init__(self, rows):
        self.rows = rows

    def to_dict(self, orient=None):
        assert orient == "records"
        return self.rows
