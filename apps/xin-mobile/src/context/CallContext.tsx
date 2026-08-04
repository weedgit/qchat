import React, { createContext, useContext } from "react";
import { CallOverlay } from "../components/CallOverlay";
import { useCall } from "../lib/useCall";
import { useAuth } from "./AuthContext";
import { useChat } from "./ChatContext";

type CallApi = ReturnType<typeof useCall>;

const CallContext = createContext<CallApi | null>(null);

/** App-wide call signaling + overlay so incoming rings work on any screen. */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { subscribeEvents } = useChat();
  const call = useCall({ meId: user?.id, subscribe: subscribeEvents });

  return (
    <CallContext.Provider value={call}>
      {children}
      <CallOverlay call={call} />
    </CallContext.Provider>
  );
}

export function useCallApi() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCallApi outside CallProvider");
  return ctx;
}
