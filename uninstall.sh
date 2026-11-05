#!/usr/bin/env bash
# Yotsuba-IB uninstaller: removes the service, code, database, uploads, post logs,
# backups, config, service user and the service's journal logs. This cannot be undone.
set -euo pipefail

APP=yotsuba-ib
INSTALL_DIR=/opt/$APP
DATA_DIR=/opt/$APP-data
CONF_DIR=$INSTALL_DIR/config
SERVICE_USER=yotsuba
UNIT=/etc/systemd/system/$APP.service
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo ./uninstall.sh"

cat <<EOF
This will PERMANENTLY delete:
  - the $APP systemd service        ($UNIT)
  - the application code (git clone) ($INSTALL_DIR)
  - the database, all uploads, post logs, staff activity logs and backups ($DATA_DIR)
  - the configuration                ($CONF_DIR)
  - the '$SERVICE_USER' system user
  - the service's journal logs
Node.js and git are left installed, since other software may use them.
EOF
read -r -p "Type 'delete everything' to continue: " CONFIRM
[[ "$CONFIRM" == "delete everything" ]] || die "Aborted. Nothing was removed."

if systemctl list-unit-files "$APP.service" >/dev/null 2>&1; then
  c_info "Stopping and disabling service"
  systemctl disable --now "$APP" 2>/dev/null || true
fi
rm -f "$UNIT"
systemctl daemon-reload
systemctl reset-failed "$APP" 2>/dev/null || true

c_info "Removing journal logs for $APP"
journalctl --rotate >/dev/null 2>&1 || true
# journald can't delete a single unit's entries; drop archived journal files that contain only this unit.
for j in /var/log/journal/*/*.journal; do
  [[ -f $j ]] || continue
  [[ $j == */system.journal || $j == */user-*.journal ]] && continue
  units="$(journalctl --file "$j" -F _SYSTEMD_UNIT 2>/dev/null | sort -u)"
  [[ "$units" == "$APP.service" ]] && rm -f "$j"
done

c_info "Removing files"
rm -rf "$INSTALL_DIR" "$DATA_DIR" "$CONF_DIR"

if id "$SERVICE_USER" >/dev/null 2>&1; then
  c_info "Removing user '$SERVICE_USER'"
  userdel "$SERVICE_USER" 2>/dev/null || true
fi

c_info "If you opened a firewall port for Yotsuba-IB, close it manually (firewall-cmd --remove-port / ufw delete allow)."

# Also offer to delete the checkout this script was run from (if it isn't the install dir).
if [[ "$SCRIPT_DIR" != "$INSTALL_DIR" && -d "$SCRIPT_DIR/.git" && -f "$SCRIPT_DIR/package.json" ]] \
   && grep -q '"name": "yotsuba-ib"' "$SCRIPT_DIR/package.json"; then
  read -r -p "Also delete the source checkout at $SCRIPT_DIR (including any ./yotsuba-data inside it)? [y/N]: " DEL_SRC
  if [[ "$DEL_SRC" =~ ^[Yy] ]]; then
    cd /
    rm -rf "$SCRIPT_DIR"
    c_info "Deleted $SCRIPT_DIR"
  fi
fi

c_info "Yotsuba-IB has been completely removed."
