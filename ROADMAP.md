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

- [ ] **Bans**: by IP and IP range, with duration, reason, and a "you are banned" page; ban straight from a post or the log
- [ ] **CAPTCHA** on posting (self-hosted, or hCaptcha/Turnstile)
- [ ] **Reports**: users report posts; a queue for staff
- [ ] **Duplicate-file and hash bans**: block known-bad files by SHA-256 / perceptual hash
- [ ] Word filters and spam filters (link limits, regex filters)
- [ ] Separate cooldowns for threads, replies and uploads; per-board rate limits
- [ ] Sticky and locked threads
- [ ] Staff capcodes ("## Mod")
- [ ] Delete only a post's file while keeping its text
- [ ] Users can delete their own posts (with a deletion password)
- [ ] Moving threads between boards
- [ ] CSRF tokens on admin forms (SameSite=Strict cookies cover modern browsers today)
- [ ] Two-factor authentication for staff accounts
- [ ] Login rate limiting / lockout

## Posting features

- [ ] **Thumbnails**: generated server-side for images and video first frames (sharp + ffmpeg)
- [ ] Strip EXIF/metadata (GPS!) from uploaded images
- [ ] Multiple files per post
- [ ] Tripcodes and secure tripcodes
- [ ] Sage (reply without bumping), options field (`sage`, `noko`)
- [ ] Spoiler images and `[spoiler]` text
- [ ] `[code]` blocks, `>>>/board/123` cross-board links
- [ ] Country flags / poster IDs per thread (optional per board)
- [ ] Image dimensions in file info; audio (mp3/ogg) and PDF support
- [ ] Post preview on quote-link hover; "(You)" markers; backlinks showing who replied

## Browsing

- [ ] **Catalog view** (grid of threads per board)
- [ ] Thread auto-update (polling or WebSocket) and a reply counter
- [ ] Inline quick-reply box
- [ ] Archive of pruned threads (read-only)
- [ ] Search
- [ ] Mobile-friendly layout
- [ ] Theme switcher (Yotsuba, Yotsuba B, Tomorrow/dark)
- [ ] Board categories and an ordered board list; hidden/unlisted boards
- [ ] Rules and FAQ pages per board, banners, announcements / global message
- [ ] RSS feeds

## Board configuration

- [ ] Per-board settings: NSFW flag, max file size, allowed file types, text-only boards, required subject,
      bump limit, image limit, threads per page, forced anonymity
- [ ] Per-board staff permissions (board-scoped moderators / "janitors")

## Platform & operations

- [ ] JSON read API (boards, catalog, threads), like 4chan's API
- [ ] Docker image and docker-compose example
- [ ] Object-storage uploads (S3-compatible) and a CDN-friendly media domain
- [ ] Scheduled database backups and a restore command
- [ ] Prometheus metrics / health-check endpoint
- [ ] Automated test suite and CI
- [ ] Publish to npm
