from scout_processor.faceit_metadata import extract_played_at_from_match_payload


def test_extract_played_at_from_match_payload_accepts_unix_seconds():
    value = extract_played_at_from_match_payload({"started_at": 1_720_000_000})

    assert value is not None
    assert value.year == 2024


def test_extract_played_at_from_match_payload_accepts_iso_strings():
    value = extract_played_at_from_match_payload({"finishedAt": "2026-07-19T18:00:00Z"})

    assert value is not None
    assert value.year == 2026
