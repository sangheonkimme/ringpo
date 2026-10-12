#!/bin/sh
# GitHub Actions 없이 VPS에서 직접 빌드·배포한다.
# 저장소를 VPS에 clone해 두고, deploy/.env를 채운 뒤 실행한다: sh deploy/deploy-on-vps.sh
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
tag="ringpo:$(git rev-parse --short HEAD)"
site_url="$(grep '^APP_URL=' deploy/.env | cut -d= -f2-)"
docker build --build-arg SITE_URL="$site_url" -t "$tag" .
cd deploy
sed -i "s|^IMAGE=.*|IMAGE=$tag|" .env
docker compose up -d --remove-orphans
domain="$(grep '^APP_DOMAIN=' .env | cut -d= -f2)"
for _ in $(seq 1 30); do
  if curl -fsS "https://${domain}/api/health?strict=1" > /dev/null; then
    echo "healthy: $tag"
    # 디스크 정리: 지금 이미지와 직전 2개(되돌리기용)만 남기고, 빌드 캐시는 3GB까지만 둔다(다음 빌드가 빠르도록 일부는 남김)
    docker images ringpo --format '{{.Tag}}' | tail -n +4 | xargs -r -I{} docker image rm "ringpo:{}" > /dev/null 2>&1 || true
    docker builder prune -f --reserved-space 3GB > /dev/null 2>&1 || docker builder prune -f --keep-storage 3GB > /dev/null 2>&1 || true
    exit 0
  fi
  sleep 5
done
echo "health check failed"
docker compose logs --tail=100 web worker
exit 1
