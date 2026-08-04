"use client";

import { useEffect, useState } from "react";
import { api, asList } from "@/lib/api";

export type SearchHitMessage = {
  id: string;
  conversationId: string;
  body: string;
  createdAt: string;
};

export type SearchHitUser = {
  id: string;
  username: string;
  displayName: string;
};

/** search results via GET /v1/search. */
export function useGlobalSearch(query: string, conversationId?: string | null) {
  const [messages, setMessages] = useState<SearchHitMessage[]>([]);
  const [users, setUsers] = useState<SearchHitUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMessages([]);
      setUsers([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      const params = new URLSearchParams({ q });
      if (conversationId) params.set("conversation_id", conversationId);
      api<any>(`/v1/search?${params}`)
        .then((body) => {
          if (cancelled) return;
          setMessages(
            asList(body, "messages").map((m: any) => ({
              id: String(m?.id ?? ""),
              conversationId: String(m?.conversation_id ?? ""),
              body: String(m?.body ?? ""),
              createdAt: String(m?.created_at ?? ""),
            }))
          );
          setUsers(
            asList(body, "users").map((u: any) => ({
              id: String(u?.id ?? ""),
              username: String(u?.username ?? ""),
              displayName: String(u?.display_name ?? u?.username ?? ""),
            }))
          );
        })
        .catch(() => {
          if (!cancelled) {
            setMessages([]);
            setUsers([]);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, conversationId]);

  return { messages, users, loading, active: query.trim().length >= 2 };
}
