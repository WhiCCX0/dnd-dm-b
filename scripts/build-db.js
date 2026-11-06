#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) SQLite FTS5 预编译引擎构建器
 *
 * 核心功能:
 * 1. 利用 Node 24 原生 node:sqlite (零外部依赖) 构建 references/rules.db
 * 2. 预先解码并清洗全部 7,000+ HTML 文件，将核心规则预编译为标准 GFM Markdown (含表格分隔行与实体解码)
 * 3. 提取超高密度 --brief 紧凑数据卡，为 AI Agent 节省 90% 上下文 Token
 * 4. 建立包含 content_md 正文的 FTS5 全文倒排索引与大小写无关 B-Tree 表达式索引
 * 5. 采用临时文件原子替换策略，构建完成后执行 FTS optimize 与 VACUUM 零碎片压缩
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NAMED_ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&middot;': '·',
  '&bull;': '•',
  '&times;': '×',
  '&divide;': '÷',
  '&deg;': '°',
  '&plusmn;': '±',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™'
};

export function decodeHtmlEntities(text) {
  if (!text) return '';
  let decoded = String(text);

  // Decode numeric decimal entities: &#1234;
  decoded = decoded.replace(/&#(\d+);/g, (_, dec) => {
    const code = parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
  });

  // Decode numeric hex entities: &#x1F600;
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
  });

  // Decode common named entities
  decoded = decoded.replace(/&[a-zA-Z0-9#]+;/g, match => {
    const lower = match.toLowerCase();
    return NAMED_ENTITIES[lower] !== undefined ? NAMED_ENTITIES[lower] : match;
  });

  return decoded;
}

function convertHtmlTableToMarkdown(tableHtml) {
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
  const rows = [];
  let trMatch;

  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const rowHtml = trMatch[1];
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      let cellText = cellMatch[1]
        .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
        .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<[^>]+>/g, '');
      cellText = decodeHtmlEntities(cellText).replace(/\s+/g, ' ').trim();
      cells.push(cellText);
    }
    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return '';

  const maxCols = Math.max(...rows.map(r => r.length));
  const normalizedRows = rows.map(r => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return `| ${padded.join(' | ')} |`;
  });

  const separator = `| ${Array(maxCols).fill('---').join(' | ')} |`;
  const result = [normalizedRows[0], separator, ...normalizedRows.slice(1)];
  return `\n\n${result.join('\n')}\n\n`;
}

export function htmlToMarkdown(html) {
  if (!html) return '';
  let md = String(html);
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Convert HTML tables into valid GFM tables with | --- | separator rows
  md = md.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, tableMatch => convertHtmlTableToMarkdown(tableMatch));

  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n');
  md = md.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(/<u\b[^>]*>([\s\S]*?)<\/u>/gi, '**$1**');
  md = md.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p\b[^>]*>/gi, '');

  // Fallback for any unclosed/loose table tags outside <table>...</table>
  md = md.replace(/<tr\b[^>]*>/gi, '\n| ');
  md = md.replace(/<\/(?:td|th)>/gi, ' | ');
  md = md.replace(/<(?:td|th)\b[^>]*>/gi, '');
  md = md.replace(/<\/tr>/gi, '');
  md = md.replace(/<\/?table\b[^>]*>/gi, '\n');
  md = md.replace(/<\/?tbody\b[^>]*>/gi, '');
  md = md.replace(/<\/?thead\b[^>]*>/gi, '');

  md = md.replace(/<[^>]+>/g, '');
  md = decodeHtmlEntities(md);
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

export function extractSubSection(html, query) {
  if (!query || !html) return null;
  const q = query.trim();
  const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (let level = 1; level <= 6; level++) {
    const higherOrSame = `[1-${level}]`;
    const hRegex = new RegExp(`(<h${level}[^>]*>(?:(?!<\\/h${level}>)[\\s\\S])*?${qEscaped}[\\s\\S]*?<\\/h${level}>)([\\s\\S]*?)(?=<h${higherOrSame}\\b|<\\/body>|$)`, 'i');
    const mH = html.match(hRegex);
    if (mH) return mH[1] + mH[2];
  }

  for (let level = 1; level <= 6; level++) {
    const higherOrSame = `[1-${level}]`;
    const idRegex = new RegExp(`(<h${level}[^>]*id=["']${qEscaped}["'][^>]*>[\\s\\S]*?<\\/h${level}>)([\\s\\S]*?)(?=<h${higherOrSame}\\b|<\\/body>|$)`, 'i');
    const mId = html.match(idRegex);
    if (mId) return mId[1] + mId[2];
  }

  const pRegex = new RegExp(`(<p[^>]*>(?:(?!<\\/p>)[\\s\\S])*?<(?:strong|b)[^>]*>(?:(?!<\\/(?:strong|b)>)[\\s\\S])*?${qEscaped}[\\s\\S]*?<\\/(?:strong|b)>[\\s\\S]*?<\\/p>)`, 'i');
  const mP = html.match(pRegex);
  if (mP) return mP[1];

  const textIdx = html.toLowerCase().indexOf(q.toLowerCase());
  if (textIdx !== -1) {
    const prevBlock = Math.max(0, html.lastIndexOf('<p', textIdx), html.lastIndexOf('<h', textIdx));
    const nextBlock = html.indexOf('<h', textIdx + q.length);
    const end = nextBlock !== -1 ? nextBlock : Math.min(html.length, textIdx + 1500);
    return html.slice(prevBlock, end);
  }
  return null;
}

