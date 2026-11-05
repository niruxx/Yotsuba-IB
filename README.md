# Yotsuba-IB

A self-hosted anonymous imageboard you can start with one command.

- Anonymous posting with threads, replies, `>greentext` and `>>123` quote links
- Image and video uploads (jpg, png, gif, webp, mp4, webm). File types are checked by their content, not by the client's word
- **Owner account** created on first run, plus **staff accounts** with permissions granted user-by-user
- Admin panel: boards (`/slug/` + title + bio), post deletion, settings, accounts, logs
- **Post logs**: IP address, user agent, content and upload of every thread and reply (can be switched on/off)
- **Staff activity log**: the owner sees every action other staff take
- **Retention settings**: purge inactive threads after N days, delete uploads after N days, expire logs
- Bumping, a bump limit, auto-pruning of old threads, cooldowns and spam controls
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
yotsuba-ib [add-admin | reset-password <user> | update-geoip] [options]
  -p, --port <n>        Port (default 8420)
      --host <addr>     Bind address (default 0.0.0.0)
  -d, --data <dir>      Data directory (default ./yotsuba-data)
      --name <text>     Site name
      --max-file-mb <n> Upload limit in MB (default 20)
      --trust-proxy     Read the client IP from X-Forwarded-For (use behind nginx/Caddy)
```

## Posting & browsing

- **Posting**: tripcodes (`Name#pass`, secure `Name##pass`), options (`sage`, `nonoko`), spoiler images, `[spoiler]` and `[code]` tags, `>>>/board/123` links, a deletion password.
- **Uploads**: EXIF/GPS and video metadata are stripped, dimensions recorded and thumbnails generated (sharp for images, ffmpeg for videos). Without them, files are stored as-is and shown full-size.
- **Boards**: index, catalog (sortable, filterable), read-only archive, search, RSS (`/board/rss.xml`), optional rules, categories, ordering, poster IDs and country flags (configured per board).
- **Threads**: auto-update, quick reply (click a post number), hover previews of quoted posts, backlinks and "(You)" markers.
- **Per-browser settings** (top-right "settings"): theme (Yotsuba, Yotsuba B, Tomorrow), full-size preview on hover, video sound and volume, auto-update.
- **Site-wide**: an announcement banner and a `/faq` page, both edited in admin Settings.

## Operations

- **Docker**: `docker compose up -d` (edit the owner credentials in `docker-compose.yml` first). Data lives in the `yotsuba-data` volume.
- **Backups**: automatic database snapshots go to `<data>/backups/` (interval and count in Settings).
  `yotsuba-ib backup [file.tar.gz]` makes a full backup (database + uploads + banners) while running;
  `yotsuba-ib restore <file>` restores one (stop the server first; the old data is moved aside, not deleted).
  For systemd installs run these as the service user, e.g. `sudo -u yotsuba node /opt/yotsuba-ib/bin/cli.js backup --data /opt/yotsuba-ib-data`.
- **Monitoring**: `GET /healthz` (JSON) and `GET /metrics` (Prometheus). `/metrics` only answers localhost unless
  `YOTSUBA_METRICS_TOKEN` is set, in which case send `Authorization: Bearer <token>`.
- **JSON API** (read-only, CORS-enabled, hidden boards excluded): `/api/boards.json`, `/api/<board>/catalog.json`,
  `/api/<board>/threads/<id>.json`, `/api/<board>/archive.json`.
- **Tests**: `npm test` (Node's built-in test runner; unit tests plus an end-to-end run against a temporary server). CI runs them on every push.

## Upload storage

Uploads are stored per thread, named so staff with server access can see who uploaded what:

```
uploads/threads/<threadId>-<subject>.<OP's IP>/post-image-<IP>.<ext>          # thread's opening image
uploads/threads/<threadId>-<subject>.<OP's IP>/<postId>.imagefile.<IP>.<ext>   # each reply's file
```

This folder is **never served directly**. The site serves files as `/media/<postId>.<ext>`, so visitors never see IPs.
When post logging is switched off, `nolog` is written in place of the IP. Deleting a thread deletes its folder.

## Roles and permissions

The first account is the **owner** and can do everything: create and edit boards, change settings, view post logs,
create staff accounts, grant permissions one by one, rename accounts, reset passwords, disable accounts (with a reason)
and view the staff activity log. Staff accounts start with no permissions. The owner can grant any of these:

| Permission | Allows |
|---|---|
| `delete_posts` | Delete posts and threads |
| `view_logs` | View post logs, including IP addresses |
| `manage_boards` | Create, edit and delete boards |
| `manage_settings` | Turn logging on/off, change retention periods, GeoIP header |
| `view_alerts` | Live notifications for keyword matches, blocked posts and user reports |
| `manage_filters` | Add/remove keyword alert and block rules |
| `manage_bans` | Ban IPs, IP ranges, countries and files; handle appeals |

Any staff account can be limited to specific boards ("Limit to boards" on the Accounts page). Its post, alert and
log permissions then only apply to those boards, which makes it a board janitor/moderator.

## Moderation

- **Keyword rules** (`/admin/filters`): a word, sentence or regex. *Alert* lets the post through and notifies staff; *block* rejects it and notifies staff.
- **Alerts** (`/admin/alerts`): keyword matches, blocked posts and user reports. Staff with `view_alerts` get a live counter and pop-ups on every page (and optional desktop notifications), then resolve, delete or ban from there.
- **Bans** (`/admin/bans`): IP, CIDR range or country; blocks posting or all access; 1 hour to permanent. Each post has a staff menu for delete / delete file / sticky / lock / ban / ban file.
- **Spam controls** (Settings): separate thread/reply/upload cooldowns (boards can override thread/reply), max links per post, duplicate-text rejection, and a per-board flood limit across all IPs.
- **File bans** block the exact file (SHA-256) and, for images, visually similar copies (perceptual hash; needs the optional `sharp` package, installed automatically on common platforms).
- **Ban appeals**: banned users can appeal from the ban page; appeals show up as alerts and on the Bans page.
- **Capcodes**: logged-in staff can tick "Post with staff capcode" to post as `## Admin` (owner) or `## Mod`.
- **Self-deletion**: posters can delete their own posts with a deletion password their browser remembers.
- **Country bans** need a country source: run `yotsuba-ib update-geoip` (downloads the free [DB-IP](https://db-ip.com) Lite database, CC BY 4.0; `install.sh` and `update.sh` do this for you), or set your CDN's header (e.g. `CF-IPCountry`) in Settings with `--trust-proxy`. Logged-in staff are never blocked by access bans.

Locked out? `yotsuba-ib reset-password <username> --data <dir>` (as the service user for systemd installs).

## Production notes

- Post logging stores raw IP addresses. Check the privacy law that applies to you (e.g. GDPR) and set a log retention period.
- Run it behind a reverse proxy with HTTPS (Caddy is the easiest) and pass `--trust-proxy`.
- Back up the data directory. It holds the database and all uploads.
- You are responsible for moderating what users upload to your site.
