#!/usr/bin/env bash
# Yotsuba-IB installer: detects the distro, installs Node.js 22+ and git,
# clones the app to /opt, creates a service user, an owner account and a systemd service.
set -euo pipefail

APP=yotsuba-ib
INSTALL_DIR=/opt/$APP
DATA_DIR=/opt/$APP-data
CONF_DIR=$INSTALL_DIR/config
ENV_FILE=$CONF_DIR/yotsuba.env
SERVICE_USER=yotsuba
UNIT=/etc/systemd/system/$APP.service
NODE_MAJOR=22
NODE_MIN="22.13.0"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
c_warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die()    { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }
ask()    { local p="$1" d="${2:-}" r; read -r -p "$p${d:+ [$d]}: " r; echo "${r:-$d}"; }

[[ $EUID -eq 0 ]] || die "Run as root: sudo ./install.sh"
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || die "systemd is required (not found on this system)."
[[ -e $UNIT ]] && die "Already installed. Use ./update.sh to update, or ./uninstall.sh first."

# ---------- detect OS ----------
[[ -r /etc/os-release ]] || die "Cannot read /etc/os-release; unsupported OS."
. /etc/os-release
OS_IDS=" ${ID:-} ${ID_LIKE:-} "
case "$OS_IDS" in
  *" arch "*|*" manjaro "*|*" endeavouros "*) FAMILY=arch ;;
  *" debian "*|*" ubuntu "*)                  FAMILY=debian ;;
  *" fedora "*|*" rhel "*|*" centos "*)       FAMILY=rhel ;;
  *" suse "*|*" opensuse"*|*" sles "*)        FAMILY=suse ;;
  *) die "Unsupported distro: ${PRETTY_NAME:-$ID}. Supported: Arch, Debian/Ubuntu, Fedora/RHEL/Rocky/Alma, openSUSE." ;;
esac
c_info "Detected ${PRETTY_NAME:-$ID} (family: $FAMILY)"

node_ok() {
  command -v node >/dev/null || return 1
  local v; v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  [[ "$(printf '%s\n%s\n' "$NODE_MIN" "$v" | sort -V | head -n1)" == "$NODE_MIN" ]]
}

# ---------- install dependencies ----------
c_info "Installing dependencies (git, curl, ffmpeg, Node.js >= $NODE_MIN)"
case $FAMILY in
  arch)
    pacman -Sy --needed --noconfirm git curl nodejs npm ffmpeg ;;
  debian)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get install -y git curl ca-certificates gnupg ffmpeg
    if ! node_ok; then
      c_info "Adding NodeSource repository for Node.js $NODE_MAJOR"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      apt-get install -y nodejs
    fi ;;
  rhel)
    PM=dnf; command -v dnf >/dev/null || PM=yum
    $PM install -y git curl ca-certificates
    $PM install -y ffmpeg-free 2>/dev/null || $PM install -y ffmpeg 2>/dev/null \
      || c_warn "ffmpeg not available (enable RPM Fusion/EPEL for it); video thumbnails will be skipped."
    if ! node_ok; then
      $PM module reset -y nodejs >/dev/null 2>&1 || true
      $PM install -y "nodejs >= $NODE_MAJOR" >/dev/null 2>&1 || true
    fi
    if ! node_ok; then
      c_info "Adding NodeSource repository for Node.js $NODE_MAJOR"
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      $PM install -y nodejs
    fi ;;
  suse)
    zypper --non-interactive refresh
    zypper --non-interactive install git curl
    zypper --non-interactive install ffmpeg 2>/dev/null || zypper --non-interactive install ffmpeg-7 2>/dev/null \
      || c_warn "ffmpeg not available (add the Packman repo for it); video thumbnails will be skipped."
    node_ok || zypper --non-interactive install "nodejs${NODE_MAJOR}" "npm${NODE_MAJOR}" ;;
esac
node_ok || die "Node.js >= $NODE_MIN could not be installed automatically (found: $(node -v 2>/dev/null || echo none)). Install it manually and re-run."
NODE_BIN="$(command -v node)"
c_info "Using Node $(node -v) at $NODE_BIN"

