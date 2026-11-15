export const attachmentUrl = (id, thumbnail = false) => `/media/attachments/${thumbnail ? 'thumb/' : ''}${id}`;

export function createAttachments(db, rmUpload) {
  const extras = db.prepare('SELECT * FROM attachments WHERE post_id = ? ORDER BY id');
  const decorate = (post) => ({ ...post, attachments: extras.all(post.id) });
  function clear(postId) {
    const primary = db.prepare('SELECT file FROM posts WHERE id = ?').get(postId);
    if (primary?.file) rmUpload(primary.file);
    for (const file of extras.all(postId)) if (file.file) rmUpload(file.file);
    db.prepare('UPDATE posts SET file = NULL WHERE id = ?').run(postId);
    db.prepare('UPDATE attachments SET file = NULL WHERE post_id = ?').run(postId);
  }
  const files = (id) => [db.prepare('SELECT file FROM posts WHERE id = ?').get(id), ...extras.all(id)].filter((file) => file?.file);
  return { decorate, clear, files };
}
