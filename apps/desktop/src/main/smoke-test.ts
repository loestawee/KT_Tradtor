import { app, type BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";

// KT: `KT_SMOKE_TEST=1` turns a packaged build into a self-check for CI.
// The app must load the renderer and render the start screen in both
// languages, then it exits 0; any failure or a 90 s timeout exits 1.
export function runSmokeTestIfRequested(win: BrowserWindow): void {
  if (process.env.KT_SMOKE_TEST !== "1") return;
  // GUI builds on Windows have no console, so the verdict is also written to a file.
  const report = (line: string) => {
    console.log(line);
    if (process.env.KT_SMOKE_OUT) writeFileSync(process.env.KT_SMOKE_OUT, line + "\n");
  };
  const fail = (reason: string) => {
    report(`[kt-smoke] FAIL ${reason}`);
    app.exit(1);
  };
  const timer = setTimeout(() => fail("timeout"), 90_000);
  win.webContents.once("did-fail-load", (_e, code, desc) => fail(`did-fail-load ${code} ${desc}`));
  win.webContents.once("render-process-gone", (_e, details) => fail(`renderer gone: ${details.reason}`));
  win.webContents.once("did-finish-load", async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const radio = (id) => [...document.querySelectorAll('[role=radio]')].find((b) => b.textContent === id);
        for (let i = 0; i < 60 && !radio("TH"); i++) await wait(500);
        if (!radio("TH")) return { ok: false, reason: "language switch not rendered" };
        radio("TH").click(); await wait(300);
        const th = document.body.innerText.includes("โปรเจกต์ใหม่");
        radio("EN").click(); await wait(300);
        const en = document.body.innerText.includes("New Project");
        return { ok: th && en, th, en, title: document.title,
          webcodecs: typeof VideoEncoder === "function" };
      })()`);
      report(`[kt-smoke] ${JSON.stringify(result)}`);
      clearTimeout(timer);
      app.exit(result?.ok ? 0 : 1);
    } catch (error) {
      fail(String(error));
    }
  });
}
