#!/usr/bin/env sh
# Usage: sh scripts/set-domain.sh https://www.example.com[/repo-path]
# Rewrites the placeholder domain in robots.txt and sitemap.xml.
set -eu
[ $# -eq 1 ] || { echo "Usage: sh scripts/set-domain.sh https://bnmtqaixjvvtowumeddj.supabase.co"; exit 1; }
URL=$(printf '%s' "$1" | sed 's#/*$##')
case "$URL" in https://*) ;; *) echo "URL must start with https://"; exit 1;; esac
ROOT=$(cd "$(dirname "$0")/.." && pwd)
for f in "$ROOT/robots.txt" "$ROOT/sitemap.xml"; do
  sed "s#https://bnmtqaixjvvtowumeddj.supabase.co#$URL#g" "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
echo "Updated robots.txt and sitemap.xml for $URL"
