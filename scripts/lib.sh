#!/usr/bin/env bash
. "$(dirname "$0")/env.sh"
BASE="${MINICPM_HOME:-$HOME/minicpm}"
LLAMA_COMMON=(--jinja --temp "$MINICPM_TEMP" --top-p "$MINICPM_TOP_P")

acquire_lock() {
  local name="$1"
  mkdir -p "$BASE/logs"
  exec 9>"$BASE/logs/$name.lock"
  flock -n 9
}

rotate_log() {
  local log="$1" size="${2:-10485760}" keep="${3:-3}"
  [ -f "$log" ] || return 0
  local bytes
  bytes=$(wc -c < "$log")
  [ "$bytes" -lt "$size" ] && return 0
  local i
  for i in $(seq "$((keep - 1))" -1 1); do
    [ -f "$log.$i" ] && mv -f "$log.$i" "$log.$((i + 1))"
  done
  mv -f "$log" "$log.1"
}