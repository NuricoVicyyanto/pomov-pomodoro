import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, AppState, AppStateStatus, Easing, Keyboard, Pressable, SafeAreaView, ScrollView,
  StyleSheet, Switch, Text, TextInput, View
} from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { MUSIC_TRACKS, trackById } from "./src/music";
import {
  DEFAULT_SETTINGS, getActiveTimer, getDailyStats, getRecentSessions, getSettings,
  getTodayStats, initializeDatabase, insertSession, saveActiveTimer, saveSettings
} from "./src/storage";
import { cancelTimerNotification, configureNotifications, scheduleCompletionNotification } from "./src/notifications";
import { ActiveTimer, SessionKind, SessionRecord, Settings } from "./src/types";

type Screen = "timer" | "stats" | "settings";
type Theme = "light" | "dark";

type Palette = {
  bg: string; surface: string; text: string; muted: string;
  accent: string; accentDeep: string; accentSoft: string; border: string;
  track: string; shadow: string; ringTrack: string;
};

const PALETTES: Record<Theme, Palette> = {
  // Lofi: warm cream paper with muted clay/terracotta accent.
  light: {
    bg: "#EFE7D8", surface: "#F8F2E7", text: "#4A3F35", muted: "#A99B88",
    accent: "#B5765A", accentDeep: "#9A5E45", accentSoft: "#E7D7C6", border: "#E0D4C1",
    track: "#E4D8C6", shadow: "#8A6F52", ringTrack: "#E2D3BF"
  },
  // Lofi night: dim warm brown with a dusty clay glow.
  dark: {
    bg: "#211C17", surface: "#2B2520", text: "#EFE4D3", muted: "#8E8070",
    accent: "#C98A6B", accentDeep: "#B27454", accentSoft: "#3A2F26", border: "#352D25",
    track: "#312A23", shadow: "#000000", ringTrack: "#3A2F26"
  }
};

const kindLabels: Record<SessionKind, string> = {
  focus: "Focus",
  shortBreak: "Break",
  longBreak: "Long break"
};

const kindMeta: Record<SessionKind, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  focus: { label: "Focus", icon: "flash" },
  shortBreak: { label: "Break", icon: "cafe" },
  longBreak: { label: "Rest", icon: "moon" }
};

function durationFor(kind: SessionKind, settings: Settings) {
  if (kind === "focus") return settings.focusMinutes * 60;
  if (kind === "shortBreak") return settings.shortBreakMinutes * 60;
  return settings.longBreakMinutes * 60;
}

function minutesFor(kind: SessionKind, settings: Settings) {
  if (kind === "focus") return settings.focusMinutes;
  if (kind === "shortBreak") return settings.shortBreakMinutes;
  return settings.longBreakMinutes;
}

function withMinutes(kind: SessionKind, settings: Settings, minutes: number): Settings {
  if (kind === "focus") return { ...settings, focusMinutes: minutes };
  if (kind === "shortBreak") return { ...settings, shortBreakMinutes: minutes };
  return { ...settings, longBreakMinutes: minutes };
}

const MIN_MAX: Record<SessionKind, [number, number]> = {
  focus: [1, 180],
  shortBreak: [1, 60],
  longBreak: [1, 90]
};

function clampMinutes(kind: SessionKind, minutes: number) {
  const [min, max] = MIN_MAX[kind];
  if (Number.isNaN(minutes)) return min;
  return Math.min(max, Math.max(min, Math.round(minutes)));
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function dateLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
  });
}

