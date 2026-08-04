const assert = require("assert");
const { APP_PROTOCOL, parseDeepLink, getDeepLinkFromArgv } = require("../src/main/app/deepLinkParse");

function ok(url, id) {
  const p = parseDeepLink(url);
  assert.ok(p, `expected parse: ${url}`);
  assert.strictEqual(p.conversationId, id);
}

function bad(url) {
  assert.strictEqual(parseDeepLink(url), null, `expected reject: ${url}`);
}

const p = `${APP_PROTOCOL}://`;
ok(`${p}conversation/abc-123`, "abc-123");
ok(`${p}chat/deadbeef`, "deadbeef");
ok(`${p}c/x1`, "x1");
ok(`${p}//conversation/uuid-here`, "uuid-here");
ok(`${p}open?conversation=conv1`, "conv1");
ok(`${p}open?id=conv2`, "conv2");

bad("");
bad("https://example.com/conversation/x");
bad(`${p}conversation/`);
bad(`${p}conversation/../etc/passwd`);
bad(`${p}evil.com/conversation/x`);
bad(`${p}conversation/has spaces`);

assert.strictEqual(
  getDeepLinkFromArgv(["electron", ".", `${p}chat/z9`]),
  `${p}chat/z9`
);
assert.strictEqual(getDeepLinkFromArgv(["electron", "."]), null);

console.log(`protocol deep-link parse (${APP_PROTOCOL}): ok`);
