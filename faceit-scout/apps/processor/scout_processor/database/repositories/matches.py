from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from scout_processor.analysis.lineup import exact_lineup_fingerprint, lineup_display_name
from scout_processor.database.models import (
    BombEvent,
    CsMatch,
    GrenadeEvent,
    ImportedDemo,
    KillEvent,
    MatchPlayer,
    MatchTeam,
    MatchTeamLineup,
    Player,
    Round,
    RoundPositionSample,
    TeamLineup,
    TeamLineupMember,
)
from scout_processor.parsing.parser_models import ParsedDemo


def persist_parsed_demo(session: Session, imported_demo: ImportedDemo, parsed: ParsedDemo) -> CsMatch:
    match = session.scalar(select(CsMatch).where(CsMatch.internal_fingerprint == parsed.internal_fingerprint))
    if not match:
        match = CsMatch(
            faceit_match_id=parsed.faceit_match_id,
            internal_fingerprint=parsed.internal_fingerprint,
            map_name=parsed.map_name,
            played_at=parsed.played_at,
            duration_seconds=parsed.duration_seconds,
            team_1_score=parsed.team_1_score,
            team_2_score=parsed.team_2_score,
            overtime_rounds=parsed.overtime_rounds,
            tick_rate=parsed.tick_rate,
            raw_metadata_json=parsed.raw_metadata,
        )
        session.add(match)
        session.flush()
    else:
        match.faceit_match_id = parsed.faceit_match_id
        match.map_name = parsed.map_name
        match.played_at = parsed.played_at
        match.duration_seconds = parsed.duration_seconds
        match.team_1_score = parsed.team_1_score
        match.team_2_score = parsed.team_2_score
        match.overtime_rounds = parsed.overtime_rounds
        match.tick_rate = parsed.tick_rate
        match.raw_metadata_json = parsed.raw_metadata
        existing_team_ids = [
            row[0] for row in session.execute(select(MatchTeam.id).where(MatchTeam.match_id == match.id)).all()
        ]
        if existing_team_ids:
            session.execute(delete(KillEvent).where(KillEvent.match_id == match.id))
            session.execute(delete(BombEvent).where(BombEvent.match_id == match.id))
            session.execute(delete(GrenadeEvent).where(GrenadeEvent.match_id == match.id))
            session.execute(delete(RoundPositionSample).where(RoundPositionSample.match_id == match.id))
            session.execute(delete(Round).where(Round.match_id == match.id))
            session.execute(delete(MatchPlayer).where(MatchPlayer.match_id == match.id))
            session.execute(delete(MatchTeamLineup).where(MatchTeamLineup.match_team_id.in_(existing_team_ids)))
            session.execute(delete(MatchTeam).where(MatchTeam.match_id == match.id))
            session.flush()

    players_by_steam_id: dict[str, Player] = {}
    teams_by_number: dict[int, MatchTeam] = {}

    for parsed_team in parsed.teams:
        steam_ids = [player.steam_id for player in parsed_team.players]
        nicknames = [player.nickname for player in parsed_team.players]
        fingerprint = exact_lineup_fingerprint(steam_ids)
        display_name = lineup_display_name(nicknames)
        lineup = session.scalar(select(TeamLineup).where(TeamLineup.fingerprint == fingerprint))
        if not lineup:
            lineup = TeamLineup(fingerprint=fingerprint, display_name=display_name, player_count=len(steam_ids))
            session.add(lineup)
            session.flush()

        match_team = MatchTeam(
            match_id=match.id,
            team_number=parsed_team.team_number,
            starting_side=parsed_team.starting_side,
            score=parsed_team.score,
            exact_lineup_fingerprint=fingerprint,
            display_name=display_name,
        )
        session.add(match_team)
        session.flush()
        teams_by_number[parsed_team.team_number] = match_team
        session.merge(MatchTeamLineup(match_team_id=match_team.id, team_lineup_id=lineup.id))

        for parsed_player in parsed_team.players:
            player = session.scalar(select(Player).where(Player.steam_id == parsed_player.steam_id))
            if not player:
                player = Player(steam_id=parsed_player.steam_id, latest_nickname=parsed_player.nickname)
                session.add(player)
                session.flush()
            else:
                player.latest_nickname = parsed_player.nickname
            players_by_steam_id[parsed_player.steam_id] = player
            session.merge(TeamLineupMember(team_lineup_id=lineup.id, player_id=player.id))
            session.add(
                MatchPlayer(
                    match_id=match.id,
                    match_team_id=match_team.id,
                    player_id=player.id,
                    nickname_in_match=parsed_player.nickname,
                    kills=parsed_player.kills,
                    deaths=parsed_player.deaths,
                    assists=parsed_player.assists,
                    headshots=parsed_player.headshots,
                    damage=parsed_player.damage,
                )
            )

    rounds_by_number = {}
    for parsed_round in parsed.rounds:
        winner_team = teams_by_number.get(parsed_round.winner_team_number or -1)
        row = Round(
            match_id=match.id,
            round_number=parsed_round.round_number,
            half=parsed_round.half,
            winner_match_team_id=winner_team.id if winner_team else None,
            winner_side=parsed_round.winner_side,
            reason=parsed_round.reason,
            bombsite=parsed_round.bombsite,
            bomb_planted=parsed_round.bomb_planted,
            duration_seconds=parsed_round.duration_seconds,
            started_at_demo_time=parsed_round.started_at_demo_time,
            ended_at_demo_time=parsed_round.ended_at_demo_time,
        )
        session.add(row)
        session.flush()
        rounds_by_number[parsed_round.round_number] = row

    for event in parsed.kills:
        session.add(
            KillEvent(
                match_id=match.id,
                round_id=rounds_by_number.get(event.round_number).id if event.round_number in rounds_by_number else None,
                sequence_number=event.sequence_number,
                demo_time=event.demo_time,
                attacker_player_id=players_by_steam_id.get(event.attacker_steam_id).id if event.attacker_steam_id in players_by_steam_id else None,
                victim_player_id=players_by_steam_id.get(event.victim_steam_id).id if event.victim_steam_id in players_by_steam_id else None,
                assister_player_id=players_by_steam_id.get(event.assister_steam_id).id if event.assister_steam_id in players_by_steam_id else None,
                weapon=event.weapon,
                headshot=event.headshot,
                opening_kill=event.opening_kill,
            )
        )

    for event in parsed.bombs:
        session.add(
            BombEvent(
                match_id=match.id,
                round_id=rounds_by_number.get(event.round_number).id if event.round_number in rounds_by_number else None,
                sequence_number=event.sequence_number,
                event_type=event.event_type,
                player_id=players_by_steam_id.get(event.player_steam_id).id if event.player_steam_id in players_by_steam_id else None,
                site=event.site,
                demo_time=event.demo_time,
            )
        )

    for event in parsed.grenades:
        player = players_by_steam_id.get(event.thrower_steam_id) if event.thrower_steam_id else None
        session.add(
            GrenadeEvent(
                match_id=match.id,
                round_id=rounds_by_number.get(event.round_number).id if event.round_number in rounds_by_number else None,
                sequence_number=event.sequence_number,
                thrower_player_id=player.id if player else None,
                grenade_type=event.grenade_type,
                demo_time=event.demo_time,
            )
        )

    player_team_by_steam_id = {
        parsed_player.steam_id: teams_by_number[parsed_team.team_number].id
        for parsed_team in parsed.teams
        for parsed_player in parsed_team.players
        if parsed_team.team_number in teams_by_number
    }
    sample_rows = []
    for sample in parsed.position_samples:
        player = players_by_steam_id.get(sample.steam_id)
        match_team_id = player_team_by_steam_id.get(sample.steam_id)
        if not player or not match_team_id:
            continue
        sample_rows.append(
            {
                "match_id": match.id,
                "match_team_id": match_team_id,
                "player_id": player.id,
                "round_number": sample.round_number,
                "side": sample.side,
                "tick": sample.tick,
                "seconds": sample.seconds,
                "player_name": sample.player_name,
                "x": sample.x,
                "y": sample.y,
                "z": sample.z,
                "alive": sample.alive,
            }
        )
    if sample_rows:
        session.bulk_insert_mappings(RoundPositionSample, sample_rows)

    imported_demo.parsed_match_id = match.id
    return match
