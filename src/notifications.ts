import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

// In Expo Go (SDK 53+), expo-notifications is not fully supported and importing
// it logs warnings. We detect Expo Go and never touch the module there, so the
// app runs clean. Notifications work fully in a development/standalone build.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const notificationsSupported = !isExpoGo;

// Lazily require the module only when supported, so Expo Go never loads it.
type NotificationsModule = typeof import("expo-notifications");
let cached: NotificationsModule | null = null;
function getNotifications(): NotificationsModule | null {
  if (isExpoGo) return null;
  if (!cached) {
    cached = require("expo-notifications") as NotificationsModule;
  }
  return cached;
}

export async function configureNotifications() {
  const N = getNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true
      })
    });

    if (Platform.OS === "android") {
      await N.setNotificationChannelAsync("pomodoro-timer", {
        name: "Pomov Timer",
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: "default"
      });
    }

    const permissions = await N.getPermissionsAsync();
    if (!permissions.granted) {
      await N.requestPermissionsAsync();
    }
  } catch {
    // Ignore: notifications are optional.
  }
}

export async function scheduleCompletionNotification(seconds: number, title: string, body: string) {
  const N = getNotifications();
  if (!N || seconds <= 0) return null;
  try {
    await N.cancelAllScheduledNotificationsAsync();
    return await N.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
        ...(Platform.OS === "android" ? { channelId: "pomodoro-timer" } : {})
      },
      trigger: {
        type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        ...(Platform.OS === "android" ? { channelId: "pomodoro-timer" } : {})
      }
    });
  } catch {
    return null;
  }
}

export async function cancelTimerNotification() {
  const N = getNotifications();
  if (!N) return;
  try {
    await N.cancelAllScheduledNotificationsAsync();
  } catch {
    // Ignore.
  }
}
