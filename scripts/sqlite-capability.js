import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const packageJson = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const requiredNodeRange = packageJson.engines?.node || '满足 SQLite FTS5 要求的 Node.js 版本';

function withSqliteWarningSuppressed(action) {
  const originalEmitWarning = process.emitWarning;
  try {
    process.emitWarning = function (warning, ...args) {
      const message = typeof warning === 'string' ? warning : (warning && warning.message) || '';
      const type = typeof args[0] === 'string' ? args[0] : (warning && warning.name) || '';
      if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
      return originalEmitWarning.call(this, warning, ...args);
    };
    return action();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

export function createFts5UnsupportedError(cause) {
  return new Error(
    `当前 Node.js ${process.version} 不支持 SQLite FTS5；请升级到 Node.js ${requiredNodeRange}。`,
    { cause }
  );
}

export function assertFts5Support() {
  let db;
  try {
    db = withSqliteWarningSuppressed(() => {
      const { DatabaseSync } = require('node:sqlite');
      return new DatabaseSync(':memory:');
    });
    db.exec('CREATE VIRTUAL TABLE fts5_capability_probe USING fts5(content)');
    return true;
  } catch (error) {
    throw createFts5UnsupportedError(error);
  } finally {
    db?.close();
  }
}
