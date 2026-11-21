#!/usr/bin/env bash
# Smoke check of the path a workshop participant walks: sign-in page,
# catalogue, a hosted file, an evaluation task, a submission (#641).
#
# Run it before each workshop day, and after any deploy during a freeze:
#
#   scripts/workshop-smoke.sh                       # dev, the seeded demo objects
#   scripts/workshop-smoke.sh --dataset <slug> --task <slug> --predictions <file>
#
#   # The radiology-workshop seed profile, once it is switched on:
#   scripts/workshop-smoke.sh --dataset nih-chestxray14-workshop --task nih-chestxray14-finding \
#     --predictions packages/database/seed/profiles/radiology-workshop/fixtures/nih-chestxray14-workshop/model-a.csv
#
#   read -rs OCI_SMOKE_TOKEN && export OCI_SMOKE_TOKEN   # paste; not echoed, not in history
#   scripts/workshop-smoke.sh --scored
#   unset OCI_SMOKE_TOKEN
#
# Steps 1 to 5 only read. Step 6 posts a validation submission, which the
# API checks and discards: nothing is stored, no account is needed and no
# quota is spent. Step 7, one SCORED submission, runs only with --scored
# and a participant's access token in OCI_SMOKE_TOKEN.
#
# --scored spends ONE scored submission per run, for that account on that
# task. The limit is set per environment (infra/cdk/lib/environments.ts,
# scoredSubmissionQuota; on dev 3 per week and 10 in total), and every run
# adds an entry to the task's public results. Use an account kept for this.
#
# The token is read from the environment and from nowhere else. It is never
# an argument, never written to a file and never printed; curl receives it
# on standard input. Get one by signing in and opening /api/auth/session
# (see docs/runbooks/). Needs bash, curl and jq.
#
# Exit status: 0 when no step failed, 1 when one did, 2 on a usage error.

set -euo pipefail
# Never trace: a `bash -x` run would print the token.
set +x

BASE_URL='https://dev.oci.ai4h.net'
API_URL=''
DATASET='idrid-grading-demo'
TASK='idrid-dr-grading'
PREDICTIONS=''
METHOD_NAME=''
SCORED=false
READ_ONLY=false
TIMEOUT=30

usage() {
  cat <<'USAGE'
Usage: scripts/workshop-smoke.sh [options]

  --base-url URL       Environment to check (default https://dev.oci.ai4h.net)
  --api-url URL        Where the API answers, when not on the base URL: a local
                       stack serves pages on :3001 and the API on :3000
  --dataset SLUG       Dataset with at least one hosted file (default idrid-grading-demo)
  --task SLUG          Evaluation task (default idrid-dr-grading)
  --predictions FILE   Predictions for the task: a JSON submission body, or a
                       .csv as uploaded in the browser (header, then item_id,label)
                       (default apps/api/scripts/fixtures/lab-demo/idrid-predictions.json)
  --method-name NAME   Name the scored submission is listed under
                       (default "Smoke check <UTC date and time>")
  --scored             Also make one SCORED submission. Needs OCI_SMOKE_TOKEN and
                       spends one scored submission of that account on that task.
  --read-only          GET requests only: skip both submission steps.
  --timeout SECONDS    Per request (default 30)
  -h, --help           This text

Environment:
  OCI_SMOKE_TOKEN      Access token of a participant account, for --scored only.
USAGE
}

while (($# > 0)); do
  case "$1" in
    --base-url | --api-url | --dataset | --task | --predictions | --method-name | --timeout)
      if (($# < 2)); then
        echo "workshop-smoke: $1 needs a value" >&2
        exit 2
      fi
      case "$1" in
        --base-url) BASE_URL="$2" ;;
        --api-url) API_URL="$2" ;;
        --dataset) DATASET="$2" ;;
        --task) TASK="$2" ;;
        --predictions) PREDICTIONS="$2" ;;
        --method-name) METHOD_NAME="$2" ;;
        --timeout) TIMEOUT="$2" ;;
      esac
      shift 2
      ;;
    --scored)
      SCORED=true
      shift
      ;;
    --read-only)
      READ_ONLY=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "workshop-smoke: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Take the token out of the environment at once, so no child process
