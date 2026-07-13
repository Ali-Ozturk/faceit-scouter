from scout_processor.parsing.parser_models import ParsedRound


def build_rounds(round_rows: list[dict]) -> list[ParsedRound]:
    rounds: list[ParsedRound] = []
    for index, row in enumerate(round_rows, start=1):
        rounds.append(
            ParsedRound(
                round_number=int(row.get("round_num") or row.get("round") or index),
                half=row.get("half"),
                winner_side=row.get("winner_side"),
                reason=row.get("reason") or row.get("round_end_reason"),
                bombsite=row.get("site") or row.get("bombsite"),
                bomb_planted=row.get("bomb_planted"),
                duration_seconds=row.get("duration_seconds"),
                started_at_demo_time=row.get("start"),
                ended_at_demo_time=row.get("end"),
            )
        )
    return rounds
