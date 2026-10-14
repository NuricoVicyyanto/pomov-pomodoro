import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import { ActiveTimer, SessionRecord, Settings } from "./types";

const dbPromise = SQLite.openDatabaseAsync("fokus-offline.db");
const SETTINGS_KEY = "fokus.settings.v1";
const TIMER_KEY = "fokus.activeTimer.v1";

export const DEFAULT_SETTINGS: Settings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  vibrationEnabled: true,
  theme: "light",
  musicEnabled: false,
  musicTrack: 1
};

export async function initializeDatabase() {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_seconds INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_ended_at ON sessions(ended_at);
  `);
}

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function getActiveTimer(): Promise<ActiveTimer | null> {
  try {
    const raw = await AsyncStorage.getItem(TIMER_KEY);
    return raw ? JSON.parse(raw) as ActiveTimer : null;
  } catch {
    return null;
  }
}

export async function saveActiveTimer(timer: ActiveTimer | null) {
  if (!timer) {
    await AsyncStorage.removeItem(TIMER_KEY);
  } else {
    await AsyncStorage.setItem(TIMER_KEY, JSON.stringify(timer));
  }
}

export async function insertSession(record: Omit<SessionRecord, "id">) {
  const db = await dbPromise;
  await db.runAsync(
    "INSERT INTO sessions (kind, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?)",
    record.kind,
    record.startedAt,
    record.endedAt,
    record.durationSeconds
  );
}

export async function getRecentSessions(limit = 50): Promise<SessionRecord[]> {
  const db = await dbPromise;
  const rows = await db.getAllAsync<{
    id: number; kind: SessionRecord["kind"]; started_at: number;
    ended_at: number; duration_seconds: number;
  }>("SELECT * FROM sessions ORDER BY ended_at DESC LIMIT ?", limit);
  return rows.map(row => ({
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds
  }));
}

export async function getDailyStats(days = 7) {
  const db = await dbPromise;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const rows = await db.getAllAsync<{ day: string; sessions: number; seconds: number }>(
    `SELECT date(ended_at / 1000, 'unixepoch', 'localtime') AS day,
            COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS seconds
     FROM sessions
     WHERE kind = 'focus' AND ended_at >= ?
     GROUP BY day ORDER BY day ASC`,
    start.getTime()
  );
  const byDay = new Map(rows.map(r => [r.day, r]));
  const result: { day: string; label: string; sessions: number; seconds: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const row = byDay.get(key);
    result.push({
      day: key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      sessions: row?.sessions ?? 0,
      seconds: row?.seconds ?? 0
    });
  }
  return result;
}

export async function getTodayStats() {
  const db = await dbPromise;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = await db.getFirstAsync<{ sessions: number; seconds: number }>(
    `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_seconds), 0) AS seconds
     FROM sessions WHERE kind = 'focus' AND ended_at >= ?`,
    start.getTime()
  );
  return { sessions: row?.sessions ?? 0, seconds: row?.seconds ?? 0 };
}
