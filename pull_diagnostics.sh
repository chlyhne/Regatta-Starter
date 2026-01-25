#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--delete] [prefix]" >&2
  echo "Example: $0 rt-DEVICE-ID/sess-SESSION-ID" >&2
  echo "Example: $0 --delete rt-DEVICE-ID/sess-SESSION-ID" >&2
  echo "Example: $0 --delete-with-wrangler rt-DEVICE-ID/sess-SESSION-ID" >&2
}

ENV_FILE="${ENV_FILE:-.env.local}"
OUT_DIR="${OUT_DIR:-diagnostics-downloads}"
BUCKET="${R2_BUCKET:-racetimer-diag}"
ACCOUNT_ID="${R2_ACCOUNT_ID:-}"
ACCESS_KEY="${R2_ACCESS_KEY_ID:-}"
SECRET_KEY="${R2_SECRET_ACCESS_KEY:-}"
PREFIX="${R2_PREFIX:-}"
DELETE_AFTER=0
DELETE_MODE="auto"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --delete|--delete-remote|--purge)
      DELETE_AFTER=1
      shift
      ;;
    --delete-with-wrangler|--delete-wrangler|--wrangler)
      DELETE_AFTER=1
      DELETE_MODE="wrangler"
      shift
      ;;
    --delete-signed)
      DELETE_AFTER=1
      DELETE_MODE="signed"
      shift
      ;;
    *)
      if [[ -z "${PREFIX:-}" ]]; then
        PREFIX="$1"
        shift
      else
        echo "Unexpected argument: $1" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  ACCOUNT_ID="${R2_ACCOUNT_ID:-${ACCOUNT_ID}}"
  ACCESS_KEY="${R2_ACCESS_KEY_ID:-${ACCESS_KEY}}"
  SECRET_KEY="${R2_SECRET_ACCESS_KEY:-${SECRET_KEY}}"
  BUCKET="${R2_BUCKET:-${BUCKET}}"
  PREFIX="${R2_PREFIX:-${PREFIX}}"
fi

if [[ -z "${ACCOUNT_ID}" || -z "${ACCESS_KEY}" || -z "${SECRET_KEY}" ]]; then
  echo "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY (or use ${ENV_FILE})." >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

export OUT_DIR
export R2_ACCOUNT_ID="${ACCOUNT_ID}"
export R2_ACCESS_KEY_ID="${ACCESS_KEY}"
export R2_SECRET_ACCESS_KEY="${SECRET_KEY}"
export R2_BUCKET="${BUCKET}"
export R2_PREFIX="${PREFIX}"
export R2_DELETE_AFTER="${DELETE_AFTER}"
export R2_DELETE_MODE="${DELETE_MODE}"

python3 - <<'PY'
import os
import sys
import time
import hmac
import hashlib
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

bucket = os.environ.get("R2_BUCKET", "racetimer-diag")
account_id = os.environ.get("R2_ACCOUNT_ID")
access_key = os.environ.get("R2_ACCESS_KEY_ID")
secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
prefix = os.environ.get("R2_PREFIX", "")
delete_after = os.environ.get("R2_DELETE_AFTER", "").lower() in ("1", "true", "yes", "on")
delete_mode = os.environ.get("R2_DELETE_MODE", "auto").lower()
out_dir = os.environ.get("OUT_DIR", "diagnostics-downloads")
region = "auto"
service = "s3"
wrangler_bin = os.environ.get("R2_WRANGLER", "wrangler")

if not account_id or not access_key or not secret_key:
  sys.stderr.write("Missing required R2 credentials in environment.\n")
  sys.exit(1)

endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
host = f"{account_id}.r2.cloudflarestorage.com"
ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"

def sign(key, msg):
  return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

def get_signature_key(key, date_stamp, region_name, service_name):
  k_date = sign(("AWS4" + key).encode("utf-8"), date_stamp)
  k_region = hmac.new(k_date, region_name.encode("utf-8"), hashlib.sha256).digest()
  k_service = hmac.new(k_region, service_name.encode("utf-8"), hashlib.sha256).digest()
  return hmac.new(k_service, b"aws4_request", hashlib.sha256).digest()

