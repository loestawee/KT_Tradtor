# KT ตัดต่อ (web) — response headers shared by every location.
# COOP/COEP make the page cross-origin isolated (SharedArrayBuffer for the
# multi-threaded ffmpeg/WebCodecs pipeline), mirroring apps/web/public/_headers.
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Strict-Transport-Security "max-age=31536000" always;
# Scripts only from this origin + the CDNs the AI workers load models/runtimes
# from; 'wasm-unsafe-eval' is needed by ffmpeg/onnx. No 'unsafe-eval': motion
# expressions run in the sandboxed interpreter (packages/core/src/motion/
# safe-expression.ts) — deploy this header together with that build. connect-src stays open to https because
# users may point the AI editor at any OpenAI-compatible endpoint.
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://unpkg.com https://esm.sh https://storage.googleapis.com https://static.cloudflareinsights.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self' data: blob: https: wss:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'" always;
add_header Permissions-Policy "camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" always;