/**
 * Generate ultra-dense --brief summary for Agent consumption (<80 tokens)
 */
export function generateBrief(category, title, titleEn, md) {
  const name = titleEn ? `${title} (${titleEn})` : title;
  const cleanMd = (md || '').trim();
  if (!cleanMd) return `[${category || 'general'}] ${name}`;

  if (category === 'spell') {
    const lines = cleanMd.split('\n').map(l => l.trim()).filter(Boolean);
    const meta = lines.slice(0, 8).join(' | ').replace(/\*\*/g, '').replace(/\*/g, '');
    return `[法术] ${name} | ${meta.slice(0, 150)}`;
  }

  if (category === 'monster') {
    const lines = cleanMd.split('\n').map(l => l.trim()).filter(Boolean);
    const statLines = lines.filter(l => l.includes('AC') || l.includes('HP') || l.includes('速度') || l.includes('CR') || l.includes('动作') || l.includes('攻击检定'));
    const sourceLines = statLines.length > 0 ? statLines : lines;
    const compact = sourceLines.slice(0, 6).join(' | ').replace(/\*\*/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    return `[怪物] ${name} | ${compact.slice(0, 180)}`;
  }

  if (category === 'item') {
    const firstPara = cleanMd.split('\n\n').find(p => p.length > 20) || cleanMd;
    const clean = firstPara.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').slice(0, 150);
    return `[物品] ${name} | ${clean}`;
  }

  if (category === 'rule' || category === 'condition' || category === 'feat') {
    const firstPara = cleanMd.split('\n\n').find(p => p.length > 15) || cleanMd;
    const clean = firstPara.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').slice(0, 150);
    return `[规则] ${name} | ${clean}`;
  }

  if (category === 'class') {
    const firstPara = cleanMd.split('\n\n').find(p => p.length > 15) || cleanMd;
    const clean = firstPara.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').slice(0, 150);
    return `[职业] ${name} | ${clean}`;
  }

  return `[${category}] ${name} | ${cleanMd.slice(0, 120).replace(/\n/g, ' ')}`;
}

function main() {
  const candidates = [
    process.env.RULES_SOURCE_DIR,
    path.resolve(__dirname, '../references/rules_source'),
    path.resolve(__dirname, '../../DND_5e_Rules/rules_source')
  ].filter(Boolean);

  const rulesRoot = candidates.find(p => fs.existsSync(p));
  const dbPath = path.resolve(__dirname, '../references/rules.db');
  const indexFile = path.resolve(__dirname, '../references/topics_index.json');
  const isForce = process.argv.includes('--force') || process.argv.includes('-f');

  if (!rulesRoot) {
    if (fs.existsSync(dbPath)) {
      const stat = fs.statSync(dbPath);
      console.log(`\x1b[33m🛡️ [DB 构建保护锁]\x1b[0m 未检测到 rules_source 原始 HTML 目录。`);
      console.log(`现有的预编译数据库 \x1b[32m${dbPath}\x1b[0m (${(stat.size / (1024 * 1024)).toFixed(1)} MB) 完好无损，已受写保护。`);
      console.log(`如需重新从 HTML 构建，请挂载 rules_source 目录并使用 --force 运行。`);
      process.exit(0);
    } else {
      console.error('\x1b[31mError: rules_source directory not found in candidates:\x1b[0m', candidates);
      process.exit(1);
    }
  }

  if (!fs.existsSync(indexFile)) {
    console.error('Error: topics_index.json not found. Run scripts/build-index.js first.');
    process.exit(1);
  }

  if (fs.existsSync(dbPath) && !isForce) {
    console.log(`\x1b[33m[DB Warning]\x1b[0m ${dbPath} 已存在。若需全量覆盖重建，请添加 --force 参数。`);
    process.exit(0);
  }

  function readGbk(relPath) {
    if (!relPath) return null;
    const full = path.join(rulesRoot, relPath.replace(/\\/g, '/'));
    if (!fs.existsSync(full)) return null;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) return null;
    const buf = fs.readFileSync(full);
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (err) {
      if (process.env.DEBUG) {
        console.warn(`[Encoding Warning] GBK decode failed for ${relPath}, falling back to UTF-8:`, err.message);
      }
      return new TextDecoder('utf-8').decode(buf);
    }
  }

  // Build to a temporary file first so an interrupted build never destroys the existing DB
  const tmpDbPath = `${dbPath}.${process.pid}.tmp`;
  if (fs.existsSync(tmpDbPath)) {
    fs.unlinkSync(tmpDbPath);
  }

  console.log(`Building SQLite FTS5 database via temporary file: ${tmpDbPath}`);
  console.time('TotalBuildDB');

  const db = new DatabaseSync(tmpDbPath);

  try {
    // Initialize Tables, Case-Insensitive B-Tree Indexes & Full-Content FTS5
    db.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        title_en TEXT,
        aliases TEXT,
        url TEXT NOT NULL,
        anchor TEXT,
        edition TEXT NOT NULL,
        content_md TEXT NOT NULL,
        brief_md TEXT
      );

      CREATE INDEX idx_entries_category ON entries(category);
      CREATE INDEX idx_entries_title ON entries(title COLLATE NOCASE);
      CREATE INDEX idx_entries_title_en ON entries(title_en COLLATE NOCASE);
      CREATE INDEX idx_entries_anchor ON entries(anchor COLLATE NOCASE);
      CREATE INDEX idx_entries_lower_title ON entries(LOWER(title));
      CREATE INDEX idx_entries_lower_title_en ON entries(LOWER(title_en));
      CREATE INDEX idx_entries_lower_anchor ON entries(LOWER(anchor));
      CREATE INDEX idx_entries_edition ON entries(edition);

      CREATE VIRTUAL TABLE entries_fts USING fts5(
        title,
        title_en,
        aliases,
        brief_md,
        content_md,
        content='entries',
        content_rowid='id'
      );
    `);

    const rawIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    console.log(`Processing ${rawIndex.length} topics from topics_index.json...`);

    const insertEntry = db.prepare(`
      INSERT INTO entries (id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO entries_fts (rowid, title, title_en, aliases, brief_md, content_md)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN TRANSACTION');

    let count = 0;
    for (const item of rawIndex) {
      let contentMd = '';
      let briefMd = '';

      if (item.url) {
        const rawHtml = readGbk(item.url);
        if (rawHtml) {
          let targetHtml = rawHtml;
          if (item.anchor || (rawHtml.length > 10000 && item.category !== 'monster')) {
            const sub = extractSubSection(rawHtml, item.anchor || item.titleEn || item.title);
            if (sub) targetHtml = sub;
          }
          contentMd = htmlToMarkdown(targetHtml);
          briefMd = generateBrief(item.category, item.title, item.titleEn, contentMd);
        }
      }

      const aliasesStr = (item.aliases || []).join(', ');

      insertEntry.run(
        item.id,
        item.category || 'general',
        item.title,
        item.titleEn || '',
        aliasesStr,
        item.url || '',
        item.anchor || '',
        item.edition || '5e',
        contentMd,
        briefMd
      );

      insertFts.run(
        item.id,
        item.title,
        item.titleEn || '',
        aliasesStr,
        briefMd,
        contentMd
      );

      count++;
      if (count % 2000 === 0) {
        console.log(`Indexed ${count}/${rawIndex.length} entries...`);
      }
    }

    db.exec('COMMIT');

    console.log('Optimizing FTS5 inverted index, running ANALYZE and VACUUM...');
    db.exec("INSERT INTO entries_fts(entries_fts) VALUES('optimize')");
    db.exec('ANALYZE');
    db.exec('VACUUM');
    db.close();

    // Atomically replace target DB only after complete success
    fs.renameSync(tmpDbPath, dbPath);
    console.timeEnd('TotalBuildDB');

    const dbSizeMB = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);
    console.log(`Successfully generated ${dbPath} (${count} entries, ${dbSizeMB} MB)`);
  } catch (err) {
    try { db.close(); } catch (_) {}
    if (fs.existsSync(tmpDbPath)) {
      try { fs.unlinkSync(tmpDbPath); } catch (_) {}
    }
    throw err;
  }
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'build-db.js')
);

if (isMain) {
  main();
}