# ---------- configuration ----------
echo
c_info "Configuration"
PORT="$(ask 'Port to listen on' 8420)"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT > 0 && PORT < 65536 )) || die "Invalid port: $PORT"
HOST="$(ask 'Bind address (127.0.0.1 if behind a reverse proxy)' 0.0.0.0)"
SITE_NAME="$(ask 'Site name' 'Yotsuba-IB')"
PROXY="$(ask 'Will this run behind a reverse proxy like nginx or Caddy? (y/n)' n)"
MAX_MB="$(ask 'Max upload size in MB' 20)"
EXTRA_ARGS="--max-file-mb $MAX_MB"
[[ "$PROXY" =~ ^[Yy] ]] && EXTRA_ARGS="$EXTRA_ARGS --trust-proxy"

REPO_URL="${REPO_URL:-$(git -C "$SCRIPT_DIR" remote get-url origin 2>/dev/null || echo "$SCRIPT_DIR")}"
c_info "Source repository: $REPO_URL"

# ---------- user, code, data ----------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  c_info "Creating system user '$SERVICE_USER'"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
    || useradd -r -d "$DATA_DIR" -s /sbin/nologin "$SERVICE_USER"
fi

c_info "Cloning into $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
git config --system --add safe.directory "$INSTALL_DIR" 2>/dev/null || true

c_info "Installing npm packages"
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund)

mkdir -p "$DATA_DIR" "$CONF_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

cat > "$ENV_FILE" <<EOF
# Yotsuba-IB service configuration. Restart after editing: systemctl restart $APP
PORT=$PORT
HOST=$HOST
YOTSUBA_DATA=$DATA_DIR
YOTSUBA_NAME=$SITE_NAME
YOTSUBA_ARGS=$EXTRA_ARGS
EOF
chmod 640 "$ENV_FILE"
chgrp "$SERVICE_USER" "$ENV_FILE"

c_info "Downloading the GeoIP country database (used for country bans)"
sudo_as() { runuser -u "$SERVICE_USER" -- "$@" 2>/dev/null || su -s /bin/sh "$SERVICE_USER" -c "$(printf '%q ' "$@")"; }
sudo_as "$NODE_BIN" "$INSTALL_DIR/bin/cli.js" update-geoip --data "$DATA_DIR" \
  || c_warn "GeoIP download failed; country bans won't work until you run: $NODE_BIN $INSTALL_DIR/bin/cli.js update-geoip --data $DATA_DIR"

# ---------- owner account ----------
echo
c_info "Create the owner account (full control of the site)"
sudo_as "$NODE_BIN" "$INSTALL_DIR/bin/cli.js" add-admin --data "$DATA_DIR"

# ---------- systemd ----------
c_info "Writing $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=Yotsuba-IB imageboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/bin/cli.js \$YOTSUBA_ARGS
Restart=on-failure
RestartSec=5

# Hardening: the service can only write to its data directory.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$APP"

# ---------- firewall ----------
if [[ "$HOST" != "127.0.0.1" ]]; then
  if command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    [[ "$(ask "Open port $PORT in firewalld? (y/n)" y)" =~ ^[Yy] ]] && \
      firewall-cmd --permanent --add-port="$PORT/tcp" && firewall-cmd --reload
  elif command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
    [[ "$(ask "Open port $PORT in ufw? (y/n)" y)" =~ ^[Yy] ]] && ufw allow "$PORT/tcp"
  fi
fi

sleep 2
if systemctl is-active --quiet "$APP"; then
  echo
  c_info "Yotsuba-IB is running."
  echo "    Site:    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):$PORT"
  echo "    Admin:   /admin"
  echo "    Logs:    journalctl -u $APP -f"
  echo "    Config:  $ENV_FILE"
  echo "    Data:    $DATA_DIR"
else
  c_warn "Service failed to start. Check: journalctl -u $APP -e"
  exit 1
fi
