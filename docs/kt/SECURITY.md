# KT ตัดต่อ — สรุปความปลอดภัย (ตรวจ 18–19/10/2026)

## แก้แล้ว

| เรื่อง | การแก้ | ที่ |
|---|---|---|
| Electron 33 หมดอายุ | อัปเป็น **Electron 44.9** (Chromium 152), electron-builder 26, electron-updater 6.8 | `apps/desktop/package.json` |
| renderer อ่าน/เขียนไฟล์ได้ทุกที่ผ่าน fs IPC | อนุญาตเฉพาะ path ที่ผู้ใช้เลือกใน Save/Open dialog หรือไฟล์ temp ที่ main สร้าง (`PathGrants`, จำข้ามการเปิดแอปได้) — ครอบ readFile, readFileBytes, writeFile, openWrite และ outputPath ของ rigging | `apps/desktop/src/main/ipc/path-grants.ts`, `ipc/fs.ts` |
| แพ็กเกจมีช่องโหว่ 1 critical / 15 high | pnpm overrides → เหลือ 3 high (sharp ฝั่ง Node เท่านั้น ไม่ถูกแจกจ่าย) | `pnpm-workspace.yaml` |
| Android ส่งไฟล์ส่วนตัวของแอปลงแกลเลอรีได้ | จำกัดไว้ใน `cache/exports/`, เฉพาะ video/audio, ทำความสะอาดชื่อไฟล์ | `KtMediaPlugin.java` |
| Android backup / FileProvider กว้างเกิน | `allowBackup=false`, แชร์ได้แค่ `cache/exports/` | `AndroidManifest.xml`, `file_paths.xml` |
| อัปเดตอัตโนมัติทั้งที่ build ไม่ได้ sign | ปิดไว้ (`KT_UPDATES_ENABLED = false`) | `main/updater.ts` |
| AI ใช้คำสั่งลบ/ส่งออกได้โดยไม่ถาม | ค่าเริ่มต้นต้องยืนยัน (เปิดเองได้ที่ การตั้งค่า → MCP) | `settings-store.ts` v8 |
| token MCP มีช่วงที่สิทธิ์ไฟล์หลวม | dir 0700 + เขียนไฟล์ใหม่ 0600 แล้ว rename | `main/mcp/server.ts` |
| `kt-tadtor setup` บน Windows | ใช้ `claude mcp add` แบบ quote ทีละค่า | `cli/setup.ts` |
| Workflow ของ upstream ใน fork สาธารณะ | ทุก job รันเฉพาะใน `Augani/openreel-video` | `.github/workflows/*` |
| CI สิทธิ์ไม่ระบุ | `permissions: contents: read` | `kt-platforms.yml` |
| Cloudflare → origin ไม่เข้ารหัส | Configuration Rule **SSL = Full (strict)** เฉพาะ `kt-tadtor.officebk.co`; origin :80 ตอบแค่ ACME + redirect | Cloudflare (บัญชี Dosod.dev) + `deploy/kt-web/*.conf` |
| Motion expressions รัน JavaScript จากไฟล์โปรเจกต์ได้ (`new Function`) | เปลี่ยนเป็นตัวแปลภาษาในกล่อง (sandbox) เขียนเอง: เข้าถึงได้แค่ค่าที่แอปให้, เรียกได้แค่ฟังก์ชันของแอป/`Math`, ห้าม `constructor`/`__proto__`/globals, จำกัดจำนวนขั้น (กัน loop ไม่รู้จบ) — ไวยากรณ์เดิม (`value + 10`, `const a = …; return a`, `thisComp.layer(…)`, `wiggle`, `loopOut`) ใช้ได้เหมือนเดิม | `packages/core/src/motion/safe-expression.ts` |
| ไม่มี CSP / Permissions-Policy | ผ่านรอบ Report-Only แล้วบังคับใช้จริง ทดสอบนำเข้า/ส่งออก/worker บน production แล้ว | `deploy/kt-web/kt-tadtor-headers.inc` |

## ยังค้าง / ยอมรับความเสี่ยง

- **ยังไม่ได้ code-sign** (Windows Authenticode, Apple Developer ID) — เปิด auto-update ได้เมื่อ sign แล้ว
- `sharp` < 0.35 (high) มากับ `@huggingface/transformers` ใช้ฝั่ง Node เท่านั้น
- CSP ไม่ต้องใช้ `'unsafe-eval'` แล้ว (ต้อง deploy พร้อม build ที่มี safe-expression) แต่ยังต้องมี `connect-src https:` เพราะ AI แบบ OpenAI-compatible ต่อ endpoint ใดก็ได้
- Electron fuse `RunAsNode` เปิดอยู่เพราะ CLI `kt-tadtor` ใช้ `ELECTRON_RUN_AS_NODE`
- โปรเจกต์ใน "ล่าสุด" ที่บันทึกก่อนมี PathGrants ต้องเปิดผ่านหน้าต่างเลือกไฟล์อีกครั้งหนึ่งครั้ง

## ย้อนกลับ (ถ้าจำเป็น)

- CSP: `sudo cp -p /etc/nginx/kt-tadtor-headers.inc.before-csp-20261018 /etc/nginx/kt-tadtor-headers.inc && sudo systemctl reload nginx`
- :80 redirect-only: `sudo cp -p /etc/nginx/kt-tadtor.conf.before-strict-20261018 /etc/nginx/conf.d/kt-tadtor.officebk.co.conf` (และลบ Configuration Rule ใน Cloudflare ถ้าย้อนทั้งหมด)
