# KT ตัดต่อ — locations shared by the :80 (Cloudflare Flexible) and :443 servers.
root /opt/kt-tadtor/current;
index index.html;
access_log /var/log/nginx/kt-tadtor-access.log;
error_log /var/log/nginx/kt-tadtor-error.log;

gzip on;
gzip_types application/javascript text/css application/json application/wasm image/svg+xml;

location ^~ /.well-known/acme-challenge/ { root /var/www/kt-tadtor-acme; }

# Hashed build output never changes under the same name.
location /assets/ {
    include /etc/nginx/kt-tadtor-headers.inc;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
}

# App shell and service worker are always revalidated so releases land at once.
location = /sw.js {
    include /etc/nginx/kt-tadtor-headers.inc;
    add_header Cache-Control "no-cache" always;
}
location ~ ^/(_headers|_redirects)$ { return 404; }
location ~ /\. { deny all; }

location / {
    include /etc/nginx/kt-tadtor-headers.inc;
    add_header Cache-Control "no-cache" always;
    try_files $uri /index.html;
}
