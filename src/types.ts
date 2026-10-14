export type SessionKind = "focus" | "shortBreak" | "longBreak";
export type SessionStatus = "idle" | "running" | "paused";

export type Settings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  theme: "light" | "dark";
  musicEnabled: boolean;
  musicTrack: number;
};

export type SessionRecord = {
  id: number;
  kind: SessionKind;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

export type ActiveTimer = {
  kind: SessionKind;
  status: SessionStatus;
  startedAt: number | null;
  endAt: number | null;
  remainingSeconds: number;
  completedFocusCount: number;
};
