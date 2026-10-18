import { describe, it, expect } from "vitest";
import { buildMenuTemplate, menuLocaleFrom } from "../src/main/app-menu";

describe("buildMenuTemplate", () => {
  it("includes the app menu first on mac and not on others", () => {
    const mac = buildMenuTemplate("darwin");
    expect(mac[0].label).toBe("KT Tadtor");
    const win = buildMenuTemplate("win32");
    expect(win[0].label).toBe("File");
  });
  it("has File/Edit/View/Window/Help groups", () => {
    const labels = buildMenuTemplate("win32").map((m) => m.label);
    for (const l of ["File", "Edit", "View", "Window", "Help"]) expect(labels).toContain(l);
  });
  it("File>New uses CmdOrCtrl+N", () => {
    const file = buildMenuTemplate("win32").find((m) => m.label === "File");
    const item = file?.submenu?.find((s) => s.label === "New Project");
    expect(item?.accelerator).toBe("CmdOrCtrl+N");
  });
  it("exposes settings with the platform shortcut", () => {
    const macApp = buildMenuTemplate("darwin")[0];
    expect(macApp.submenu?.find((item) => item.actionId === "settings")?.accelerator)
      .toBe("Cmd+,");

    const windowsEdit = buildMenuTemplate("win32").find(
      (menu) => menu.label === "Edit",
    );
    expect(
      windowsEdit?.submenu?.find((item) => item.actionId === "settings")
        ?.accelerator,
    ).toBe("Ctrl+,");
  });
  it("translates labels to Thai but keeps shortcuts and actions", () => {
    const file = buildMenuTemplate("win32", "th").find((m) => m.label === "ไฟล์");
    const item = file?.submenu?.find((s) => s.actionId === "newProject");
    expect(item?.label).toBe("โปรเจกต์ใหม่");
    expect(item?.accelerator).toBe("CmdOrCtrl+N");
    expect(buildMenuTemplate("darwin", "th")[0].label).toBe("KT ตัดต่อ");
  });
  it("picks the menu language from the OS languages", () => {
    expect(menuLocaleFrom(["th-TH", "en-US"])).toBe("th");
    expect(menuLocaleFrom(["en-GB", "th-TH"])).toBe("en");
    expect(menuLocaleFrom(["ja-JP"])).toBe("en");
  });
});
