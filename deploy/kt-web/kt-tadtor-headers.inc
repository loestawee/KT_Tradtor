# KT ตัดต่อ (web) — response headers shared by every location.
# COOP/COEP make the page cross-origin isolated (SharedArrayBuffer for the
# multi-threaded ffmpeg/WebCodecs pipeline), mirroring apps/web/public/_headers.
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Strict-Transport-Security "max-age=31536000" always;
