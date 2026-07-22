import { registerGlobals } from "@livekit/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/context/AuthContext";
import { CallProvider } from "../src/context/CallContext";
import { ChatProvider } from "../src/context/ChatContext";
import { colors } from "../src/theme";

// Required before any LiveKit Room / WebRTC usage.
registerGlobals();

export default function RootLayout() {
  return (
    <AuthProvider>
      <ChatProvider>
        <CallProvider>
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
          </Stack>
        </CallProvider>
      </ChatProvider>
    </AuthProvider>
  );
}
