const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Remove every object in this account's folder, including uploads with no source row. */
export async function removeUserStorageFiles(client, userId, {
  maxRequests = 100,
  deadline = Date.now() + 20_000,
  now = Date.now,
} = {}) {
  if (!USER_ID_RE.test(userId)) throw new Error('Invalid account ID');
  const storage = client.storage.from('sources');
  let requests = 0;

  function checkBudget() {
    if (++requests > maxRequests || now() >= deadline) {
      throw new Error('Storage cleanup needs another attempt');
    }
  }

  async function clearFolder(prefix, depth = 0) {
    if (depth > 20) throw new Error('Storage folder depth exceeded');
    while (true) {
      checkBudget();
      // Deletions shift subsequent entries, so always read the first page again.
      const { data, error } = await storage.list(prefix, {
        limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Invalid storage listing');
      if (data.length === 0) return;

      const files = [];
      const folders = [];
      for (const entry of data) {
        const name = entry?.name;
        if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[/\\]/.test(name)) {
          throw new Error('Invalid storage entry');
        }
        const path = `${prefix}/${name}`;
        if (entry.id == null) folders.push(path);
        else files.push(path);
      }
      if (files.length) {
        checkBudget();
        const { error: removeError } = await storage.remove(files);
        if (removeError) throw removeError;
      }
      for (const folder of folders) await clearFolder(folder, depth + 1);
    }
  }

  await clearFolder(userId);
}
