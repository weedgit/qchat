/**
 * Pure-logic checks for SHELL-22 context menu helpers (no Electron runtime).
 */
const {
  shouldShowMenu,
  emailFromMailto,
  CUSTOM_CTX_SELECTOR,
} = require("../src/main/native/contextMenuLogic");

function assert(cond, msg) {
  if (!cond) {
    console.error("context-menu check failed:", msg);
    process.exit(1);
  }
}

assert(
  !shouldShowMenu({
    mediaType: "none",
    linkURL: "",
    pageURL: "https://example.com/chat",
    srcURL: "",
    misspelledWord: "",
    selectionText: "",
    isEditable: false,
  }),
  "empty / button click must not show menu (preserve web chat menus)"
);

assert(
  !shouldShowMenu({
    mediaType: "none",
    linkURL: "https://example.com/chat#",
    pageURL: "https://example.com/chat",
    srcURL: "",
    misspelledWord: "",
    selectionText: "",
    isEditable: false,
  }),
  "internal hash link must not show menu"
);

assert(
  shouldShowMenu({
    mediaType: "none",
    linkURL: "",
    pageURL: "https://example.com/chat",
    srcURL: "",
    misspelledWord: "",
    selectionText: "",
    isEditable: true,
  }),
  "editable fields must show menu"
);

assert(
  shouldShowMenu({
    mediaType: "none",
    linkURL: "",
    pageURL: "https://example.com/chat",
    srcURL: "",
    misspelledWord: "",
    selectionText: "hello",
    isEditable: false,
  }),
  "text selection must show menu"
);

assert(
  shouldShowMenu({
    mediaType: "image",
    linkURL: "",
    pageURL: "https://example.com/chat",
    srcURL: "https://example.com/a.png",
    misspelledWord: "",
    selectionText: "",
    isEditable: false,
  }),
  "images must show menu"
);

assert(
  shouldShowMenu({
    mediaType: "none",
    linkURL: "https://other.example/x",
    pageURL: "https://example.com/chat",
    srcURL: "",
    misspelledWord: "",
    selectionText: "",
    isEditable: false,
  }),
  "external links must show menu"
);

assert(emailFromMailto("mailto:dev@qchat.local") === "dev@qchat.local", "mailto");
assert(
  emailFromMailto("mailto:dev@qchat.local?subject=Hi") === "dev@qchat.local",
  "mailto with query"
);
assert(emailFromMailto("https://example.com") === null, "non-mailto");

assert(
  CUSTOM_CTX_SELECTOR.includes(".msg-row") &&
    CUSTOM_CTX_SELECTOR.includes(".conv-item") &&
    CUSTOM_CTX_SELECTOR.includes(".ctx-menu"),
  "custom chat UI selector must cover message / conversation menus"
);

console.log("context-menu helpers: ok");
