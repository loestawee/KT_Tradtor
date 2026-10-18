import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from "electron";

export interface MenuNode {
  label: string;
  accelerator?: string;
  role?: string;
  // When set, the item dispatches this id to the renderer (via onAction) instead
  // of using a native Electron role. Used for app-level actions (undo/redo/file).
  actionId?: string;
  submenu?: MenuNode[];
}

export type MenuLocale = "en" | "th";

// KT: Thai labels for the native menu bar, keyed by the English label.
const MENU_TH: Record<string, string> = {
  "KT Tadtor": "KT ตัดต่อ",
  "About KT Tadtor": "เกี่ยวกับ KT ตัดต่อ",
  "Settings…": "การตั้งค่า…",
  Quit: "ออก",
  File: "ไฟล์",
  "New Project": "โปรเจกต์ใหม่",
  "Open…": "เปิด…",
  "Export…": "ส่งออก…",
  Edit: "แก้ไข",
  Undo: "เลิกทำ",
  Redo: "ทำซ้ำ",
  Cut: "ตัด",
  Copy: "คัดลอก",
  Paste: "วาง",
  View: "มุมมอง",
  Reload: "โหลดใหม่",
  "Force Reload": "บังคับโหลดใหม่",
  "Toggle Developer Tools": "เครื่องมือนักพัฒนา",
  "Toggle Full Screen": "เต็มจอ",
  Window: "หน้าต่าง",
  Minimize: "ย่อหน้าต่าง",
  Close: "ปิด",
  Help: "ช่วยเหลือ",
  "KT Tadtor Help": "วิธีใช้ KT ตัดต่อ",
  "Open Source Licenses": "สัญญาอนุญาตโอเพนซอร์ส",
};

/** Picks the menu language from the OS preferred languages (Thai first wins). */
export function menuLocaleFrom(languages: readonly string[]): MenuLocale {
  const first = languages.find((l) => /^(th|en)\b/i.test(l));
  return first?.toLowerCase().startsWith("th") ? "th" : "en";
}

function localize(nodes: MenuNode[], locale: MenuLocale): MenuNode[] {
  if (locale === "en") return nodes;
  return nodes.map((node) => ({
    ...node,
    // Items without an actionId report their English label back to onAction.
    actionId: node.actionId ?? (node.role ? undefined : node.label),
    label: MENU_TH[node.label] ?? node.label,
    submenu: node.submenu && localize(node.submenu, locale),
  }));
}

export function buildMenuTemplate(platform: string, locale: MenuLocale = "en"): MenuNode[] {
  return localize(buildEnglishTemplate(platform), locale);
}

function buildEnglishTemplate(platform: string): MenuNode[] {
  const isMac = platform === "darwin";
  const template: MenuNode[] = [];
  if (isMac) {
    template.push({
      label: "KT Tadtor",
      submenu: [
        { label: "About KT Tadtor", role: "about" },
        { label: "Settings…", accelerator: "Cmd+,", actionId: "settings" },
        { label: "Quit", role: "quit", accelerator: "Cmd+Q" },
      ],
    });
  }
  template.push({
    label: "File",
    submenu: [
      { label: "New Project", accelerator: "CmdOrCtrl+N", actionId: "newProject" },
      { label: "Open…", accelerator: "CmdOrCtrl+O", actionId: "open" },
      { label: "Export…", accelerator: "CmdOrCtrl+E", actionId: "export" },
    ],
  });
  template.push({
    label: "Edit",
    submenu: [
      { label: "Undo", accelerator: "CmdOrCtrl+Z", actionId: "undo" },
      { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", actionId: "redo" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      ...(!isMac
        ? [{ label: "Settings…", accelerator: "Ctrl+,", actionId: "settings" }]
        : []),
    ],
  });
  template.push({
    label: "View",
    submenu: [
      { label: "Reload", role: "reload", accelerator: "CmdOrCtrl+R" },
      { label: "Force Reload", role: "forceReload", accelerator: "Shift+CmdOrCtrl+R" },
      {
        label: "Toggle Developer Tools",
        role: "toggleDevTools",
        accelerator: "Alt+CmdOrCtrl+I",
      },
      { label: "Toggle Full Screen", role: "togglefullscreen" },
    ],
  });
  template.push({
    label: "Window",
    submenu: [
      { label: "Minimize", role: "minimize" },
      { label: "Close", role: "close" },
    ],
  });
  template.push({
    label: "Help",
    submenu: [
      { label: "KT Tadtor Help" },
      { label: "Open Source Licenses", actionId: "openLicenses" },
    ],
  });
  return template;
}

export function installApplicationMenu(
  platform: string,
  onAction: (id: string) => void,
  locale: MenuLocale = "en",
): void {
  const toElectron = (node: MenuNode): MenuItemConstructorOptions => ({
    label: node.label,
    accelerator: node.accelerator,
    role: node.actionId
      ? undefined
      : (node.role as MenuItemConstructorOptions["role"]),
    submenu: node.submenu?.map(toElectron),
    click: node.actionId
      ? () => onAction(node.actionId as string)
      : node.role
        ? undefined
        : () => onAction(node.label),
  });
  const template = buildMenuTemplate(platform, locale).map(toElectron);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function sendMenuAction(win: BrowserWindow | null, id: string): void {
  if (win) win.webContents.send("openreel:menu:action", id);
}