// Compute the next session in the Pomodoro chain after one completes.
function nextSession(completed: ActiveTimer, settings: Settings): { kind: SessionKind; focusCount: number; autoStart: boolean } {
  let focusCount = completed.completedFocusCount;
  let nextKind: SessionKind = "focus";
  if (completed.kind === "focus") {
    focusCount += 1;
    nextKind = focusCount % Math.max(1, settings.longBreakInterval) === 0 ? "longBreak" : "shortBreak";
  }
  const autoStart = nextKind === "focus" ? settings.autoStartFocus : settings.autoStartBreaks;
  return { kind: nextKind, focusCount, autoStart };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("timer");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState<ActiveTimer>({
    kind: "focus", status: "idle", startedAt: null, endAt: null,
    remainingSeconds: DEFAULT_SETTINGS.focusMinutes * 60, completedFocusCount: 0
  });
  const [now, setNow] = useState(Date.now());
  const [today, setToday] = useState({ sessions: 0, seconds: 0 });
  const [week, setWeek] = useState<{ day: string; label: string; sessions: number; seconds: number }[]>([]);
  const [recent, setRecent] = useState<SessionRecord[]>([]);
  const [editing, setEditing] = useState(false);
  const [draftMinutes, setDraftMinutes] = useState("");
  const processingRef = useRef(false);
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const theme = settings.theme;
  const C = PALETTES[theme];
  const styles = useMemo(() => createStyles(C), [C]);

  // Animated values
  const progressAnim = useRef(new Animated.Value(0)).current;
  const screenAnim = useRef(new Animated.Value(1)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  // Background music player (expo-audio). Starts with the saved track.
  const musicPlayer = useAudioPlayer(trackById(settings.musicTrack).source);
  const musicTrackRef = useRef(settings.musicTrack);

  // Configure audio so music keeps playing in the background and mixes with
  // notification sounds instead of ducking everything.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "mixWithOthers"
    }).catch(() => {});
    musicPlayer.loop = true;
  }, [musicPlayer]);

  // React to music enable/disable and track selection.
  useEffect(() => {
    if (!ready) return;
    try {
      if (musicTrackRef.current !== settings.musicTrack) {
        musicTrackRef.current = settings.musicTrack;
        musicPlayer.replace(trackById(settings.musicTrack).source);
        musicPlayer.loop = true;
      }
      if (settings.musicEnabled) {
        musicPlayer.play();
      } else {
        musicPlayer.pause();
      }
    } catch (e) {
      console.error("Music control failed:", e);
    }
  }, [ready, settings.musicEnabled, settings.musicTrack, musicPlayer]);

  const remaining = timer.status === "running" && timer.endAt
    ? Math.max(0, Math.ceil((timer.endAt - now) / 1000))
    : timer.remainingSeconds;

  const total = durationFor(timer.kind, settings);
  const progress = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;

  const refreshStats = useCallback(async () => {
    const [todayStats, weekStats, sessions] = await Promise.all([
      getTodayStats(), getDailyStats(7), getRecentSessions(30)
    ]);
    setToday(todayStats);
    setWeek(weekStats);
    setRecent(sessions);
  }, []);

  // Insert a completed session record. Used by both live completion and catch-up.
  const recordSession = useCallback(async (completed: ActiveTimer, endedAt: number) => {
    const dur = durationFor(completed.kind, settingsRef.current);
    const startedAt = completed.startedAt ?? (endedAt - dur * 1000);
    await insertSession({ kind: completed.kind, startedAt, endedAt, durationSeconds: dur });
  }, []);

  // Advance through any sessions that finished while the app was backgrounded/closed.
  // Returns the resulting active timer.
  const catchUp = useCallback(async (start: ActiveTimer): Promise<ActiveTimer> => {
    let current = { ...start };
    // Only chains that were actually running can elapse.
    while (current.status === "running" && current.endAt && current.endAt <= Date.now()) {
      await recordSession(current, current.endAt);
      const { kind, focusCount, autoStart } = nextSession(current, settingsRef.current);
      const dur = durationFor(kind, settingsRef.current);
      if (autoStart) {
        // Auto-started next session begins exactly when the previous ended.
        const startedAt = current.endAt;
        current = {
          kind, status: "running", startedAt,
          endAt: startedAt + dur * 1000, remainingSeconds: dur, completedFocusCount: focusCount
        };
      } else {
        current = {
          kind, status: "idle", startedAt: null, endAt: null,
          remainingSeconds: dur, completedFocusCount: focusCount
        };
      }
    }
    return current;
  }, [recordSession]);

  useEffect(() => {
    (async () => {
      await initializeDatabase();
      await configureNotifications();
      const [storedSettings, storedTimer] = await Promise.all([getSettings(), getActiveTimer()]);
      setSettings(storedSettings);
      settingsRef.current = storedSettings;
      if (storedTimer) {
        // Catch up on anything that elapsed while closed.
        const restored = await catchUp(storedTimer);
        if (restored.status === "running" && restored.endAt) {
          restored.remainingSeconds = Math.max(0, Math.ceil((restored.endAt - Date.now()) / 1000));
          // Re-arm the completion notification for the still-running session.
          await scheduleCompletionNotification(
            restored.remainingSeconds,
            `${kindLabels[restored.kind]} complete`,
            "Your timer session has finished."
          );
        }
        setTimer(restored);
        await saveActiveTimer(restored);
      } else {
        setTimer({
          kind: "focus", status: "idle", startedAt: null, endAt: null,
          remainingSeconds: storedSettings.focusMinutes * 60, completedFocusCount: 0
        });
      }
      await refreshStats();
      setReady(true);
    })().catch(err => console.error("Initialization failed:", err));
  }, [refreshStats, catchUp]);

  useEffect(() => {
    if (!ready) return;
    saveActiveTimer(timer).catch(console.error);
  }, [timer, ready]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  // Smooth progress ring animation.
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true
    }).start();
  }, [progress, progressAnim]);

  // Breathing animation on the clock while running.
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (timer.status === "running") {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
        ])
      );
      loop.start();
    } else {
      Animated.timing(breathe, { toValue: 0, duration: 400, useNativeDriver: true }).start();
    }
    return () => { loop?.stop(); };
  }, [timer.status, breathe]);

  // Ambient lofi drift: a slow, continuous loop that floats the soft particles.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(drift, { toValue: 1, duration: 7000, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [drift]);

  const changeScreen = useCallback((next: Screen) => {
    Animated.timing(screenAnim, {
      toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true
    }).start(() => {
      setScreen(next);
      Animated.timing(screenAnim, {
        toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true
      }).start();
    });
  }, [screenAnim]);

  const pressIn = () => Animated.spring(buttonScale, { toValue: 0.93, useNativeDriver: true, speed: 50 }).start();
  const pressOut = () => Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 8 }).start();

  // Live completion while the app is in the foreground.
  const completeSession = useCallback(async (completed: ActiveTimer) => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      await cancelTimerNotification();
      await recordSession(completed, Date.now());
      const { kind, focusCount, autoStart } = nextSession(completed, settingsRef.current);
      const dur = durationFor(kind, settingsRef.current);
      const next: ActiveTimer = {
        kind,
        status: autoStart ? "running" : "idle",
        startedAt: autoStart ? Date.now() : null,
        endAt: autoStart ? Date.now() + dur * 1000 : null,
        remainingSeconds: dur,
        completedFocusCount: focusCount
      };
      setTimer(next);
      await saveActiveTimer(next);
      if (autoStart) {
        await scheduleCompletionNotification(dur, `${kindLabels[kind]} complete`, "Time to switch sessions.");
      }
      await refreshStats();
    } catch (error) {
      console.error("Could not complete session:", error);
    } finally {
      processingRef.current = false;
    }
  }, [recordSession, refreshStats]);

  useEffect(() => {
    if (!ready || timer.status !== "running" || remaining > 0) return;
    completeSession(timer);
  }, [ready, timer, remaining, completeSession]);

  // On returning to the foreground, catch up on elapsed sessions.
  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state !== "active") return;
      setNow(Date.now());
      const current = timerRef.current;
      if (current.status === "running" && current.endAt && current.endAt <= Date.now()) {
        (async () => {
          const resolved = await catchUp(current);
          if (resolved.status === "running" && resolved.endAt) {
            resolved.remainingSeconds = Math.max(0, Math.ceil((resolved.endAt - Date.now()) / 1000));
          }
          setTimer(resolved);
          await saveActiveTimer(resolved);
          await refreshStats();
        })().catch(console.error);
      } else {
        refreshStats().catch(console.error);
      }
    };
    const subscription = AppState.addEventListener("change", onAppState);
    return () => subscription.remove();
  }, [refreshStats, catchUp]);

  const persistSettings = async (next: Settings) => {
    setSettings(next);
    settingsRef.current = next;
    await saveSettings(next);
    if (timerRef.current.status !== "running") {
      setTimer(prev => ({ ...prev, remainingSeconds: durationFor(prev.kind, next) }));
    }
  };

  const adjustDuration = async (delta: number) => {
    if (timer.status === "running") return;
    const next = clampMinutes(timer.kind, minutesFor(timer.kind, settings) + delta);
    if (next === minutesFor(timer.kind, settings)) return;
    await persistSettings(withMinutes(timer.kind, settings, next));
  };

  const openEditor = () => {
    if (timer.status !== "idle") return;
    setDraftMinutes(String(minutesFor(timer.kind, settings)));
    setEditing(true);
  };

  const commitEditor = async () => {
    const parsed = clampMinutes(timer.kind, parseInt(draftMinutes, 10));
    setEditing(false);
    Keyboard.dismiss();
    await persistSettings(withMinutes(timer.kind, settings, parsed));
  };

  const startTimer = async () => {
    const seconds = Math.max(1, remaining);
    const startedAt = Date.now();
    setTimer({ ...timer, status: "running", startedAt, endAt: startedAt + seconds * 1000, remainingSeconds: seconds });
    await scheduleCompletionNotification(seconds, `${kindLabels[timer.kind]} complete`, "Your timer session has finished.");
  };

  const pauseTimer = async () => {
    const seconds = remaining;
    await cancelTimerNotification();
    setTimer({ ...timer, status: "paused", endAt: null, remainingSeconds: seconds });
  };

  const resetTimer = async () => {
    await cancelTimerNotification();
    setTimer({
      ...timer, status: "idle", startedAt: null, endAt: null,
      remainingSeconds: durationFor(timer.kind, settings)
    });
  };

  const selectKind = async (kind: SessionKind) => {
    if (kind === timer.kind) return;
    await cancelTimerNotification();
    setTimer({
      ...timer, kind, status: "idle", startedAt: null, endAt: null,
      remainingSeconds: durationFor(kind, settings)
    });
  };

  const skipTimer = async () => {
    await cancelTimerNotification();
    const current = timer;
    const nextKind: SessionKind = current.kind === "focus" ? "shortBreak" : "focus";
    setTimer({
      ...current, kind: nextKind, status: "idle", startedAt: null, endAt: null,
      remainingSeconds: durationFor(nextKind, settings)
    });
  };

  const toggleTheme = () => persistSettings({ ...settings, theme: theme === "light" ? "dark" : "light" });
  const toggleMusic = () => persistSettings({ ...settings, musicEnabled: !settings.musicEnabled });
  const selectTrack = (id: number) => persistSettings({ ...settings, musicTrack: id, musicEnabled: true });

  const totalWeekSeconds = useMemo(() => week.reduce((sum, day) => sum + day.seconds, 0), [week]);
  const totalWeekSessions = useMemo(() => week.reduce((sum, d) => sum + d.sessions, 0), [week]);

  const screenStyle = {
    opacity: screenAnim,
    transform: [{ translateY: screenAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }]
  };

  const rightRotate = progressAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "180deg", "180deg"] });
  const leftRotate = progressAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["0deg", "0deg", "180deg"] });
  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const breatheGlow = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.34] });

  if (!ready) {
    return (
      <SafeAreaView style={styles.loading}>
        <ExpoStatusBar style={theme === "dark" ? "light" : "dark"} />
        <View style={styles.loadingBadge}><Ionicons name="flash" size={30} color={C.accent} /></View>
        <Text style={styles.brand}>Pomov</Text>
      </SafeAreaView>
    );
  }

  const canEdit = timer.status === "idle";
  const [min, max] = MIN_MAX[timer.kind];
  const curMinutes = minutesFor(timer.kind, settings);

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style={theme === "dark" ? "light" : "dark"} />
      <View style={styles.app}>
        <View style={styles.topBar}>
          {screen !== "timer" ? (
            <Pressable onPress={() => changeScreen("timer")} style={styles.iconButton} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={C.text} />
            </Pressable>
          ) : <View style={styles.iconButton} />}
          <Text style={styles.topTitle}>
            {screen === "timer" ? "Pomov" : screen === "stats" ? "Statistics" : "Settings"}
          </Text>
          <View style={styles.topActions}>
            {screen === "timer" && (
              <>
                <Pressable onPress={toggleMusic} style={styles.iconButton} hitSlop={8}>
                  <Ionicons name={settings.musicEnabled ? "musical-notes" : "musical-notes-outline"} size={20} color={settings.musicEnabled ? C.accent : C.text} />
                </Pressable>
                <Pressable onPress={() => changeScreen("stats")} style={styles.iconButton} hitSlop={8}>
                  <Ionicons name="stats-chart" size={20} color={C.text} />
                </Pressable>
                <Pressable onPress={() => changeScreen("settings")} style={styles.iconButton} hitSlop={8}>
                  <Ionicons name="settings-outline" size={20} color={C.text} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {screen === "timer" && (
          <Animated.View style={[styles.timerScreen, screenStyle]}>
            <View style={styles.kindSwitch}>
              {(["focus", "shortBreak", "longBreak"] as SessionKind[]).map(kind => {
                const active = timer.kind === kind;
                return (
                  <Pressable key={kind} onPress={() => selectKind(kind)} style={[styles.kindPill, active && styles.kindPillActive]}>
                    <Ionicons name={kindMeta[kind].icon} size={15} color={active ? C.accent : C.muted} />
                    <Text style={[styles.kindPillText, active && styles.kindPillTextActive]}>{kindMeta[kind].label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.timerCenter}>
              <FloatingDots drift={drift} color={C.accent} />
              <Animated.View style={[styles.ringShadow, { shadowOpacity: breatheGlow, transform: [{ scale: breatheScale }] }]}>
                <View style={styles.ringOuter}>
                  <View style={styles.ringHalf}>
                    <Animated.View style={[styles.ringFill, { transform: [{ rotate: rightRotate }] }]} />
                  </View>
                  <View style={[styles.ringHalf, styles.ringHalfRight]}>
                    <Animated.View style={[styles.ringFill, styles.ringFillRight, { transform: [{ rotate: leftRotate }] }]} />
                  </View>
                  <Pressable style={styles.ringInner} onPress={openEditor} disabled={!canEdit}>
                    <Ionicons name={kindMeta[timer.kind].icon} size={18} color={C.accent} style={{ marginBottom: 6 }} />
                    {editing ? (
                      <TextInput
                        style={styles.timerInput}
                        value={draftMinutes}
                        onChangeText={t => setDraftMinutes(t.replace(/[^0-9]/g, "").slice(0, 3))}
                        keyboardType="number-pad"
                        autoFocus
                        maxLength={3}
                        onBlur={commitEditor}
                        onSubmitEditing={commitEditor}
                        returnKeyType="done"
                        selectTextOnFocus
                      />
                    ) : (
                      <Text style={styles.timerDigits}>{formatTime(remaining)}</Text>
                    )}
                    <Text style={styles.timerKind}>{editing ? "minutes" : canEdit ? "tap to edit" : kindMeta[timer.kind].label}</Text>
                  </Pressable>
                </View>
              </Animated.View>
            </View>

            <View style={[styles.durationBar, !canEdit && styles.durationHidden]} pointerEvents={canEdit ? "auto" : "none"}>
              <Pressable disabled={curMinutes <= min} onPress={() => adjustDuration(-1)} style={styles.durButton} hitSlop={6}>
                <Ionicons name="remove" size={20} color={C.text} />
              </Pressable>
              <Pressable onPress={openEditor} style={styles.durValueWrap}>
                <Text style={styles.durValue}>{curMinutes} min</Text>
              </Pressable>
              <Pressable disabled={curMinutes >= max} onPress={() => adjustDuration(1)} style={styles.durButton} hitSlop={6}>
                <Ionicons name="add" size={20} color={C.text} />
              </Pressable>
            </View>

            <View style={styles.controls}>
              <Pressable style={styles.ghostButton} onPress={resetTimer} hitSlop={6}>
                <Ionicons name="refresh" size={22} color={C.text} />
              </Pressable>
              <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                <Pressable
                  style={styles.mainButton}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  onPress={timer.status === "running" ? pauseTimer : startTimer}
                >
                  <Ionicons name={timer.status === "running" ? "pause" : "play"} size={22} color="#FFFFFF" />
                  <Text style={styles.mainButtonText}>
                    {timer.status === "running" ? "Pause" : timer.status === "paused" ? "Resume" : "Start"}
                  </Text>
                </Pressable>
              </Animated.View>
              <Pressable style={styles.ghostButton} onPress={skipTimer} hitSlop={6}>
                <Ionicons name="play-skip-forward" size={20} color={C.text} />
              </Pressable>
            </View>

            <Text style={styles.todayLine}>{today.sessions} sessions · {formatDuration(today.seconds)} today</Text>
          </Animated.View>
        )}

        {screen === "stats" && (
          <Animated.View style={[styles.flex, screenStyle]}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Ionicons name="time-outline" size={18} color={C.accent} />
                  <Text style={styles.summaryValue}>{formatDuration(totalWeekSeconds)}</Text>
                  <Text style={styles.summaryLabel}>7 days</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Ionicons name="checkmark-done-outline" size={18} color={C.accent} />
                  <Text style={styles.summaryValue}>{totalWeekSessions}</Text>
                  <Text style={styles.summaryLabel}>sessions</Text>
                </View>
              </View>

              <View style={styles.chart}>
                {week.map(day => {
                  const maxSec = Math.max(1, ...week.map(d => d.seconds));
                  const height = Math.max(4, (day.seconds / maxSec) * 110);
                  return (
                    <View key={day.day} style={styles.barCol}>
                      <View style={styles.barArea}>
                        <View style={[styles.barFill, { height }]} />
                      </View>
                      <Text style={styles.barLabel}>{day.label}</Text>
                    </View>
                  );
                })}
              </View>

              {recent.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <Ionicons name="leaf-outline" size={28} color={C.muted} />
                  <Text style={styles.emptyText}>No sessions yet.</Text>
                </View>
              ) : recent.map(item => (
                <View key={item.id} style={styles.historyRow}>
                  <View style={[styles.historyIcon, { backgroundColor: item.kind === "focus" ? C.accentSoft : C.track }]}>
                    <Ionicons name={kindMeta[item.kind].icon} size={15} color={item.kind === "focus" ? C.accent : C.muted} />
                  </View>
                  <Text style={styles.historyTitle}>{kindMeta[item.kind].label}</Text>
                  <Text style={styles.historyDate}>{dateLabel(item.endedAt)}</Text>
                  <Text style={styles.historyDuration}>{formatDuration(item.durationSeconds)}</Text>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {screen === "settings" && (
          <Animated.View style={[styles.flex, screenStyle]}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.group}>
                <SettingToggle C={C} styles={styles} icon="moon-outline" label="Dark mode" value={theme === "dark"} onChange={toggleTheme} />
                <SettingToggle C={C} styles={styles} icon="play-forward-outline" label="Auto-start breaks" value={settings.autoStartBreaks} onChange={value => persistSettings({ ...settings, autoStartBreaks: value })} />
                <SettingToggle C={C} styles={styles} icon="flash-outline" label="Auto-start focus" value={settings.autoStartFocus} onChange={value => persistSettings({ ...settings, autoStartFocus: value })} />
                <SettingToggle C={C} styles={styles} icon="volume-high-outline" label="Sound" value={settings.soundEnabled} onChange={value => persistSettings({ ...settings, soundEnabled: value })} />
                <SettingToggle C={C} styles={styles} icon="phone-portrait-outline" label="Vibration" value={settings.vibrationEnabled} onChange={value => persistSettings({ ...settings, vibrationEnabled: value })} />
                <StepperRow C={C} styles={styles} icon="repeat-outline" label="Long break interval" value={settings.longBreakInterval} min={2} max={8} onChange={value => persistSettings({ ...settings, longBreakInterval: value })} last />
              </View>

              <Text style={styles.groupLabel}>MUSIC</Text>
              <View style={styles.group}>
                <SettingToggle C={C} styles={styles} icon="musical-notes-outline" label="Background music" value={settings.musicEnabled} onChange={toggleMusic} last />
              </View>
              <View style={styles.trackWrap}>
                {MUSIC_TRACKS.map(track => {
                  const active = settings.musicTrack === track.id && settings.musicEnabled;
                  return (
                    <Pressable key={track.id} onPress={() => selectTrack(track.id)} style={[styles.trackChip, active && styles.trackChipActive]}>
                      <Ionicons name={active ? "musical-note" : "musical-note-outline"} size={14} color={active ? "#FFFFFF" : C.muted} />
                      <Text style={[styles.trackChipText, active && styles.trackChipTextActive]}>{track.name}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.versionText}>Pomov · Offline · 1.0.0</Text>
            </ScrollView>
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

// Soft ambient particles that drift behind the timer — a gentle lofi touch.
const DOTS = [
  { left: 24, top: 18, size: 7, range: 14, phase: 0 },
  { left: 268, top: 36, size: 5, range: 18, phase: 0.35 },
  { left: 50, top: 240, size: 6, range: 16, phase: 0.6 },
  { left: 286, top: 236, size: 8, range: 20, phase: 0.15 },
  { left: 300, top: 150, size: 4, range: 12, phase: 0.8 },
  { left: 10, top: 150, size: 5, range: 15, phase: 0.5 }
];

function FloatingDots({ drift, color }: { drift: Animated.Value; color: string }) {
  return (
    <View pointerEvents="none" style={dotStyles.layer}>
      {DOTS.map((d, i) => {
        // Shift each dot's phase so they don't move in unison.
        const shifted = Animated.modulo(Animated.add(drift, new Animated.Value(d.phase)), 1);
        const translateY = shifted.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -d.range, 0] });
        const opacity = shifted.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.12, 0.3, 0.12] });
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute", left: d.left, top: d.top,
              width: d.size, height: d.size, borderRadius: d.size / 2,
              backgroundColor: color, opacity, transform: [{ translateY }]
            }}
          />
        );
      })}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  layer: { position: "absolute", width: 320, height: 320, alignItems: "center", justifyContent: "center" }
});

function StepperRow({ C, styles, icon, label, value, min, max, onChange, last }: {
  C: Palette; styles: ReturnType<typeof createStyles>; icon: keyof typeof Ionicons.glyphMap;
  label: string; value: number; min: number; max: number; onChange: (value: number) => void; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}><Ionicons name={icon} size={17} color={C.accent} /></View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <View style={styles.stepper}>
        <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepButton} hitSlop={6}><Ionicons name="remove" size={16} color={C.text} /></Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={styles.stepButton} hitSlop={6}><Ionicons name="add" size={16} color={C.text} /></Pressable>
      </View>
    </View>
  );
}

function SettingToggle({ C, styles, icon, label, value, onChange, last }: {
  C: Palette; styles: ReturnType<typeof createStyles>; icon: keyof typeof Ionicons.glyphMap;
  label: string; value: boolean; onChange: (value: boolean) => void; last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={styles.rowLeft}>
        <View style={styles.rowIcon}><Ionicons name={icon} size={17} color={C.accent} /></View>
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: C.track, true: C.accentSoft }} thumbColor={value ? C.accent : C.surface} />
    </View>
  );
}

const RING = 260;
const RING_HALF = RING / 2;

function createStyles(C: Palette) {
  const softShadow = {
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4
  };
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.bg },
    app: { flex: 1 },
    flex: { flex: 1 },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg, gap: 16 },
    loadingBadge: { width: 64, height: 64, borderRadius: 22, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center", ...softShadow },
    brand: { color: C.text, fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },

    topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 8, height: 54 },
    topTitle: { color: C.text, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
    topActions: { flexDirection: "row", gap: 2 },
    iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },

    timerScreen: { flex: 1, paddingHorizontal: 24, alignItems: "center" },
    kindSwitch: { flexDirection: "row", backgroundColor: C.track, borderRadius: 24, padding: 5, gap: 4 },
    kindPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 20 },
    kindPillActive: { backgroundColor: C.surface, ...softShadow, shadowOpacity: 0.1 },
    kindPillText: { color: C.muted, fontSize: 13, fontWeight: "600" },
    kindPillTextActive: { color: C.text },

    timerCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
    ringShadow: {
      width: RING, height: RING, borderRadius: RING_HALF, alignItems: "center", justifyContent: "center",
      shadowColor: C.accent, shadowOffset: { width: 0, height: 12 }, shadowRadius: 30, elevation: 10
    },
    ringOuter: { width: RING, height: RING, borderRadius: RING_HALF, backgroundColor: C.ringTrack, alignItems: "center", justifyContent: "center", overflow: "hidden" },
    ringHalf: { position: "absolute", width: RING_HALF, height: RING, left: 0, top: 0, overflow: "hidden" },
    ringHalfRight: { left: RING_HALF },
    ringFill: { width: RING_HALF, height: RING, borderTopLeftRadius: RING_HALF, borderBottomLeftRadius: RING_HALF, backgroundColor: C.accent, transformOrigin: "right" },
    ringFillRight: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: RING_HALF, borderBottomRightRadius: RING_HALF, transformOrigin: "left" },
    ringInner: {
      width: RING - 34, height: RING - 34, borderRadius: (RING - 34) / 2, backgroundColor: C.surface,
      alignItems: "center", justifyContent: "center",
      shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8
    },
    timerDigits: { color: C.text, fontSize: 56, fontWeight: "200", letterSpacing: -2 },
    timerInput: { color: C.text, fontSize: 56, fontWeight: "200", letterSpacing: -2, textAlign: "center", minWidth: 120, padding: 0 },
    timerKind: { color: C.muted, fontSize: 14, marginTop: 2, fontWeight: "500" },

    durationBar: { flexDirection: "row", alignItems: "center", gap: 20, marginTop: 6, marginBottom: 22 },
    durationHidden: { opacity: 0 },
    durButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: C.surface, ...softShadow },
    durValueWrap: { minWidth: 80, alignItems: "center" },
    durValue: { color: C.text, fontSize: 15, fontWeight: "600", textAlign: "center" },

    controls: { flexDirection: "row", alignItems: "center", gap: 18, marginBottom: 10 },
    mainButton: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: C.accent, borderRadius: 32, paddingVertical: 16, paddingHorizontal: 44, shadowColor: C.accent, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 14, elevation: 6 },
    mainButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
    ghostButton: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: C.surface, ...softShadow },
    todayLine: { color: C.muted, fontSize: 13, marginTop: 22, marginBottom: 8, fontWeight: "500" },

    scrollContent: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, gap: 18 },

    summaryRow: { flexDirection: "row", gap: 12 },
    summaryItem: { flex: 1, backgroundColor: C.surface, borderRadius: 20, padding: 18, gap: 6, ...softShadow },
    summaryValue: { color: C.text, fontSize: 27, fontWeight: "700", letterSpacing: -0.5 },
    summaryLabel: { color: C.muted, fontSize: 13 },

    chart: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 150, backgroundColor: C.surface, borderRadius: 20, padding: 18, ...softShadow },
    barCol: { flex: 1, alignItems: "center", gap: 8 },
    barArea: { height: 110, justifyContent: "flex-end" },
    barFill: { width: 14, borderRadius: 7, backgroundColor: C.accent },
    barLabel: { color: C.muted, fontSize: 11 },

    emptyWrap: { alignItems: "center", gap: 10, paddingVertical: 24 },
    historyRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, ...softShadow, shadowOpacity: 0.05 },
    historyIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    historyTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
    historyDate: { color: C.muted, fontSize: 12, flex: 1 },
    historyDuration: { color: C.text, fontSize: 13, fontWeight: "600" },
    emptyText: { color: C.muted, fontSize: 14 },

    group: { backgroundColor: C.surface, borderRadius: 20, paddingHorizontal: 16, ...softShadow },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
    rowLast: { borderBottomWidth: 0 },
    rowLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
    rowIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
    rowLabel: { color: C.text, fontSize: 15 },
    stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
    stepButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.track },
    stepValue: { color: C.text, minWidth: 24, textAlign: "center", fontSize: 15, fontWeight: "600" },
    versionText: { color: C.muted, fontSize: 12, textAlign: "center", marginTop: 4 },
    groupLabel: { color: C.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1, marginLeft: 4, marginBottom: -8 },
    trackWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    trackChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 18, backgroundColor: C.surface, ...softShadow, shadowOpacity: 0.05 },
    trackChipActive: { backgroundColor: C.accent },
    trackChipText: { color: C.muted, fontSize: 13, fontWeight: "600" },
    trackChipTextActive: { color: "#FFFFFF" }
  });
}
