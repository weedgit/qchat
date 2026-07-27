import { test, expect } from "@playwright/test";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function injectSession(page: import("@playwright/test").Page) {
  const cap = await page.request.get(`${API}/v1/auth/captcha`);
  const capBody = await cap.json();
  const loginRes = await page.request.post(`${API}/v1/auth/login`, {
    data: {
      phone: "13800000002",
      password: "user12345",
      captcha_id: capBody.captcha_id,
      captcha: capBody.dev_answer,
      device_type: "web",
      device_name: "playwright",
      remember_me: true,
    },
  });
  expect(loginRes.ok()).toBeTruthy();
  const tokens = await loginRes.json();
  await page.goto("/login");
  await page.evaluate(
    ({ access, refresh }) => {
      localStorage.setItem("qchat.access_token", access);
      localStorage.setItem("qchat.refresh_token", refresh);
      localStorage.setItem("qchat.remember", "1");
      // Force English so selectors match packages/i18n English strings.
      localStorage.setItem("qchat.locale", "en");
    },
    { access: tokens.access_token, refresh: tokens.refresh_token }
  );
}

test.describe("Qchat core flows", () => {
  test.beforeAll(async () => {
    if (process.env.PLAYWRIGHT_SKIP === "1") {
      test.skip(true, "PLAYWRIGHT_SKIP=1");
    }
  });

  test("login session opens chats", async ({ page }) => {
    const health = await page.request.get(`${API}/healthz`);
    expect(health.ok()).toBeTruthy();
    await injectSession(page);
    await page.goto("/");
    await expect(page.locator(".shell")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
  });

  test("contacts page supports search UI", async ({ page }) => {
    await injectSession(page);
    await page.goto("/friends");
    await expect(page.getByRole("dialog", { name: "Contacts" })).toBeVisible();
    await expect(page.locator("h1", { hasText: "Contacts" })).toBeVisible();
    await expect(
      page.getByPlaceholder(/Search by username, phone, or user ID/i)
    ).toBeVisible();
  });

  test("groups page loads", async ({ page }) => {
    await injectSession(page);
    await page.goto("/groups");
    await expect(page.getByRole("dialog", { name: "Groups" })).toBeVisible();
    await expect(page.locator("h1", { hasText: "Groups" })).toBeVisible();
    await expect(page.getByPlaceholder(/Group title/i)).toBeVisible();
  });

  test("profile shows phone change flow", async ({ page }) => {
    await injectSession(page);
    await page.goto("/profile");
    await expect(page.getByRole("dialog", { name: /profile/i })).toBeVisible();
    await expect(page.locator("h1", { hasText: "Edit Profile" })).toBeVisible();
    await expect(page.getByText("Change phone number")).toBeVisible();
  });
});
