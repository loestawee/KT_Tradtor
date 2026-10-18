# สั่งงาน KT ตัดต่อ ด้วย AI / Command line

แอปเดสก์ท็อป (Windows / macOS / Linux) มี **MCP server** ในตัว และมีคำสั่ง `kt-tadtor`
ให้ Claude Code, Codex CLI (ChatGPT), Claude Desktop, Cursor หรือสคริปต์ใดๆ สั่งตัดต่อ
โปรเจกต์ที่เปิดอยู่ได้ (มีมากกว่า 300 คำสั่ง: นำเข้าสื่อ ตัดคลิป ใส่ข้อความ ปรับสี เสียง คีย์เฟรม ส่งออก ฯลฯ)

> ต้อง **เปิดแอป KT ตัดต่อ ค้างไว้** — แอปจะเขียนไฟล์ `~/.kt-tadtor/mcp-endpoint.json`
> (port + token แบบสุ่ม, ฟังเฉพาะ 127.0.0.1) ให้ตัวเชื่อมต่ออ่าน

## 1. เชื่อมต่อแบบกดปุ่มเดียว (แนะนำ)

ในแอป: **การตั้งค่า → MCP → เชื่อมต่อ AI** แล้วกดปุ่มของโปรแกรมที่ใช้

| ปุ่ม | สิ่งที่ทำ |
|---|---|
| Claude Code | รัน `claude mcp add-json --scope user kt-tadtor …` ให้ |
| Codex CLI (ChatGPT) | เพิ่ม `[mcp_servers.kt-tadtor]` ใน `~/.codex/config.toml` |
| Claude Desktop | เพิ่ม `mcpServers.kt-tadtor` ใน `claude_desktop_config.json` (ต้องเปิด Claude Desktop ใหม่) |
| Cursor | เพิ่มใน `~/.cursor/mcp.json` |

ไฟล์เดิมถูกสำรองไว้เป็น `*.kt-backup` ทุกครั้ง และกดซ้ำได้ (แทนที่ของเดิม ไม่ซ้ำซ้อน)

ตัวเชื่อมใช้ตัวแอปเองรันเป็น Node (`ELECTRON_RUN_AS_NODE=1`) → **ไม่ต้องติดตั้ง Node.js**

## 2. คำสั่ง `kt-tadtor`

```bash
# macOS (แอปใน /Applications)
KT="/Applications/KT Tadtor.app/Contents/MacOS/KT Tadtor"
CLI="/Applications/KT Tadtor.app/Contents/Resources/app.asar.unpacked/dist/cli/index.js"
alias kt-tadtor="ELECTRON_RUN_AS_NODE=1 \"$KT\" \"$CLI\""

# หรือถ้ามี Node.js และอยู่ใน repo:  node apps/desktop/dist/cli/index.js
```

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `kt-tadtor status` | เช็คว่าเชื่อมต่อแอปได้ และมีกี่คำสั่ง |
| `kt-tadtor tools [คำค้น] [--json]` | ดูรายชื่อคำสั่ง เช่น `kt-tadtor tools text` |
| `kt-tadtor call <tool> '<json>'` | เรียกคำสั่งตรงๆ |
| `kt-tadtor setup <claude-code\|codex\|claude-desktop\|cursor\|all> [--print]` | ลงทะเบียนกับ AI (`--print` = แค่แสดง ไม่เขียนไฟล์) |
| `kt-tadtor mcp` | ตัวเชื่อม stdio สำหรับ AI client (ไม่ต้องเรียกเอง) |

ตัวอย่าง:

```bash
kt-tadtor call create_project '{"name":"คลิปรีวิว","width":1080,"height":1920}'
kt-tadtor call create_text_clip '{"clip":{"text":"สวัสดี","startTime":0,"duration":3}}'
kt-tadtor call get_editor_state
```

Agent ที่รันคำสั่ง shell ได้ (Claude Code, Codex, ChatGPT agent ที่มี terminal) ใช้ `kt-tadtor call …` ได้ทันทีแม้ไม่ได้ตั้ง MCP

## 3. ChatGPT

- **Codex CLI** (ของ OpenAI/ChatGPT) — ใช้ปุ่ม/คำสั่ง `setup codex` ได้เลย
- **ChatGPT เว็บ/แอป** รับเฉพาะ MCP server ที่เข้าถึงได้ทางอินเทอร์เน็ต (HTTPS)
  ส่วน server ของ KT ตัดต่อ ตั้งใจเปิดเฉพาะในเครื่อง (127.0.0.1) เพื่อความปลอดภัย จึงไม่ได้รองรับโดยตรง

## 4. ความปลอดภัย

- server ฟังเฉพาะ `127.0.0.1` และทุก request ต้องมี bearer token (กด **Rotate token** เปลี่ยนได้)
- คำสั่งที่ลบ/เปลืองทรัพยากร (ลบคลิป, ส่งออก, งาน AI) จะถูกปฏิเสธจนกว่าจะเปิด
  **การตั้งค่า → MCP → Trusted local — auto-allow**
- headless (ไม่เปิดแอป): ดู `@openreel/agent-runner` ใน `docs/AGENT-GUIDE.md`

## ทดสอบแล้ว (18/10/2026, macOS arm64)

- `kt-tadtor status` → เชื่อมต่อได้ 311 tools
- MCP stdio: `initialize` → `create_project` → `create_text_clip` (ข้อความไทย) → `get_editor_state` ผลขึ้นในแอปจริง
- Claude Code (`claude -p --mcp-config …`) สั่งเพิ่มข้อความลงไทม์ไลน์ได้จริง (duration 3 → 5 วิ)
- Codex CLI 0.145 อ่าน config ที่ `setup codex` เขียนได้ (`codex mcp get kt-tadtor`)
