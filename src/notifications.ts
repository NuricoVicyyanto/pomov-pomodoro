import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export async function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true
    })
  });

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("pomodoro-timer", {
      name: "Pomov Timer",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default"
    });
  }

  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    await Notifications.requestPermissionsAsync();
  }
}

export async function scheduleCompletionNotification(seconds: number, title: string, body: string) {
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (seconds <= 0) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: "default",
      ...(Platform.OS === "android" ? { channelId: "pomodoro-timer" } : {})
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.max(1, Math.round(seconds)),
      ...(Platform.OS === "android" ? { channelId: "pomodoro-timer" } : {})
    }
  });
}

export async function cancelTimerNotification() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
