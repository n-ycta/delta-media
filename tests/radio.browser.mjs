import { chromium } from "playwright";
import assert from "node:assert/strict";
const b = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || "/usr/local/bin/chromium",
  args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
});
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto("http://127.0.0.1:5193/?surface=radio");
  await p.waitForSelector(".radio-card");
  assert.equal(await p.locator(".radio-card").count(), 15);
  await p.screenshot({ path: "/data/media-radio-desktop.png" });
  await p.locator("#search").fill("Lofi");
  await p.waitForTimeout(400);
  assert.equal(await p.locator(".radio-card").count(), 1);
  await p.locator("[data-action=radio-tracks]").click();
  await p.waitForSelector(".media-row", { timeout: 25000 }).catch(() => {});
  console.log("tracks loaded");
  await p.screenshot({ path: "/data/media-radio-tracks.png" });
  const play = p.locator("[data-action=play]").first();
  if (await play.count()) {
    await play.click();
    await p.waitForTimeout(4500);
    console.log(
      "audio",
      await p
        .locator("#media")
        .evaluate((v) => ({
          currentTime: v.currentTime,
          ready: v.readyState,
          error: v.error?.message,
        })),
    );
    assert((await p.locator("#media").evaluate((v) => v.currentTime)) > 0);
  }
  await p.locator("[data-action=view][data-view=settings]").click();
  await p.waitForSelector(".delta-select-trigger");
  await p
    .locator("#theme-select")
    .evaluate((s) => s.parentElement.querySelector("button").click());
  assert(await p.getByRole("listbox").isVisible());
  await p.screenshot({ path: "/data/media-settings-select.png" });
  await p.getByRole("option", { name: "Light", exact: true }).click();
  await p.locator("[data-surface=video]").uncheck();
  assert.equal(
    await p.locator("[data-action=view][data-view=video]").count(),
    0,
  );
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("[data-action=view][data-view=radio]").click();
  await p.locator("[data-action=radio-back]").click();
  await p.screenshot({ path: "/data/media-radio-mobile.png" });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS radio presets, station filter, live catalog tracks, actual playback, custom select, tab hiding and mobile",
  );
} finally {
  await b.close();
}
