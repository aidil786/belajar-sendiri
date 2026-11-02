#!/usr/bin/env bash
# Small helpers for the Cloudflare Pages deploy (used by .github/workflows/ci.yml).
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment. It never prints the token.
# The token only needs Account > Cloudflare Pages > Edit.
#
#   scripts/cloudflare-pages.sh ensure      create the Pages project the first time; check its address
#   scripts/cloudflare-pages.sh smoke       the home pages answer 200 and send the security headers
#   scripts/cloudflare-pages.sh check-all   every page in dist/ answers 200 on the live address
set -euo pipefail

# The project name is also the address: https://belajarsendiri.pages.dev (no names, no numbers).
PROJECT="${PAGES_PROJECT:-belajarsendiri}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is not set}"
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}"

api() { curl -sS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" "$@"; }

# The project's *.pages.dev address (empty when the project does not exist or the token can't see it).
subdomain() { api "$API/pages/projects/$PROJECT" | jq -r '.result.subdomain // empty'; }

live_url() {
  local sub
  sub="$(subdomain)"
  if [ -z "$sub" ]; then
    echo "::error::Can't read the Pages project $PROJECT. The token needs Account > Cloudflare Pages > Edit." >&2
    api "$API/pages/projects/$PROJECT" | jq -c '{success, errors: [.errors[]? | "\(.code): \(.message)"]}' >&2
    exit 1
  fi
  echo "https://$sub"
}

case "${1:-}" in
  ensure)
    if [ -z "$(subdomain)" ]; then
      echo "Creating the Pages project $PROJECT (first deploy only)."
      npx wrangler pages project create "$PROJECT" --production-branch main
    fi
    url="$(live_url)"
    echo "Pages project $PROJECT lives at $url"
    # If the name was taken on pages.dev, Cloudflare adds random letters. Stop rather than
    # publish on an address nobody chose.
    if [ "$url" != "https://$PROJECT.pages.dev" ]; then
      echo "::error::The project got the address $url, not https://$PROJECT.pages.dev. Pick another name."
      exit 1
    fi
    if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "url=$url" >> "$GITHUB_OUTPUT"; fi
    ;;

  smoke)
    url="$(live_url)"
    for path in /en/ /ms/ /en/ship-it/; do
      for try in 1 2 3 4 5 6; do
        code="$(curl -s -o /dev/null -w '%{http_code}' "$url$path")"
        echo "$url$path → $code (try $try)"
        [ "$code" = 200 ] && break
        [ "$try" = 6 ] && exit 1
        sleep 10
      done
    done
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url/no-such-page/")"
    echo "$url/no-such-page/ → $code (the friendly 404 page)"
    [ "$code" = 404 ]
    # The security headers from dist/_headers really arrive.
    head="$(curl -sSI "$url/en/")"
    for h in content-security-policy x-content-type-options x-frame-options referrer-policy; do
      if ! grep -qi "^$h:" <<< "$head"; then echo "::error::$url/en/ has no $h header."; exit 1; fi
    done
    echo "Security headers are there."
    ;;

  check-all)
    url="$(live_url)"
    find dist -name index.html | sed 's|^dist||; s|index\.html$||' | sort > /tmp/pages.txt
    echo "Checking $(wc -l < /tmp/pages.txt) pages on $url"
    : > /tmp/bad.txt
    # shellcheck disable=SC2016
    xargs -P 16 -I{} sh -c 'c=$(curl -s -o /dev/null -w "%{http_code}" "$0{}"); [ "$c" = 200 ] || echo "$c {}" >> /tmp/bad.txt' "$url" < /tmp/pages.txt
    if [ -s /tmp/bad.txt ]; then
      echo "::error::$(wc -l < /tmp/bad.txt) pages did not answer 200:"
      head -30 /tmp/bad.txt
      exit 1
    fi
    echo "Every page answered 200."
    ;;

  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
