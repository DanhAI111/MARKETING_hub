require('dotenv').config();

const path = require('node:path');
const Database = require('better-sqlite3');
const repo = require('../server/repository');

const sourcePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'marketing_hub.sqlite');

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

const tableRows = (db, table) => {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return exists ? db.prepare(`SELECT * FROM ${table}`).all() : [];
};

const main = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it to your PostgreSQL connection string before running this migration.');
  }

  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
  await repo.init();

  let fanpages = 0;
  for (const row of tableRows(sourceDb, 'fanpages')) {
    await repo.upsertFanpage({
      ...row,
      connected: !!row.connected,
      kpis: parseJson(row.kpis, {}),
      pageAccessTokenEncrypted: row.pageAccessTokenEncrypted || null
    });
    fanpages++;
  }

  let posts = 0;
  for (const row of tableRows(sourceDb, 'posts')) {
    await repo.upsertPost({
      ...row,
      mediaItems: parseJson(row.mediaItems, [])
    });
    posts++;
  }

  let appItems = 0;
  for (const row of tableRows(sourceDb, 'app_items')) {
    const data = parseJson(row.data, null);
    if (data) {
      await repo.upsertAppItem(row.collection, data);
      appItems++;
    }
  }

  const customCategories = tableRows(sourceDb, 'sync_state').find((row) => row.key === 'customCategories');
  if (customCategories) {
    await repo.saveSingleton('customCategories', parseJson(customCategories.value, null));
  }

  const metaAccount = tableRows(sourceDb, 'meta_accounts').find((row) => row.id === 'meta');
  if (metaAccount?.accessTokenEncrypted) {
    await repo.saveMetaAccount({
      accessTokenEncrypted: metaAccount.accessTokenEncrypted,
      tokenExpiresAt: metaAccount.tokenExpiresAt,
      scopes: metaAccount.scopes
    });
  }

  await repo.close();
  sourceDb.close();
  console.log(`Migrated ${fanpages} fanpages, ${posts} posts, ${appItems} app items${metaAccount ? ', and Meta token' : ''}.`);
};

main().catch(async (err) => {
  await repo.close().catch(() => null);
  console.error(err);
  process.exit(1);
});
