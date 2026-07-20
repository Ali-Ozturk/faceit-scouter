import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const importStatus = pgEnum("import_status", [
  "DISCOVERED",
  "WAITING_FOR_STABILITY",
  "CLAIMED",
  "DECOMPRESSING",
  "PARSING",
  "PERSISTING",
  "COMPLETED",
  "DUPLICATE",
  "FAILED",
]);

export const importedDemo = pgTable("imported_demo", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileName: text("file_name").notNull(),
  originalPath: text("original_path").notNull(),
  currentPath: text("current_path"),
  sourceExtension: text("source_extension").notNull(),
  fileSize: integer("file_size").notNull(),
  sha256Checksum: text("sha256_checksum"),
  faceitMatchId: text("faceit_match_id"),
  status: importStatus("status").notNull().default("DISCOVERED"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  parserName: text("parser_name"),
  parserVersion: text("parser_version"),
  schemaVersion: integer("schema_version").notNull().default(1),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  processingCompletedAt: timestamp("processing_completed_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  parsedMatchId: uuid("parsed_match_id"),
  duplicateOfImportId: uuid("duplicate_of_import_id"),
});

export const importStageLog = pgTable("import_stage_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  importId: uuid("import_id").notNull().references(() => importedDemo.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  stage: text("stage").notNull(),
  durationMs: integer("duration_ms").notNull(),
  worker: text("worker"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const csMatch = pgTable("cs_match", {
  id: uuid("id").defaultRandom().primaryKey(),
  faceitMatchId: text("faceit_match_id"),
  internalFingerprint: text("internal_fingerprint").notNull().unique(),
  mapName: text("map_name").notNull(),
  playedAt: timestamp("played_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  team1Score: integer("team_1_score"),
  team2Score: integer("team_2_score"),
  overtimeRounds: integer("overtime_rounds"),
  tickRate: integer("tick_rate"),
  rawMetadataJson: jsonb("raw_metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  faceitUnique: unique("cs_match_faceit_match_id_unique").on(table.faceitMatchId),
}));

export const player = pgTable("player", {
  id: uuid("id").defaultRandom().primaryKey(),
  steamId: text("steam_id").notNull().unique(),
  faceitPlayerId: text("faceit_player_id"),
  latestNickname: text("latest_nickname").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchTeam = pgTable("match_team", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  teamNumber: integer("team_number").notNull(),
  startingSide: text("starting_side"),
  score: integer("score"),
  exactLineupFingerprint: text("exact_lineup_fingerprint"),
  displayName: text("display_name").notNull(),
}, (table) => ({
  matchTeamUnique: unique("match_team_match_number_unique").on(table.matchId, table.teamNumber),
}));

export const matchPlayer = pgTable("match_player", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  matchTeamId: uuid("match_team_id").notNull().references(() => matchTeam.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  nicknameInMatch: text("nickname_in_match").notNull(),
  kills: integer("kills"),
  deaths: integer("deaths"),
  assists: integer("assists"),
  headshots: integer("headshots"),
  damage: integer("damage"),
  kast: doublePrecision("kast"),
  rating: doublePrecision("rating"),
}, (table) => ({
  matchPlayerUnique: unique("match_player_match_player_unique").on(table.matchId, table.playerId),
}));

export const round = pgTable("round", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  half: integer("half"),
  overtimeNumber: integer("overtime_number"),
  team1Side: text("team_1_side"),
  team2Side: text("team_2_side"),
  winnerMatchTeamId: uuid("winner_match_team_id").references(() => matchTeam.id),
  winnerSide: text("winner_side"),
  reason: text("reason"),
  bombsite: text("bombsite"),
  bombPlanted: boolean("bomb_planted"),
  durationSeconds: doublePrecision("duration_seconds"),
  team1EquipmentValue: integer("team_1_equipment_value"),
  team2EquipmentValue: integer("team_2_equipment_value"),
  team1BuyType: text("team_1_buy_type"),
  team2BuyType: text("team_2_buy_type"),
  startedAtDemoTime: doublePrecision("started_at_demo_time"),
  endedAtDemoTime: doublePrecision("ended_at_demo_time"),
}, (table) => ({
  roundUnique: unique("round_match_number_unique").on(table.matchId, table.roundNumber),
}));

export const killEvent = pgTable("kill_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => round.id, { onDelete: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(),
  demoTime: doublePrecision("demo_time"),
  attackerPlayerId: uuid("attacker_player_id").references(() => player.id),
  victimPlayerId: uuid("victim_player_id").references(() => player.id),
  assisterPlayerId: uuid("assister_player_id").references(() => player.id),
  attackerTeamId: uuid("attacker_team_id").references(() => matchTeam.id),
  victimTeamId: uuid("victim_team_id").references(() => matchTeam.id),
  weapon: text("weapon"),
  headshot: boolean("headshot"),
  wallbang: boolean("wallbang"),
  throughSmoke: boolean("through_smoke"),
  attackerBlind: boolean("attacker_blind"),
  victimBlind: boolean("victim_blind"),
  tradeKill: boolean("trade_kill"),
  openingKill: boolean("opening_kill"),
  attackerX: doublePrecision("attacker_x"),
  attackerY: doublePrecision("attacker_y"),
  attackerZ: doublePrecision("attacker_z"),
  victimX: doublePrecision("victim_x"),
  victimY: doublePrecision("victim_y"),
  victimZ: doublePrecision("victim_z"),
});

export const bombEvent = pgTable("bomb_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => round.id, { onDelete: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(),
  eventType: text("event_type").notNull(),
  playerId: uuid("player_id").references(() => player.id),
  site: text("site"),
  demoTime: doublePrecision("demo_time"),
  x: doublePrecision("x"),
  y: doublePrecision("y"),
  z: doublePrecision("z"),
});

export const grenadeEvent = pgTable("grenade_event", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  roundId: uuid("round_id").references(() => round.id, { onDelete: "cascade" }),
  sequenceNumber: integer("sequence_number").notNull(),
  throwerPlayerId: uuid("thrower_player_id").references(() => player.id),
  throwerTeamId: uuid("thrower_team_id").references(() => matchTeam.id),
  grenadeType: text("grenade_type").notNull(),
  thrownDemoTime: doublePrecision("thrown_demo_time"),
  demoTime: doublePrecision("demo_time"),
  startX: doublePrecision("start_x"),
  startY: doublePrecision("start_y"),
  startZ: doublePrecision("start_z"),
  endX: doublePrecision("end_x"),
  endY: doublePrecision("end_y"),
  endZ: doublePrecision("end_z"),
});

export const roundPositionSample = pgTable("round_position_sample", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => csMatch.id, { onDelete: "cascade" }),
  matchTeamId: uuid("match_team_id").notNull().references(() => matchTeam.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
  roundNumber: integer("round_number").notNull(),
  side: text("side").notNull(),
  tick: integer("tick").notNull(),
  seconds: doublePrecision("seconds").notNull(),
  playerName: text("player_name").notNull(),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  z: doublePrecision("z"),
  alive: boolean("alive"),
}, (table) => ({
  sampleUnique: unique("round_position_sample_unique").on(table.matchId, table.playerId, table.roundNumber, table.tick),
}));

