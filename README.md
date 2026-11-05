# Yotsuba-IB

A self-hosted anonymous imageboard you can start with one command.

- Anonymous posting with threads, replies, `>greentext` and `>>123` quote links
- Image and video uploads (jpg, png, gif, webp, mp4, webm). File types are checked by their content, not by the client's word
- **Owner account** created on first run, plus **staff accounts** with permissions granted user-by-user
- Admin panel: boards (`/slug/` + title + bio), post deletion, settings, accounts, logs
- **Post logs**: IP address, user agent, content and upload of every thread and reply (can be switched on/off)
- **Staff activity log**: the owner sees every action other staff take
- **Retention settings**: purge inactive threads after N days, delete uploads after N days, expire logs
- Bumping, a bump limit, auto-pruning of old threads and a per-IP post cooldown
- Stores everything in one SQLite file plus an uploads folder, using Node's built-in `node:sqlite` (no native build step)

## Install as a service (Linux)

```bash
git clone <this repo> && cd Yotsuba-IB
sudo ./install.sh     # detects Arch / Debian / Ubuntu / Fedora / RHEL / openSUSE, installs Node + git,
                      # creates the owner account and a systemd service (yotsuba-ib)
sudo ./update.sh      # git pull + npm install; database, uploads and logs are untouched (DB is backed up first)
sudo ./uninstall.sh   # removes EVERYTHING: service, code, database, uploads, logs, config, user
```

Layout: code in `/opt/yotsuba-ib`, data in `/opt/yotsuba-ib-data`, config in `/opt/yotsuba-ib/config/yotsuba.env`.
View logs with `journalctl -u yotsuba-ib -f`.

## Quick start (manual)

Requires **Node.js 22.13+**.

```bash
npx yotsuba-ib            # once published to npm
# or from this repo:
npm install && npm start
```

On first run you'll be asked for an admin username and password. Then open
`http://localhost:8420/admin`, log in, and create your first board.

For Docker or other non-interactive setups, set the admin account with environment variables:

```bash
YOTSUBA_ADMIN_USER=admin YOTSUBA_ADMIN_PASS='a-long-password' npx yotsuba-ib --port 8080
```

## Options

```
yotsuba-ib [add-admin | reset-password <user>] [options]
  -p, --port <n>        Port (default 8420)
      --host <addr>     Bind address (default 0.0.0.0)
  -d, --data <dir>      Data directory (default ./yotsuba-data)
      --name <text>     Site name
      --max-file-mb <n> Upload limit in MB (default 20)
      --cooldown <sec>  Seconds between posts per IP (default 15)
      --trust-proxy     Read the client IP from X-Forwarded-For (use behind nginx/Caddy)
```

## Roles and permissions

The first account is the **owner** and can do everything: create and edit boards, change settings, view post logs,
create staff accounts, grant permissions one by one, rename accounts, reset passwords, disable accounts (with a reason)
and view the staff activity log. Staff accounts start with no permissions. The owner can grant any of these:

| Permission | Allows |
|---|---|
| `delete_posts` | Delete posts and threads |
| `view_logs` | View post logs, including IP addresses |
| `manage_boards` | Create, edit and delete boards |
| `manage_settings` | Turn logging on/off, change retention periods |

Locked out? `yotsuba-ib reset-password <username> --data <dir>` (as the service user for systemd installs).

## Production notes

- Post logging stores raw IP addresses. Check the privacy law that applies to you (e.g. GDPR) and set a log retention period.
- Run it behind a reverse proxy with HTTPS (Caddy is the easiest) and pass `--trust-proxy`.
- Back up the data directory. It holds the database and all uploads.
- You are responsible for moderating what users upload to your site.
