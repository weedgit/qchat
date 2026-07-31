import { registerGlobals } from "@livekit/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/context/AuthContext";
import { CallProvider } from "../src/context/CallContext";
import { ChatProvider } from "../src/context/ChatContext";
import { LocaleProvider, useLocale } from "../src/context/LocaleContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

// Required before any LiveKit Room / WebRTC usage.
registerGlobals();

function RootNavigator() {
  const { colors } = useTheme();
  const { t } = useLocale();
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.headerBlue },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: t("nav.chats") }} />
        <Stack.Screen name="chat-info/[id]" options={{ title: t("menu.settings") }} />
        <Stack.Screen name="join-group" options={{ title: "Scan QR" }} />
        <Stack.Screen name="create-group" options={{ title: "New group" }} />
        <Stack.Screen name="user/[id]" options={{ title: t("nav.me") }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <AuthProvider>
          <ChatProvider>
            <CallProvider>
              <RootNavigator />
            </CallProvider>
          </ChatProvider>
        </AuthProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
