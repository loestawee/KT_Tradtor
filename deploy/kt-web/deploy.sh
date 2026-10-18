#!/usr/bin/env bash
# Deploy the KT ตัดต่อ web build to kataysv (.219) → https://kt-tadtor.officebk.co
# Usage: deploy/kt-web/deploy.sh            (build + upload + switch)
#        deploy/kt-web/deploy.sh rollback   (point `current` at the previous release)
# Server layout: /opt/kt-tadtor/releases/<ts>, live symlink /opt/kt-tadtor/current
# (SELinux context httpd_sys_content_t is registered for /opt/kt-tadtor).
set -euo pipefail
HOST=katay   # ssh alias from ~/.ssh/config (port 2222) — never use user@ip (fail2ban)
ROOT=/opt/kt-tadtor
KEEP=5

if [[ "${1:-}" == "rollback" ]]; then
  ssh "$HOST" "set -e; prev=\$(ls -1d $ROOT/releases/* | sort | tail -2 | head -1);
    sudo ln -sfn \"\$prev\" $ROOT/current; echo \"current -> \$prev\""
  exit 0
fi

cd "$(dirname "$0")/../.."
pnpm build:wasm
pnpm --filter @openreel/web exec vite build
ts=$(date +%Y%m%d-%H%M%S)
tar -C apps/web/dist -czf "/tmp/kt-web-$ts.tgz" .
scp -q "/tmp/kt-web-$ts.tgz" "$HOST:/tmp/"
ssh "$HOST" "set -e
  sudo mkdir -p $ROOT/releases/$ts
  sudo tar -xzf /tmp/kt-web-$ts.tgz -C $ROOT/releases/$ts
  rm /tmp/kt-web-$ts.tgz
  sudo chmod -R a+rX $ROOT/releases/$ts
  sudo restorecon -R $ROOT
  sudo ln -sfn $ROOT/releases/$ts $ROOT/current
  ls -1d $ROOT/releases/* | sort | head -n -$KEEP | xargs -r sudo rm -rf
  echo \"live: \$(readlink $ROOT/current)\""
rm "/tmp/kt-web-$ts.tgz"
curl -fsS -o /dev/null -w "https://kt-tadtor.officebk.co -> %{http_code}\n" https://kt-tadtor.officebk.co/
