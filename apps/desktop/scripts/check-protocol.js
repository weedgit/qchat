const assert = require("assert");
const { parseDeepLink, getDeepLinkFromArgv } = require("../src/main/app/deepLinkParse");

function ok(url, id) {
  const p = parseDeepLink(url);
  assert.ok(p, `expected parse: ${url}`);
  assert.strictEqual(p.conversationId, id);
}

function bad(url) {
  assert.strictEqual(parseDeepLink(url), null, `expected reject: ${url}`);
}

ok("qchat://conversation/abc-123", "abc-123");
ok("qchat://chat/deadbeef", "deadbeef");
ok("qchat://c/x1", "x1");
ok("qchat:///conversation/uuid-here", "uuid-here");
ok("qchat://open?conversation=conv1", "conv1");
ok("qchat://open?id=conv2", "conv2");

bad("");
bad("https://example.com/conversation/x");
bad("qchat://conversation/");
bad("qchat://conversation/../etc/passwd");
bad("qchat://evil.com/conversation/x");
bad("qchat://conversation/has spaces");

assert.strictEqual(
  getDeepLinkFromArgv(["electron", ".", "qchat://chat/z9"]),
  "qchat://chat/z9"
);
assert.strictEqual(getDeepLinkFromArgv(["electron", "."]), null);

console.log("protocol deep-link parse: ok");
