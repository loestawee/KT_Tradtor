# ปลั๊กอินเอฟเฟกต์ / ฟิลเตอร์ (KT ตัดต่อ)

ติดตั้งที่ **การตั้งค่า → ปลั๊กอิน → ติดตั้งจากไฟล์…** แล้วใช้งานที่คลิป: **เอฟเฟกต์วิดีโอ → Add Effect → Shaders**
(ปลั๊กอินแสดงเป็นกลุ่มตามชื่อปลั๊กอิน) ใช้ได้ทั้งเว็บ, Windows/macOS และ Android เพราะรันผ่าน WebGL2 ตัวเดียวกับเอฟเฟกต์ในตัว

ตัวอย่างพร้อมใช้: `apps/web/src/plugins/samples/kt-film-pack.ktfx.json` (มีปุ่ม "ติดตั้งตัวอย่าง" ในหน้าปลั๊กอิน)

## รูปแบบไฟล์ `.ktfx.json`

```json
{
  "format": "kt-plugin/1",
  "id": "yourname.cool-looks",          // a-z 0-9 . -  (3–64 ตัว) ห้ามซ้ำกับปลั๊กอินอื่น
  "name": "Cool Looks",
  "version": "1.0.0",                    // semver; ติดตั้ง id เดิม = อัปเดตทับ
  "author": "ชื่อผู้ทำ",                    // ไม่บังคับ
  "description": "…",                   // ไม่บังคับ
  "homepage": "https://…",              // ไม่บังคับ, รับเฉพาะ https
  "shaders": [
    {
      "id": "warm-glow",                 // a-z 0-9 -  (ไม่เกิน 48 ตัว)
      "name": "Warm Glow",
      "category": "effect",              // effect = ใช้กับคลิป | fill | text (Motion/ข้อความ)
      "glsl": "#version 300 es\n…",
      "params": [
        { "name": "amount", "label": "Amount", "min": 0, "max": 1, "default": 0.5, "step": 0.01 },
        { "name": "tint", "label": "Tint", "type": "color", "default": "#ff8800" }
      ]
    }
  ]
}
```

## สัญญาของ GLSL (effect)

```glsl
#version 300 es
precision highp float;
in vec2 vUv;                 // 0..1
uniform sampler2D u_input;   // ภาพของคลิป (effect/text ต้องมี; fill ห้ามใช้)
uniform vec2 u_resolution;   // ขนาดเป็นพิกเซล
uniform float u_time;        // วินาที
uniform float u_amount;      // = params[].name ขึ้นต้นด้วย u_
out vec4 fragColor;
void main() { fragColor = texture(u_input, vUv); }
```

text shader ต้องมี `uniform float u_progress;` เพิ่ม — ไฟล์ทุกตัวถูก compile บน GPU จริงก่อนติดตั้ง ถ้า compile ไม่ผ่านจะแจ้ง error พร้อมชื่อ shader

## ความปลอดภัย / ข้อจำกัด

- ปลั๊กอิน **มีแค่ GLSL ไม่มี JavaScript** → อ่าน/เขียนไฟล์, เรียกเน็ต, แตะ DOM หรือ IPC ไม่ได้
- ฟิลด์ที่ไม่รู้จักถูกทิ้ง — โดยเฉพาะ `vertexShader`, `needsNoiseTexture` (โหลดรูปจาก URL) และ `staticUniforms`
- จำกัด: ไฟล์ ≤ 1 MB, ≤ 64 shader, GLSL ละ ≤ 64 KB, param ≤ 16, ติดตั้งได้ ≤ 20 ปลั๊กอิน
- shader id ถูกตั้งชื่อใหม่เป็น `plugin.<pluginId>.<shaderId>` ชนกับเอฟเฟกต์ในตัวไม่ได้
- ที่เก็บในเครื่องเก็บเฉพาะข้อความดิบ แล้ว parse + ตรวจซ้ำทุกครั้งที่เปิดแอป
- ข้อควรระวัง: shader ที่วนลูปหนักมากอาจทำให้ preview กระตุก (GPU) — ติดตั้งเฉพาะจากแหล่งที่ไว้ใจ แล้วปิด/ลบได้ทันทีในหน้าปลั๊กอิน

## เมื่อปิด/ลบปลั๊กอิน หรือเปิดโปรเจกต์บนเครื่องอื่น

ตอนเพิ่มเอฟเฟกต์จากปลั๊กอินลงคลิป ระบบคัดลอก shader นั้นเข้าไปเก็บใน `project.generatedShaders`
คลิปเดิมจึงยัง render/export ได้เหมือนเดิม (ทดสอบแล้ว: ปิดปลั๊กอิน → ภาพยังเกรดสีเหมือนเดิม)