# inherits it. From here on it lives in this shell variable only.
TOKEN="${OCI_SMOKE_TOKEN:-}"
unset OCI_SMOKE_TOKEN

BASE_URL="${BASE_URL%/}"
API_URL="${API_URL%/}"
if [[ -z "$API_URL" ]]; then
  API_URL="$BASE_URL"
fi
for url in "$BASE_URL" "$API_URL"; do
  if [[ ! "$url" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
    echo "workshop-smoke: --base-url and --api-url must look like https://host[:port], got: $url" >&2
    exit 2
  fi
done
if [[ ! "$DATASET" =~ ^[a-z0-9][a-z0-9-]*$ || ! "$TASK" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "workshop-smoke: --dataset and --task take a slug (lower-case letters, digits, hyphens)" >&2
  exit 2
fi
if [[ ! "$TIMEOUT" =~ ^[0-9]+$ ]]; then
  echo "workshop-smoke: --timeout takes a number of seconds" >&2
  exit 2
fi
for tool in curl jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "workshop-smoke: $tool is required" >&2
    exit 2
  fi
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "$PREDICTIONS" ]]; then
  PREDICTIONS="$REPO_ROOT/apps/api/scripts/fixtures/lab-demo/idrid-predictions.json"
fi
if [[ -z "$METHOD_NAME" ]]; then
  METHOD_NAME="Smoke check $(date -u '+%Y-%m-%d %H:%M') UTC"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASSED=0
FAILED=0
SKIPPED=0
SCORED_NOT_MADE=false

pass() {
  PASSED=$((PASSED + 1))
  printf 'PASS     %s\n' "$1"
}
fail() {
  FAILED=$((FAILED + 1))
  printf 'FAIL     %s\n' "$1"
}
skip() {
  SKIPPED=$((SKIPPED + 1))
  printf 'SKIPPED  %s\n' "$1"
}

# One line of a response body, cut short, for a failure message. Bodies
# come from the platform's own API and never contain the token.
excerpt() {
  head -c 300 "$1" | tr '\n\r' '  '
}

# Why curl itself gave up (no route, TLS, timeout), on standard error, just
# above the FAIL line it explains. curl's message names the host, never the
# query string of a signed link.
curl_gave_up() {
  printf '         curl: %s\n' "$(head -c 200 "$WORK/curl.err" | tr '\n\r' '  ')" >&2
}

# GET a URL into a file. Prints "<status> <content-type>", with status 000
# when the request itself failed. Follows redirects, and never prints where
# to: a download redirects to a signed storage link.
http_get() {
  local url="$1" out="$2" line
  : >"$out"
  if line="$(curl --silent --show-error --location --max-time "$TIMEOUT" \
    --output "$out" --write-out '%{http_code} %{content_type}' "$url" 2>"$WORK/curl.err")"; then
    printf '%s\n' "$line"
  else
    curl_gave_up
    printf '000 -\n'
  fi
}

# POST a JSON file. Prints the status, 000 when the request itself failed.
# With a token, curl reads the Authorization header from standard input
# (--config -), fed by the shell's own printf: the token is in no command
# line and in no file.
http_post_json() {
  local url="$1" body="$2" out="$3" token="${4:-}" status
  : >"$out"
  if [[ -n "$token" ]]; then
    status="$(printf 'header = "Authorization: Bearer %s"\n' "$token" |
      curl --config - --silent --show-error --max-time "$TIMEOUT" \
        --header 'Content-Type: application/json' --data-binary "@$body" \
        --output "$out" --write-out '%{http_code}' "$url" 2>"$WORK/curl.err")" || status=000
  else
    status="$(curl --silent --show-error --max-time "$TIMEOUT" \
      --header 'Content-Type: application/json' --data-binary "@$body" \
      --output "$out" --write-out '%{http_code}' "$url" 2>"$WORK/curl.err")" || status=000
  fi
  if [[ "$status" == 000 ]]; then curl_gave_up; fi
  printf '%s' "$status"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

echo "Workshop smoke check: $BASE_URL (dataset $DATASET, task $TASK)"
echo "Started $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

# -- 1. API health --------------------------------------------------------------
read -r status _ < <(http_get "$API_URL/health" "$WORK/health.json")
if [[ "$status" == 200 ]] && jq -e '.status == "ok"' "$WORK/health.json" >/dev/null 2>&1; then
  pass "1 API health: $(jq -r '"\(.service) \(.version), env \(.env)"' "$WORK/health.json")"
else
  fail "1 API health: GET /health answered $status: $(excerpt "$WORK/health.json")"
fi

# -- 2. Sign-in page ------------------------------------------------------------
read -r status _ < <(http_get "$BASE_URL/signin" "$WORK/signin.html")
read -r providers_status _ < <(http_get "$BASE_URL/api/auth/providers" "$WORK/providers.json")
if [[ "$status" != 200 ]]; then
  fail "2 sign-in page: GET /signin answered $status"
elif ! grep -q 'Sign in' "$WORK/signin.html"; then
  fail "2 sign-in page: the page does not say \"Sign in\""
elif [[ "$providers_status" != 200 ]] ||
  ! jq -e 'type == "object" and length > 0' "$WORK/providers.json" >/dev/null 2>&1; then
  fail "2 sign-in page: /api/auth/providers answered $providers_status and lists no sign-in provider"
else
  pass "2 sign-in page: renders, provider $(jq -r 'keys | join(", ")' "$WORK/providers.json")"
fi

# -- 3. Catalogue list ----------------------------------------------------------
# The list is paged and sorted by last change, so the dataset may be on any
# page once participants have published their own.
read -r status _ < <(http_get "$BASE_URL/catalog" "$WORK/catalog.html")
listed=false
total='?'
page=1
api_status=200
while ((page <= 40)); do
  read -r api_status _ < <(http_get "$API_URL/v2/catalog/datasets?page=$page" "$WORK/datasets.json")
  if [[ "$api_status" != 200 ]]; then break; fi
  total="$(jq -r '.totalEstimate // (.items | length)' "$WORK/datasets.json" 2>/dev/null || echo '?')"
  if jq -e --arg slug "$DATASET" '.items | map(.slug) | index($slug) != null' \
    "$WORK/datasets.json" >/dev/null 2>&1; then
    listed=true
    break
  fi
  if ! jq -e --argjson page "$page" '(.totalPages // 1) > $page' \
    "$WORK/datasets.json" >/dev/null 2>&1; then
    break
  fi
  page=$((page + 1))
done
if [[ "$status" != 200 ]]; then
  fail "3 catalogue list: GET /catalog answered $status"
elif [[ "$api_status" != 200 ]]; then
  fail "3 catalogue list: GET /v2/catalog/datasets answered $api_status: $(excerpt "$WORK/datasets.json")"
elif [[ "$listed" != true ]]; then
  fail "3 catalogue list: $DATASET is not among the $total datasets visible without signing in"
else
  pass "3 catalogue list: page renders, $total datasets visible without signing in, $DATASET listed"
fi

# -- 4. Hosted file download ----------------------------------------------------
read -r status _ < <(http_get "$API_URL/v2/catalog/datasets/$DATASET" "$WORK/dataset.json")
read -r page_status _ < <(http_get "$BASE_URL/catalog/$DATASET" "$WORK/dataset.html")
if [[ "$status" != 200 ]]; then
  fail "4 hosted file: GET /v2/catalog/datasets/$DATASET answered $status: $(excerpt "$WORK/dataset.json")"
elif [[ "$page_status" != 200 ]]; then
  fail "4 hosted file: GET /catalog/$DATASET answered $page_status"
else
  # First file the platform hosts itself: its link is the download route.
  jq -c '[.distributions[]? | select((.contentUrl // "") | test("/distributions/[^/]+/download$"))][0] // empty' \
    "$WORK/dataset.json" >"$WORK/file.json" 2>/dev/null || true
  if [[ ! -s "$WORK/file.json" ]]; then
    fail "4 hosted file: $DATASET lists no file hosted on the platform"
  else
    file_name="$(jq -r '.filename // .croissantId // "file"' "$WORK/file.json")"
    file_path="$(jq -r '.contentUrl' "$WORK/file.json")"
    want_size="$(jq -r '.contentSizeBytes // empty' "$WORK/file.json")"
    want_hash="$(jq -r '.contentHash // empty' "$WORK/file.json")"
    want_type="$(jq -r '.contentType // empty' "$WORK/file.json")"
    read -r status got_type < <(http_get "$API_URL$file_path" "$WORK/file.bin")
    got_size="$(wc -c <"$WORK/file.bin" | tr -d ' ')"
    got_hash="$(sha256_of "$WORK/file.bin")"
    if [[ "$status" != 200 ]]; then
      fail "4 hosted file: downloading $file_name answered $status"
    elif [[ -n "$want_size" && "$got_size" != "$want_size" ]]; then
      fail "4 hosted file: $file_name is $got_size bytes, the catalogue says $want_size"
    elif [[ -n "$want_hash" && -n "$got_hash" && "$got_hash" != "$want_hash" ]]; then
      fail "4 hosted file: $file_name does not match the SHA-256 in the catalogue"
    elif [[ -n "$want_type" && "$got_type" != "$want_type"* ]]; then
      fail "4 hosted file: $file_name came back as $got_type, the catalogue says $want_type"
    elif [[ -z "$got_hash" || -z "$want_hash" ]]; then
      pass "4 hosted file: $file_name, $got_size bytes, $got_type (SHA-256 not compared)"
    else
      pass "4 hosted file: $file_name, $got_size bytes, $got_type, SHA-256 matches the catalogue"
    fi
  fi
fi

# -- 5. Evaluation task: its page, the submit page, the file template -----------
read -r status _ < <(http_get "$BASE_URL/evaluation/$TASK" "$WORK/task.html")
read -r submit_status _ < <(http_get "$BASE_URL/evaluation/$TASK/submit" "$WORK/submit.html")
read -r template_status template_type < <(http_get "$BASE_URL/evaluation/$TASK/template.csv" "$WORK/template.csv")
read -r api_status _ < <(http_get "$API_URL/v2/evaluation/tasks/$TASK" "$WORK/task.json")
if [[ "$status" != 200 ]]; then
  fail "5 evaluation task: GET /evaluation/$TASK answered $status"
elif [[ "$submit_status" != 200 ]]; then
  fail "5 evaluation task: the submit page /evaluation/$TASK/submit answered $submit_status"
elif [[ "$template_status" != 200 || "$template_type" != text/csv* || ! -s "$WORK/template.csv" ]]; then
  fail "5 evaluation task: the file template /evaluation/$TASK/template.csv answered $template_status $template_type"
elif [[ "$api_status" != 200 ]]; then
  fail "5 evaluation task: GET /v2/evaluation/tasks/$TASK answered $api_status: $(excerpt "$WORK/task.json")"
elif ! jq -e --arg slug "$TASK" '.slug == $slug and (.itemCount // 0) > 0' \
  "$WORK/task.json" >/dev/null 2>&1; then
  fail "5 evaluation task: $TASK has no items to score against"
elif jq -e 'has("groundTruth")' "$WORK/task.json" >/dev/null 2>&1; then
  fail "5 evaluation task: the public task response carries the answer key"
else
  pass "5 evaluation task: task page, submit page and file template render, $(jq -r '"\(.itemCount) items, \(.submissions | length) results listed"' "$WORK/task.json")"
fi

# -- 6 and 7. Submissions -------------------------------------------------------
submit_url="$API_URL/v2/evaluation/tasks/$TASK/submissions"

# A predictions file is either the JSON body of a submission, or the file a
# participant uploads in the browser: a header line, then `item_id,label`
# (comma or semicolon). The second is turned into the first here.
BODY="$WORK/body.json"
if [[ "$READ_ONLY" == true || ! -r "$PREDICTIONS" ]]; then
  : >"$BODY"
elif [[ "$PREDICTIONS" == *.csv ]]; then
  jq -R -s -c --arg name "$METHOD_NAME" '
    [split("\n")[] | sub("\r$"; "") | select(length > 0)] | .[1:]
    | map(split("[,;]"; null) | {imageId: .[0], grade: (.[1] | tonumber)})
    | {methodName: $name, predictions: .}' "$PREDICTIONS" >"$BODY" 2>/dev/null || : >"$BODY"
else
  cp "$PREDICTIONS" "$BODY"
fi

if [[ "$READ_ONLY" == true ]]; then
  skip "6 validation submission (--read-only)"
  skip "7 scored submission (--read-only)"
elif ! jq -e 'type == "object" and (.predictions | type == "array" and length > 0)' "$BODY" >/dev/null 2>&1; then
  fail "6 validation submission: not a readable predictions file (a JSON submission body, or a .csv with a header and item_id,label rows): $PREDICTIONS"
  if [[ "$SCORED" == true ]]; then
    fail "7 scored submission: no predictions file, nothing was sent"
  else
    skip "7 scored submission (not requested; --scored spends one scored submission)"
  fi
else
  # 6. Checked against the task and discarded by the API.
  jq -c '. + {intent: "VALIDATION"}' "$BODY" >"$WORK/validation.json"
  status="$(http_post_json "$submit_url" "$WORK/validation.json" "$WORK/validation.out")"
  if [[ "$status" != 2* ]]; then
    fail "6 validation submission: answered $status: $(excerpt "$WORK/validation.out")"
  elif ! jq -e '.intent == "VALIDATION" and .ok == true and .quotaConsumed == false and .submissionId == null' \
    "$WORK/validation.out" >/dev/null 2>&1; then
    fail "6 validation submission: the file does not fit the task: $(jq -c '[.checks[]? | select(.ok != true) | .name]' "$WORK/validation.out" 2>/dev/null || excerpt "$WORK/validation.out")"
  else
    pass "6 validation submission: accepted for $TASK, nothing stored, no quota spent"
  fi

  # 7. Opt-in, because it spends quota and is listed publicly.
  if [[ "$SCORED" != true ]]; then
    skip "7 scored submission (not requested; --scored spends one scored submission)"
  elif [[ -z "$TOKEN" ]]; then
    SCORED_NOT_MADE=true
    skip "7 scored submission (no token): set and export OCI_SMOKE_TOKEN"
  elif [[ ! "$TOKEN" =~ ^[A-Za-z0-9._~+/=:-]+$ ]]; then
    # The token goes into a curl config line; anything outside the
    # characters a bearer token is made of is refused, and not shown.
    fail "7 scored submission: OCI_SMOKE_TOKEN holds characters a token does not have, nothing was sent"
  elif [[ "$API_URL" != https://* && ! "$API_URL" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]]; then
    fail "7 scored submission: refusing to send a token over plain http to $API_URL"
  else
    jq -c --arg name "$METHOD_NAME" '. + {intent: "SCORED", methodName: $name}' \
      "$BODY" >"$WORK/scored.json"
    status="$(http_post_json "$submit_url" "$WORK/scored.json" "$WORK/scored.out" "$TOKEN")"
    if [[ "$status" == 2* ]] && jq -e '(.id | type == "string") and (.scores != null)' \
      "$WORK/scored.out" >/dev/null 2>&1; then
      pass "7 scored submission: scored as \"$METHOD_NAME\", id $(jq -r '.id' "$WORK/scored.out"). One scored submission spent."
    elif [[ "$status" == 401 ]]; then
      fail "7 scored submission: 401, the token was refused (they last an hour)"
    else
      # A quota refusal lands here too, as a 403 whose message says when
      # the limit resets.
      fail "7 scored submission: answered $status: $(excerpt "$WORK/scored.out")"
    fi
  fi
fi

echo
echo "$PASSED passed, $FAILED failed, $SKIPPED skipped"
if [[ "$SCORED_NOT_MADE" == true ]]; then
  echo "Note: --scored was asked for, but no scored submission was made."
fi
if ((FAILED > 0)); then
  exit 1
fi