export const teamLineup = pgTable("team_lineup", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  displayName: text("display_name").notNull(),
  playerCount: integer("player_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamLineupMember = pgTable("team_lineup_member", {
  teamLineupId: uuid("team_lineup_id").notNull().references(() => teamLineup.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamLineupId, table.playerId] }),
}));

export const matchTeamLineup = pgTable("match_team_lineup", {
  matchTeamId: uuid("match_team_id").notNull().references(() => matchTeam.id, { onDelete: "cascade" }),
  teamLineupId: uuid("team_lineup_id").notNull().references(() => teamLineup.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.matchTeamId, table.teamLineupId] }),
}));

export const teamCore = pgTable("team_core", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  displayName: text("display_name").notNull(),
  minimumOverlap: integer("minimum_overlap").notNull().default(4),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamCoreMember = pgTable("team_core_member", {
  teamCoreId: uuid("team_core_id").notNull().references(() => teamCore.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => player.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.teamCoreId, table.playerId] }),
}));

export const teamMapSummary = pgTable("team_map_summary", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamLineupId: uuid("team_lineup_id").references(() => teamLineup.id, { onDelete: "cascade" }),
  teamCoreId: uuid("team_core_id").references(() => teamCore.id, { onDelete: "cascade" }),
  mapName: text("map_name").notNull(),
  matchCount: integer("match_count").notNull().default(0),
  roundCount: integer("round_count").notNull().default(0),
  firstMatchAt: timestamp("first_match_at", { withTimezone: true }),
  lastMatchAt: timestamp("last_match_at", { withTimezone: true }),
  summaryJson: jsonb("summary_json"),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  analysisVersion: integer("analysis_version").notNull().default(1),
});

export const faceitAnalysis = pgTable("faceit_analysis", {
  id: uuid("id").defaultRandom().primaryKey(),
  faceitMatchId: text("faceit_match_id").notNull(),
  requestingPlayerFaceitId: text("requesting_player_faceit_id").notNull(),
  selectedMap: text("selected_map"),
  opponentFaction: text("opponent_faction").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const faceitAnalysisOpponent = pgTable("faceit_analysis_opponent", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => faceitAnalysis.id, { onDelete: "cascade" }),
  faceitPlayerId: text("faceit_player_id").notNull(),
  nickname: text("nickname").notNull(),
});

export const faceitAnalysisCandidate = pgTable("faceit_analysis_candidate", {
  id: uuid("id").defaultRandom().primaryKey(),
  analysisId: uuid("analysis_id").notNull().references(() => faceitAnalysis.id, { onDelete: "cascade" }),
  faceitMatchId: text("faceit_match_id").notNull(),
  mapName: text("map_name"),
  sharedPlayerCount: integer("shared_player_count").notNull(),
  sharedPlayersJson: jsonb("shared_players_json").notNull(),
  playedAt: timestamp("played_at", { withTimezone: true }),
  faceitMatchroomUrl: text("faceit_matchroom_url").notNull(),
  processedMatchId: uuid("processed_match_id").references(() => csMatch.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  analysisCandidateUnique: unique("faceit_analysis_candidate_unique").on(table.analysisId, table.faceitMatchId),
}));