def build_auth(method, canonical_uri, query, amz_date, date_stamp):
  canonical_query = "&".join(
    f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
    for k, v in sorted(query.items())
  )
  canonical_headers = (
    f"host:{host}\n"
    f"x-amz-content-sha256:UNSIGNED-PAYLOAD\n"
    f"x-amz-date:{amz_date}\n"
  )
  signed_headers = "host;x-amz-content-sha256;x-amz-date"
  payload_hash = "UNSIGNED-PAYLOAD"
  canonical_request = "\n".join(
    [method, canonical_uri, canonical_query, canonical_headers, signed_headers, payload_hash]
  )
  credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
  string_to_sign = "\n".join(
    [
      "AWS4-HMAC-SHA256",
      amz_date,
      credential_scope,
      hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ]
  )
  signing_key = get_signature_key(secret_key, date_stamp, region, service)
  signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
  authorization_header = (
    f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
    f"SignedHeaders={signed_headers}, Signature={signature}"
  )
  return authorization_header, canonical_query

def signed_request(method, path, query):
  now = time.gmtime()
  amz_date = time.strftime("%Y%m%dT%H%M%SZ", now)
  date_stamp = time.strftime("%Y%m%d", now)
  canonical_uri = urllib.parse.quote(path, safe="/-_.~")
  auth, canonical_query = build_auth(method, canonical_uri, query, amz_date, date_stamp)
  url = f"{endpoint}{canonical_uri}"
  if canonical_query:
    url += "?" + canonical_query
  headers = {
    "Host": host,
    "x-amz-date": amz_date,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "Authorization": auth,
  }
  req = urllib.request.Request(url, method=method, headers=headers)
  return urllib.request.urlopen(req)

def list_keys():
  keys = []
  token = None
  while True:
    query = {"list-type": "2"}
    if prefix:
      query["prefix"] = prefix
    if token:
      query["continuation-token"] = token
    with signed_request("GET", f"/{bucket}", query) as resp:
      data = resp.read()
    root = ET.fromstring(data)
    for contents in root.findall(f"{ns}Contents"):
      key = contents.find(f"{ns}Key")
      if key is not None and key.text:
        keys.append(key.text)
    truncated = root.find(f"{ns}IsTruncated")
    if truncated is not None and truncated.text == "true":
      next_token = root.find(f"{ns}NextContinuationToken")
      token = next_token.text if next_token is not None else None
      if not token:
        break
    else:
      break
  return keys

def safe_join(base, path):
  norm = os.path.normpath(os.path.join(base, path))
  base_abs = os.path.abspath(base) + os.sep
  if not os.path.abspath(norm).startswith(base_abs):
    raise ValueError("Invalid key path")
  return norm

def download_key(key):
  dest = safe_join(out_dir, key)
  os.makedirs(os.path.dirname(dest), exist_ok=True)
  if os.path.exists(dest):
    print(f"skip {key}")
    if delete_after:
      delete_key(key)
    return
  with signed_request("GET", f"/{bucket}/{key}", {}) as resp, open(dest, "wb") as f:
    while True:
      chunk = resp.read(1024 * 256)
      if not chunk:
        break
      f.write(chunk)
  print(f"saved {key}")
  if delete_after:
    delete_key(key)

def delete_with_wrangler(key):
  import shutil
  import subprocess

  base_cmd = None
  if shutil.which(wrangler_bin):
    base_cmd = [wrangler_bin, "r2", "object", "delete"]
  elif shutil.which("npx"):
    base_cmd = ["npx", "--yes", "wrangler", "r2", "object", "delete"]
  else:
    raise RuntimeError("wrangler not found (install it or ensure npx is available)")

  attempts = [
    base_cmd + [bucket, "--key", key],
    base_cmd + [bucket, key],
    base_cmd + ["--bucket", bucket, "--key", key],
  ]
  last_error = None
  for cmd in attempts:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
      return
    message = (result.stderr or result.stdout or "").strip()
    last_error = message or "wrangler delete failed"
    if "Unknown argument" in last_error or "unknown argument" in last_error:
      continue
    raise RuntimeError(last_error)
  raise RuntimeError(last_error or "wrangler delete failed")

def delete_key(key):
  if delete_mode in ("wrangler", "auto"):
    try:
      delete_with_wrangler(key)
      print(f"deleted {key}")
      return
    except Exception as exc:
      if delete_mode == "wrangler":
        sys.stderr.write(f"delete failed {key}: {exc}\n")
        return
      sys.stderr.write(f"wrangler delete failed {key}: {exc}\n")
  try:
    with signed_request("DELETE", f"/{bucket}/{key}", {}) as resp:
      resp.read()
    print(f"deleted {key}")
  except Exception as exc:
    sys.stderr.write(f"delete failed {key}: {exc}\n")

keys = list_keys()
if not keys:
  print("No objects found.")
  sys.exit(0)

print(f"Found {len(keys)} objects.")
for key in keys:
  download_key(key)
PY
