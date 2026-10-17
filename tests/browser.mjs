import { chromium } from "playwright";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const output = process.env.DELTA_TEST_OUTPUT || os.tmpdir();
const root = path.resolve("dist");
const server = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const p = path.resolve(root, "." + (rel === "/" ? "/index.html" : rel));
    if (!p.startsWith(root + path.sep)) throw Error();
    const data = await fs.readFile(
      rel === "/tone.wav" ? path.resolve("tests/fixtures/tone.wav") : p,
    );
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".wav": "audio/wav",
        ".webm": "video/webm",
      }[path.extname(p)] || "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  args: ["--no-sandbox"],
});
const results = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "dark",
    }),
    page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("heading", { name: "Empty" }).waitFor();
  await page.screenshot({
    path: path.join(output, "delta-media-empty-desktop.png"),
    fullPage: false,
  });
  await page.locator("#files").setInputFiles("tests/fixtures/tone.wav");
  await page.getByRole("button", { name: "tone —", exact: false }).waitFor();
  await page.locator(".art[data-action=play]").first().click();
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.5,
  );
  assert.equal(await page.locator("#toggle svg").count(), 1);
  results.push("Local WAV: actual decoder playback");
  await page.locator("#seek").fill("6");
  await page.waitForFunction(
    () => document.querySelector("video").currentTime >= 6,
  );
  await page.locator("#toggle").click();
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v && v.readyState >= 1 && v.currentTime >= 6;
  });
  results.push("Progress restored after full page reload, without autoplay");
  await page.locator("[data-action=view][data-view=library]").click();
  await page.locator("[data-action=favorite]").click();
  await page.locator("[data-action=view][data-view=favorites]").click();
  assert.equal(await page.locator(".media-row").count(), 1);
  await page.locator('[data-action=details]').click();
  await page.locator("input[name=artist]").fill("Aster");
  await page.locator("input[name=album]").fill("Night field");
  await page
    .locator("textarea[name=chapters]")
    .fill("0 | Opening\n6 | Second chapter");
  await page
    .locator("textarea[name=lyrics]")
    .fill("[00:00]Opening\n[00:06]Second line");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  results.push("Editable metadata, LRC and chapters persisted");
  await page.locator("[data-action=view][data-view=artists]").click();
  await page.getByRole("button", { name: "Aster", exact: false }).click();
  assert.equal(await page.locator(".media-row").count(), 1);
  await page.locator("[data-action=view][data-view=albums]").click();
  await page.getByRole("button", { name: "Night field", exact: false }).click();
  assert.equal(await page.locator(".media-row").count(), 1);
  results.push("Artist and album pages resolve actual library entries");
  await page.locator("[data-action=view][data-view=playlists]").click();
  await page.locator("[data-action=new-playlist]").click();
  await page.locator("#playlist-form input[name=name]").fill("Aster favorites");
  await page.locator("#playlist-form input[name=smart]").check();
  await page.locator("#playlist-form input[name=query]").fill("Aster");
  await page.locator("#playlist-form input[name=favorite]").check();
  await page.locator("#playlist-form").getByRole("button", { name: "Create", exact: true }).click();
  assert.equal(await page.locator(".media-row").count(), 1);
  results.push("Smart playlist computes favorites from saved metadata");
  await page.locator("[data-action=view][data-view=library]").click();

  const feed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test feed</title><item><guid>one</guid><title>Test episode</title><enclosure url="${origin}/tone.wav" type="audio/wav"/></item><item><title>Unsafe</title><enclosure url="javascript:alert(1)"/></item></channel></rss>`;
  await page.locator("#files").setInputFiles({
    name: "feed.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(feed),
  });
  await page.getByText("Test episode", { exact: true }).waitFor();
  assert.equal(await page.locator(".media-row").count(), 2);
  results.push("RSS enclosure parsed; unsafe source excluded");
  await page
    .locator('[data-action=play][aria-label="Play Test episode"]')
    .click();
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.3,
  );
  results.push("RSS enclosure: real HTTP audio playback");

  await page.locator("#files").setInputFiles("tests/fixtures/picture.webm");
  await page.locator('[data-action=play][aria-label="Play picture"]').click();
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return v.videoWidth > 0 && v.currentTime > 0.2;
  });
  results.push("Local WebM: actual video decoder, nonzero video dimensions");
  await page.locator('#toggle').click();
  const clipSource=await page.locator('video').getAttribute('src');
  const clipTime=await page.locator('video').evaluate(v=>v.currentTime);
  await page.locator('[data-action=video-compact]').click();
  assert.equal(await page.locator('#stage').getAttribute('data-mode'),'compact');
  await page.screenshot({path:path.join(output,'media-video-compact.png')});
  await page.locator('[data-action=video-normal]').click();
  await page.locator('.video-resize').focus();await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('#stage').evaluate(e=>e.style.getPropertyValue('--video-height')),'340px');
  await page.locator('[data-action=video-hide]').click();
  assert.equal(await page.locator('video').getAttribute('src'),clipSource);
  assert.ok(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-clipTime)<.2);
  await page.screenshot({path:path.join(output,'media-video-hidden.png')});
  await page.locator('#toggle').click();await page.waitForTimeout(250);
  assert.ok(await page.locator('video').evaluate(v=>!v.paused&&v.currentTime)>0);
  await page.locator('[data-action=video-restore]').click();
  assert.equal(await page.locator('video').getAttribute('src'),clipSource);
  results.push('Video compact/resize/hide/restore preserves the decoder and playback');

  await page.locator("[data-action=view][data-view=library]").click();
  await page.locator('[data-action=play][aria-label="Play tone"]').click();
  await page.waitForFunction(
    () => document.querySelector("video").currentTime > 0.2,
  );
  await context.setOffline(true);
  await page.waitForTimeout(250);
  assert.equal(await page.locator("video").evaluate((v) => v.paused), false);
  await page.locator("#toggle").click();
  await context.setOffline(false);
  results.push("Imported local audio plays without network");
  await page.screenshot({
    path: path.join(output, "delta-media-library-desktop.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(output, "delta-media-library-mobile.png"),
    fullPage: false,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator("header [data-action=import]").click();
  await page.screenshot({
    path: path.join(output, "delta-media-import-mobile.png"),
    fullPage: false,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator("[data-action=close]").click();
  results.push("390px layout and import dialog: no horizontal overflow");
  const secondary=await context.newPage();
  await secondary.goto(origin+'/?surface=player&chrome=0');
  await secondary.locator('#toggle').waitFor();
  await page.locator('#toggle').click();
  await secondary.waitForTimeout(600);
  assert.equal(await secondary.locator('#media').evaluate(v=>v.paused),true,'secondary panel owns no decoder');
  await secondary.locator('#toggle').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#media').evaluate(v=>v.paused),true,'secondary pauses primary');
  await secondary.close();
  results.push('Simultaneous panels: one decoder owner, shared pause control');
  await page.locator('.media-row').filter({hasText:'tone'}).locator('[data-action=play]').first().click();
  const spectrum=await context.newPage();await spectrum.goto(origin+'/?surface=visualizer&chrome=0');
  await spectrum.waitForFunction(()=>{const c=document.querySelector('.visualizer canvas');return c&&Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).some((v,i)=>i%4===3&&v>0);},{},{timeout:10000});
  await spectrum.screenshot({path:path.join(output,'delta-media-actual-spectrum.png')});
  assert.equal(await spectrum.locator('footer').isVisible(),false);await spectrum.close();await page.locator('#toggle').click();
  results.push('Visualizer receives real decoded WAV spectrum; no duplicated panel footer');


  await page.locator("[data-action=view][data-view=sources]").click();
  await page.screenshot({
    path: path.join(output, "delta-media-sources-mobile.png"),
    fullPage: false,
  });
  assert.equal(await page.locator('.status').filter({hasText:'Not implemented'}).count(),0);
  assert.match(await page.locator('#provider-connections').innerText(),/Connect Delta/);
  await page.locator("[data-action=theme]").click();
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await page.screenshot({
    path: path.join(output, "delta-media-light-mobile.png"),
    fullPage: false,
  });
  await page.reload();
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === "light",
  );
  results.push("Light/dark theme toggle persists");
  assert.equal(await page.locator("header [data-action=language]").count(), 0);
  await page.locator("[data-action=view][data-view=settings]").click();
  await page.screenshot({
    path: path.join(output, "delta-media-settings-mobile.png"),
    fullPage: false,
  });
  await page.locator("#language-select").selectOption("ru");
  await page.getByRole("button", { name: "Медиатека", exact: false }).waitFor();
  results.push("Language changes only in Settings and survives restart");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Медиатека", exact: false }).waitFor();
  results.push("Cold offline restart loads the cached application shell");
  await context.setOffline(false);
  const linkContext=await browser.newContext();const linkPage=await linkContext.newPage();
  await linkPage.goto(origin);await linkPage.locator('header [data-action=import]').click();
  await linkPage.locator('#add-link input[name=url]').fill('https://youtu.be/jfKfPfyJRdk');
  await linkPage.locator('#add-link input[name=title]').fill('Provider link');
  await linkPage.locator('#add-link button[type=submit]').click();
  await linkPage.locator('.art[data-action=play]').first().click();
  await linkPage.waitForFunction(()=>document.querySelector('#embed')?.src.includes('youtube-nocookie.com/embed/jfKfPfyJRdk'));
  assert.equal(await linkPage.locator('#embed').isVisible(),true);await linkContext.close();
  results.push('Common import accepts a provider page link and opens its official embed (not proof of external audio access)');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { passed: results.length, results, pageErrors: errors },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(output, "delta-media-browser-results.json"),
    JSON.stringify(
      { passed: results.length, results, pageErrors: errors },
      null,
      2,
    ),
  );
  await context.close();
} finally {
  await browser.close();
  server.close();
}
