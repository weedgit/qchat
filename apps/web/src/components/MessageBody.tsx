"use client";

import type { ReactNode } from "react";

/**
 * Lightweight text formatting:
 * bold, italic, code, autolink, and @mentions.
 */
export function formatMessageText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|https?:\/\/[^\s<]+|@[a-zA-Z0-9_]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code key={key++} className="md-code">
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={key++}>{token.slice(2, -2)}</strong>
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("http://") || token.startsWith("https://")) {
      const href = token.replace(/[.,)]+$/, "");
      const trailing = token.slice(href.length);
      nodes.push(
        <a key={key++} className="md-link" href={href} target="_blank" rel="noreferrer">
          {href}
        </a>
      );
      if (trailing) nodes.push(<span key={key++}>{trailing}</span>);
    } else if (token.startsWith("@")) {
      nodes.push(
        <span key={key++} className="mention">
          {token}
        </span>
      );
    } else {
      nodes.push(<span key={key++}>{token}</span>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);
  return nodes;
}

export default function MessageBody({ text }: { text: string }) {
  return <>{formatMessageText(text)}</>;
}

/** Composer mirror: only color @mentions; keep the rest plain for caret sync. */
export function formatComposerMentions(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /@[a-zA-Z0-9_]+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(<span key={key++}>{text.slice(last, match.index)}</span>);
    }
    nodes.push(
      <span key={key++} className="mention">
        {match[0]}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(<span key={key++}>{text.slice(last)}</span>);
  // Preserve trailing newline height so the mirror matches the textarea.
  if (text.endsWith("\n")) nodes.push(<br key={key++} />);
  return nodes;
}
