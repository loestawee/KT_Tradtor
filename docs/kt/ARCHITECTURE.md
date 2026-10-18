# KT ตัดต่อ — สถาปัตยกรรมและแผนงาน

แอปตัดต่อวิดีโอแบบ CapCut สำหรับ **Windows, macOS, Android, Web** (MyCut / cooran.xyz ใช้เป็นแค่ตัวอย่างอ้างอิง)

## 0. โปรเจกต์ open source ที่ใช้ต่อยอดได้ (ตรวจ 18/10/2026)

| โปรเจกต์ | License | Stack | หมายเหตุ |
|---|---|---|---|
| [OpenReel Video](https://github.com/Augani/openreel-video) | MIT | React + TS + WebCodecs + WebGPU, ทำงานในเบราว์เซอร์ทั้งหมด | stack เดียวกับแผนข้างล่างเกือบทุกจุด — เหมาะเป็นฐาน fork ที่สุด |
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | MIT | Next.js (web) + Rust core + GPUI (desktop) | ดาวเยอะสุด (~95k) แต่ส่วน desktop เป็น Rust ซึ่งต่อกับ Android ด้วย Capacitor ไม่ได้ตรงๆ |
| OpenShot / Shotcut / Kdenlive | GPL | C++/Qt | desktop เท่านั้น, ไม่มี Web/Android, GPL บังคับให้เปิดโค้ด |

### 0.1 ผล spike OpenReel บน Android (18/10/2026)

ทดสอบบน emulator Android 14 (arm64), Chrome / WebView 150 — fork อยู่ที่ github.com/loestawee/KT_Tradtor, Android shell อยู่ที่ `apps/kt-android/`

OpenReel มี **Web + Electron desktop (Win/mac/Linux, alpha) อยู่แล้ว** → งานที่เหลือจริงๆ คือ Android + ปรับ UI มือถือ + ภาษาไทย

| ทดสอบ | Chrome Android | Capacitor WebView |
|---|---|---|
| เปิด editor, layout มือถือ (แท็บล่าง) | ✅ | ✅ |
| Import วิดีโอจากเครื่อง | ✅ | ✅ (file chooser ทำงาน) |
| Timeline + thumbnail + เล่น | ✅ | ✅ |
| Export MP4 | ✅ H.264 1280×720 30fps 300 เฟรม + AAC, 10.000s, PSNR เทียบต้นฉบับ 36.7 dB | ⚠️ render ครบ 300 เฟรม แต่ **ไม่ได้ไฟล์** — WebView ไม่จัดการ blob download |
| WebCodecs H.264 enc / HEVC dec | ✅ / ✅ | ✅ / ✅ |
| WebGPU | ❌ (emulator) → fallback Canvas2D อัตโนมัติ | ❌ เหมือนกัน |
| `crossOriginIsolated` / SharedArrayBuffer | ✅ | ❌ **WebView ไม่รองรับแม้ส่ง COOP/COEP** |

**สิ่งที่ต้องแก้สำหรับ Android (backlog)**
1. ~~**บันทึกไฟล์ export**~~ ✅ ทำแล้ว (branch `kt/android-export`): OPFS → cache ผ่าน Filesystem → `KtMediaPlugin` (MediaStore) ลง `Movies/KT Tadtor/`
2. **ไม่มี SharedArrayBuffer ใน WebView** — ไล่หาฟีเจอร์ที่ใช้ `@ffmpeg/core-mt` แล้ว fallback เป็น `@ffmpeg/core` (single-thread) หรือ native plugin; export หลักผ่าน WebCodecs ไม่กระทบ
3. **Player preview บนมือถือสูงแค่ ~30px** — layout บีบจนแทบมองไม่เห็นภาพ
4. **ปุ่ม "Add to timeline" โผล่เฉพาะ hover / double-click** — นิ้วกดไม่ได้ ต้องมีปุ่ม/แตะค้างสำหรับ touch
5. **Export dialog ล้นจอแนวนอน** (ปุ่ม export โดนตัดขอบ)
6. Import ขอ permission กล้องก่อนเปิด file picker (ตัด `capture`/accept ให้ตรง)
7. ทดสอบ WebGPU บนมือถือจริง (emulator ไม่มี) และ performance คลิป 1080p/4K

## 1. แนวทางหลัก: แกนเว็บตัวเดียว ห่อให้ทุกแพลตฟอร์ม

```
                ┌──────────────────────────────────────────┐
                │ packages/core  (TypeScript, ไม่ผูก UI)    │
                │  • Project model (timeline เป็น JSON)     │
                │  • Decode   : WebCodecs + Mediabunny      │
                │  • Composite: WebGL2 (ทีหลังค่อย WebGPU)  │
                │  • Audio    : WebAudio mixer              │
                │  • Export   : WebCodecs encode → MP4      │
                └──────────────────────────────────────────┘
                                   ▲
                ┌──────────────────┴───────────────────────┐
                │ packages/ui  (React: timeline, preview,   │
                │ panel ต่างๆ, layout แยก desktop / touch)  │
                └──────────────────────────────────────────┘
         ▲                    ▲                     ▲
   apps/web (PWA)     apps/desktop (Electron)   apps/android (Capacitor)
   Chrome/Edge        Win + macOS               Android WebView (Chromium)
                      + ffmpeg sidecar           + native plugin เมื่อจำเป็น
```

### ทำไมไม่เลือกทางอื่น
| ตัวเลือก | ข้อดี | ทำไมไม่เอา |
|---|---|---|
| **Web core + Electron + Capacitor** ✅ | โค้ดชุดเดียว ~85% ใช้ร่วมกัน, มีประสบการณ์ Electron แล้ว (video_convert) | ไฟล์ติดตั้งใหญ่ (~150MB) — ยอมรับได้สำหรับแอปตัดต่อ |
| Tauri | ตัวติดตั้งเล็ก | macOS ใช้ WKWebView (Safari) ซึ่ง WebCodecs/codec ไม่ครบเท่า Chromium → preview/export พฤติกรรมไม่เหมือนกันแต่ละ OS |
| Flutter + engine C++/FFmpeg | performance native | Web อ่อน, ต้องเขียน engine ผูก FFmpeg เองทุกแพลตฟอร์ม งานหนักกว่าหลายเท่า |
| C++/Qt | เร็วสุด | ไม่มี Web, Android ทำยาก |

**หลักการสำคัญ:** ทุกแพลตฟอร์มรันบน Chromium (Chrome / Electron / Android WebView) → shader, codec และผลลัพธ์ export ออกมาเหมือนกัน

## 2. โมดูลใน core

- **Project model** — `Project { tracks[], assets[], settings }`, `Clip { assetId, in, out, start, effects[], transform }` เก็บเป็น JSON ทำ undo/redo แบบ command stack
- **Media I/O** — demux ด้วย Mediabunny, decode ด้วย `VideoDecoder`; Web เก็บไฟล์ใน OPFS, Desktop/Android อ่านจาก filesystem ผ่าน adapter
- **Compositor** — render เฟรมต่อเฟรมบน WebGL2: transform, ฟิลเตอร์ (LUT), ทรานซิชัน, **ลบฉากเขียว (chroma key shader)**, ข้อความ/สติกเกอร์ (วาดลง canvas → texture)
- **Preview** — ใช้ proxy ความละเอียดต่ำ (540p) เพื่อให้ลื่นบนมือถือ
- **Export** — `VideoEncoder` H.264 + AAC → MP4; บน desktop มีทางสำรองเป็น ffmpeg sidecar (codec ที่ WebCodecs ไม่รองรับ, ไฟล์ยาวมาก)

## 3. Milestones

| # | เป้าหมาย | เกณฑ์ผ่าน |
|---|---|---|
| M0 | Monorepo (pnpm workspaces) + CI | `pnpm dev` เปิดเว็บได้, build Electron ได้ |
| M1 | **MVP บนเว็บ**: import → timeline 1 แทร็ก → ตัด/แยกคลิป → preview → export MP4 1080p | export คลิป 1 นาทีได้ เสียงกับภาพตรงกัน (±1 เฟรม) |
| M2 | หลายแทร็ก, ข้อความ, สติกเกอร์, มิกซ์เสียง, undo/redo | ใช้ซ้อน 3 วิดีโอ + 2 เสียงได้ |
| M3 | ฟิลเตอร์, ทรานซิชัน, ลบฉากเขียว, ปรับความเร็ว | ได้ฟีเจอร์ครบเท่า MyCut เวอร์ชัน Windows |
| M4 | Desktop (Electron): ไฟล์ native, ffmpeg sidecar, auto-update, signing Win/mac | ติดตั้ง .exe / .dmg ได้ (macOS ผ่าน notarize) |
| M5 | Android (Capacitor): UI แบบ touch, จัดการหน่วยความจำ, เลือกไฟล์จากแกลเลอรี | ตัดต่อ 1080p บนเครื่องระดับกลางได้ไม่ crash |
| M6 | AI: ซับไตเติลอัตโนมัติ (นำของจาก video_convert มาใช้), ลบพื้นหลังด้วย AI | — |

## 4. ความเสี่ยงที่ต้องพิสูจน์ก่อน (spike ใน M0–M1)

1. **คลิป HEVC จากมือถือ** — WebCodecs บน Windows ต้องใช้ HEVC extension → อาจต้องทำ proxy ด้วย ffmpeg
2. **หน่วยความจำบน Android** — ต้องปล่อย `VideoFrame` ทุกเฟรม (`frame.close()`) ไม่งั้น GPU memory รั่วภายในไม่กี่วินาที
3. **ไฟล์ใหญ่บนเว็บ** — อ่านแบบ stream จาก OPFS ห้ามโหลดทั้งไฟล์เข้า RAM
4. **A/V sync ตอน export** — ใช้ timestamp เป็นไมโครวินาทีให้ตรงกันทั้งระบบ ไม่ใช้เลขเฟรม
