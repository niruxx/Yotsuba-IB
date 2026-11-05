// Read-only JSON API, modelled loosely on 4chan's (https://github.com/4chan/4chan-API).
// Hidden boards are excluded. Posts are returned as raw text ("com") plus metadata; no IPs or hashes.
//
//   GET /api/boards.json
//   GET /api/:board/catalog.json
//   GET /api/:board/threads/:id.json
//   GET /api/:board/archive.json
//   GET /api/watch.json?t=board:123,board:456      (reply counts, used by the thread watcher)

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };

function postJson(p, board) {
  const out = {
    no: p.id,
    resto: p.thread_id ?? 0,
    time: Math.floor(p.created / 1000),
    name: p.name,
    com: p.body,
  };
  if (p.subject) out.sub = p.subject;
  if (p.tripcode) out.trip = p.tripcode;
  if (p.capcode) out.capcode = p.capcode.toLowerCase();
  if (p.poster_id && board.poster_ids) out.id = p.poster_id;
  if (p.country && board.country_flags) out.country = p.country;
  if (p.file) {
    out.filename = p.spoiler ? 'spoiler' : p.file_orig;
    out.ext = EXT[p.file_mime] || '';
    out.fsize = p.file_size;
    if (p.width) { out.w = p.width; out.h = p.height; }
    out.file_url = `/media/${p.id}.${out.ext}`;
    if (p.thumb) out.thumb_url = `/media/thumb/${p.id}.jpg`;
    if (p.spoiler) out.spoiler = 1;
  } else if (p.file_orig) {
    out.filedeleted = 1;
  }
  if (!p.thread_id) {
    out.replies = p.reply_count;
    if (p.sticky) out.sticky = 1;
    if (p.locked) out.closed = 1;
    if (p.archived) { out.archived = 1; out.archived_on = Math.floor(p.archived_at / 1000); }
    out.last_modified = Math.floor(p.bumped / 1000);
  }
  return out;
}

export function registerApi(app, { db, getVisibleBoard, listBoards }) {
  const api = (fn) => (req, res, next) => {
    res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=10' });
    return fn(req, res, next);
  };
  const publicBoard = (req) => {
    const b = getVisibleBoard({ admin: null }, req.params.board);
    return b && !b.hidden ? b : null;
  };
  const imageCount = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE thread_id = ? AND file IS NOT NULL');

  app.get('/api/boards.json', api((req, res) => {
    const boards = listBoards({ admin: null }).map((b) => {
      const full = getVisibleBoard({ admin: null }, b.slug);
      return {
        board: b.slug,
        title: b.title,
        meta_description: b.bio,
        category: b.category || undefined,
        ws_board: full.nsfw ? 0 : 1,
        text_only: full.text_only ? 1 : 0,
        forced_anon: full.forced_anon ? 1 : 0,
        bump_limit: full.bump_limit ?? undefined,
        image_limit: full.image_limit ?? undefined,
        per_page: full.threads_per_page ?? undefined,
      };
    });
    res.json({ boards });
  }));

  app.get('/api/watch.json', api((req, res) => {
    const out = {};
    for (const key of String(req.query.t || '').split(',').slice(0, 100)) {
      const [slug, id] = key.split(':');
      const b = getVisibleBoard({ admin: null }, slug);
      if (!b || b.hidden) continue;
      const op = db.prepare('SELECT reply_count, archived FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(Number(id), slug);
      out[key] = op ? { replies: op.reply_count, archived: op.archived ? 1 : 0 } : { deleted: 1 };
    }
    res.set('Cache-Control', 'no-store').json(out);
  }));

  app.get('/api/:board/catalog.json', api((req, res, next) => {
    const board = publicBoard(req);
    if (!board) return next();
    const ops = db.prepare(`SELECT * FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 0
                            ORDER BY sticky DESC, bumped DESC`).all(board.slug);
    const lastReplies = db.prepare('SELECT * FROM (SELECT * FROM posts WHERE thread_id = ? ORDER BY id DESC LIMIT 5) ORDER BY id');
    const perPage = board.threads_per_page || 10;
    const pages = [];
    ops.forEach((op, i) => {
      const pageNo = Math.floor(i / perPage);
      if (!pages[pageNo]) pages[pageNo] = { page: pageNo + 1, threads: [] };
      pages[pageNo].threads.push({
        ...postJson(op, board),
        images: imageCount.get(op.id).n,
        last_replies: lastReplies.all(op.id).map((r) => postJson(r, board)),
      });
    });
    res.json(pages);
  }));

  app.get('/api/:board/threads/:id.json', api((req, res, next) => {
    const board = publicBoard(req);
    if (!board) return next();
    const op = db.prepare('SELECT * FROM posts WHERE id = ? AND board = ? AND thread_id IS NULL').get(parseInt(req.params.id, 10), board.slug);
    if (!op) return res.status(404).json({ error: 'thread not found' });
    const replies = db.prepare('SELECT * FROM posts WHERE thread_id = ? ORDER BY id').all(op.id);
    res.json({ posts: [{ ...postJson(op, board), images: imageCount.get(op.id).n }, ...replies.map((r) => postJson(r, board))] });
  }));

  app.get('/api/:board/archive.json', api((req, res, next) => {
    const board = publicBoard(req);
    if (!board) return next();
    res.json(db.prepare('SELECT id FROM posts WHERE board = ? AND thread_id IS NULL AND archived = 1 ORDER BY archived_at')
      .all(board.slug).map((r) => r.id));
  }));
}
