# Roadmap

What Yotsuba-IB has today, and what it's missing compared with a mature imageboard such as 4chan.
Items are roughly ordered by priority within each section.

## Done

- [x] Boards with slug, title and bio, managed from the admin panel
- [x] Anonymous threads and replies, bumping, bump limit, pagination, pruning of old threads by count
- [x] Image/GIF/video uploads (jpg, png, gif, webp, mp4, webm) with content-based type detection
- [x] `>greentext`, `>>123` quote links, auto-linked URLs, click-to-expand images
- [x] Owner + staff accounts with per-user permissions, account disabling with reasons, renames and password resets
- [x] Post logs (IP, user agent, content, upload), switchable on/off
- [x] Staff activity (audit) log visible to the owner
- [x] Retention settings: inactive thread purge, upload expiry, log expiry
- [x] Per-IP post cooldown
- [x] install.sh / update.sh / uninstall.sh with a systemd service

## Moderation & anti-abuse (highest priority for a public site)

- [x] **Bans** by IP, IP range (CIDR) and **country**, blocking posting or all site access, with duration, reason and a "you are banned" page; ban straight from a post or an alert
- [x] **Keyword alerts**: words, sentences or regexes that alert staff in real time (live notifications), or block the post
- [x] **Reports**: users report posts; reports land in the staff alert queue
- [x] **File hash bans**: block known-bad files by SHA-256 (removes all existing copies)
- [x] Sticky and locked threads
- [x] Delete only a post's file while keeping its text
- [x] Login rate limiting (10 failures per 15 min per IP/username), failed logins in the staff activity log
- [ ] **CAPTCHA** on posting (self-hosted, or hCaptcha/Turnstile)
- [x] Perceptual-hash file bans (catch resized/re-encoded copies of banned images)
- [x] Spam heuristics: link limits, duplicate-text detection, per-board flood detection across IPs
- [x] Separate cooldowns for threads, replies and uploads; per-board cooldown overrides
- [x] Ban appeals (from the ban page; accept lifts the ban, deny with a response; max 2 per ban)
- [x] Staff capcodes ("## Admin" for the owner, "## Mod" for staff)
- [x] Users can delete their own posts or files (with a deletion password remembered by the browser)
- [x] Moving threads between boards
- [x] CSRF tokens on every form submitted with a staff session
- [ ] Two-factor authentication for staff accounts
- [ ] Perceptual hashing for video files (currently exact SHA-256 only)
- [ ] Custom capcode labels per staff account

## Posting features

- [x] **Thumbnails** generated server-side for images (sharp) and video first frames (ffmpeg)
- [x] Strip EXIF/metadata (GPS!) from uploaded images, and metadata tags from videos
- [x] Tripcodes (`Name#pass`) and secure tripcodes (`Name##pass`, keyed by a server secret)
- [x] Options field: `sage` (reply without bumping), `nonoko` (return to the board)
- [x] Spoiler images and `[spoiler]` text
- [x] `[code]` blocks, `>>>/board/123` cross-board links
- [x] Country flags and per-thread poster IDs (optional per board; click an ID to highlight its posts)
- [x] Image/video dimensions in file info
- [x] Post preview on quote-link hover, "(You)" markers, backlinks showing who replied
- [ ] Multiple files per post
- [ ] Audio (mp3/ogg) and PDF uploads
- [ ] Oekaki / drawing board

## Browsing

- [x] **Catalog view** with sort (bump / new / replies) and a live filter
- [x] Thread auto-update (polling with backoff), reply counter, unread count in the tab title
- [x] Inline quick-reply box (click a post number; quotes selected text)
- [x] Archive of pruned and inactive threads (read-only, kept for a configurable number of days)
- [x] Search (subject + comment, per board or site-wide)
- [x] Mobile-friendly layout
- [x] Theme switcher (Yotsuba, Yotsuba B, Tomorrow/dark)
- [x] Board categories and ordering on the home page; hidden boards
- [x] Rules per board, a site FAQ page and a dismissible global announcement
- [x] RSS feed per board
- [x] Full-size image/video preview on thumbnail hover (opt-in in settings)
- [x] Video sound: unmute-by-default and a remembered volume (settings)
- [x] Image banners per board
- [x] Thread watcher (followed threads with unread counts)
- [x] Hide posts manually or with filters (text, /regex/, name:, trip:, id:)

## Board configuration

- [x] Per-board settings: NSFW flag, max file size, allowed file types, text-only boards, required subject,
      bump limit, image limit, threads per page, forced anonymity
- [x] Per-board staff permissions (board-scoped moderators / "janitors")
- [x] Image banners per board
- [ ] Board-scoped bans (bans are currently site-wide)

## Platform & operations

- [x] JSON read API (boards, catalog, threads, archive), like 4chan's API
- [x] Docker image and docker-compose example
- [x] Scheduled database snapshots, plus `backup` / `restore` commands for full backups
- [x] Prometheus metrics (`/metrics`) and a health-check endpoint (`/healthz`)
- [x] Automated test suite (`npm test`) and CI (GitHub Actions: tests on Node 22/24, Docker smoke test)
- [x] npm package metadata ready (`npm publish` must be run by the maintainer)
- [x] Birthday hats: date, hat style and colour set in the admin panel
- [ ] Object-storage uploads (S3-compatible) and a CDN-friendly media domain
- [ ] Off-site backup targets (S3, rsync)
