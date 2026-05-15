#!/usr/bin/env bash
# setup-internal.sh — wire the private companion repo into this checkout.
#
# The public oci-platform repo no longer ships `.claude/`,
# `docs/briefings/`, `docs/research/`, or `docs/planning/`. Those live
# in https://github.com/FG-AI4H/oci-platform-internal (private).
#
# This script clones that repo as a sibling and symlinks the four
# directories into the current checkout. Idempotent — re-running on
# an already-wired checkout is a no-op.
#
# Without Read access to oci-platform-internal the public repo still
# builds, tests, and deploys — only the project-scoped Claude Code
# skills and the partner-meeting / research docs are missing.

set -euo pipefail

readonly PUBLIC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PARENT_DIR="$(dirname "$PUBLIC_ROOT")"
readonly INTERNAL_DIR="$PARENT_DIR/oci-platform-internal"
readonly INTERNAL_URL="${OCI_INTERNAL_REPO_URL:-https://github.com/FG-AI4H/oci-platform-internal.git}"

readonly LINKS=(
  ".claude"
  "docs/briefings"
  "docs/research"
  "docs/planning"
)

info()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Clone (or update) the sister repo.
if [[ ! -d "$INTERNAL_DIR/.git" ]]; then
  info "Cloning $INTERNAL_URL → $INTERNAL_DIR"
  if ! git clone "$INTERNAL_URL" "$INTERNAL_DIR"; then
    fail "Could not clone $INTERNAL_URL. Confirm you have Read access on FG-AI4H/oci-platform-internal, or set OCI_INTERNAL_REPO_URL to your fork."
  fi
else
  info "Internal repo already present at $INTERNAL_DIR — skipping clone."
fi

# 2. Symlink each path. Refuse to clobber existing real directories.
for rel in "${LINKS[@]}"; do
  src="$INTERNAL_DIR/$rel"
  dst="$PUBLIC_ROOT/$rel"

  if [[ ! -e "$src" ]]; then
    warn "Source missing in internal repo: $src — skipping."
    continue
  fi

  if [[ -L "$dst" ]]; then
    info "Symlink already in place: $dst"
    continue
  fi

  if [[ -e "$dst" ]]; then
    fail "Refusing to overwrite real path $dst — move/delete it first if you mean to re-wire."
  fi

  mkdir -p "$(dirname "$dst")"
  ln -s "$src" "$dst"
  info "Linked $dst → $src"
done

info "Done. Internal content is now visible to this checkout."
