import { registerGlobals } from "@livekit/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/context/AuthContext";
import { CallProvider } from "../src/context/CallContext";
import { ChatProvider } from "../src/context/ChatContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

// Required before any LiveKit Room / WebRTC usage.
registerGlobals();

function RootNavigator() {
  const { colors } = useTheme();
  return (
    <>
      {/* Headers use headerBlue; keep light icons (Mattermost-style). */}
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
        <Stack.Screen name="chat/[id]" options={{ title: "Chat" }} />
        <Stack.Screen name="chat-info/[id]" options={{ title: "Chat info" }} />
        <Stack.Screen name="user/[id]" options={{ title: "User info" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ChatProvider>
          <CallProvider>
            <RootNavigator />
          </CallProvider>
        </ChatProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
