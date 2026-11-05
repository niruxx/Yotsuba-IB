#!/usr/bin/env bash
# Yotsuba-IB updater: pulls the latest code and reinstalls npm packages.
# The data directory (database, uploads, post logs) and the config file are never touched.
# A database backup is made before every update.
set -euo pipefail

APP=yotsuba-ib
INSTALL_DIR=/opt/$APP
DATA_DIR=/opt/$APP-data
BACKUP_DIR=$DATA_DIR/backups

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo ./update.sh"
[[ -d $INSTALL_DIR/.git ]] || die "No installation found at $INSTALL_DIR. Run ./install.sh first."
cd "$INSTALL_DIR"

OLD_REV="$(git rev-parse --short HEAD)"
c_info "Fetching updates (current: $OLD_REV)"
git fetch --depth 1 origin
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$(git rev-parse HEAD)" == "$(git rev-parse "origin/$BRANCH")" ]]; then
  c_info "Already up to date."
  exit 0
fi

c_info "Stopping service"
systemctl stop "$APP"
trap 'c_info "Starting service"; systemctl start "$APP"' EXIT

if [[ -f $DATA_DIR/yotsuba.sqlite ]]; then
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  c_info "Backing up database to $BACKUP_DIR/yotsuba-$STAMP.sqlite"
  for f in yotsuba.sqlite yotsuba.sqlite-wal yotsuba.sqlite-shm; do
    [[ -f $DATA_DIR/$f ]] && cp -p "$DATA_DIR/$f" "$BACKUP_DIR/${f/yotsuba/yotsuba-$STAMP}"
  done
  chown -R "$(stat -c %U "$DATA_DIR"):" "$BACKUP_DIR"
  # keep the 10 most recent backups
  ls -1t "$BACKUP_DIR"/yotsuba-*.sqlite 2>/dev/null | tail -n +11 | while read -r old; do rm -f "$old" "$old-wal" "$old-shm"; done
fi

# Code lives in $INSTALL_DIR; data lives in $DATA_DIR, so a hard reset only affects code.
git reset --hard "origin/$BRANCH"
NEW_REV="$(git rev-parse --short HEAD)"

c_info "Installing npm packages"
npm install --omit=dev --no-audit --no-fund

c_info "Updated $OLD_REV → $NEW_REV"
git --no-pager log --oneline "$OLD_REV..$NEW_REV" 2>/dev/null | head -20 || true
