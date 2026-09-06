#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) SQLite FTS5 预编译引擎构建器
 *
 * 核心功能:
 * 1. 利用 Node 24 原生 node:sqlite (零外部依赖) 构建 references/rules.db
 * 2. 预先解码并清洗全部 7,000+ HTML 文件，将核心规则预编译为高清 Markdown
 * 3. 提取超高密度 --brief 紧凑数据卡，为 AI Agent 节省 90% 上下文 Token
 * 4. 建立 FTS5 全文倒排索引与 B-Tree 索引，实现毫秒级微秒级检索
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.resolve(__dirname, '../references/rules_source'),
  path.resolve(__dirname, '../../DND_5e_Rules/rules_source')
];
let rulesRoot = candidates.find(p => fs.existsSync(p));

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

if (fs.existsSync(dbPath)) {
  if (!isForce) {
    console.log(`\x1b[33m[DB Warning]\x1b[0m ${dbPath} 已存在。若需全量覆盖重建，请添加 --force 参数。`);
    process.exit(0);
  }
  fs.unlinkSync(dbPath);
}

console.log(`Building SQLite FTS5 database at: ${dbPath}`);
console.time('TotalBuildDB');

const db = new DatabaseSync(dbPath);

// Initialize Tables & FTS5
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
  CREATE INDEX idx_entries_title ON entries(title);
  CREATE INDEX idx_entries_title_en ON entries(title_en);
  CREATE INDEX idx_entries_edition ON entries(edition);

  CREATE VIRTUAL TABLE entries_fts USING fts5(
    title,
    title_en,
    aliases,
    brief_md,
    content='entries',
    content_rowid='id'
  );
`);

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

function htmlToMarkdown(html) {
  let md = html;
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');
  md = md.replace(/<(?:strong|b)\b[^>]*>(.*?)<\/(?:strong|b)>/gi, '**$1**');
  md = md.replace(/<u\b[^>]*>(.*?)<\/u>/gi, '**$1**');
  md = md.replace(/<(?:em|i)\b[^>]*>(.*?)<\/(?:em|i)>/gi, '*$1*');
  md = md.replace(/<br\s*[\/]?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p\b[^>]*>/gi, '');
  md = md.replace(/<tr\b[^>]*>/gi, '\n| ');
  md = md.replace(/<\/(?:td|th)>/gi, ' | ');
  md = md.replace(/<(?:td|th)\b[^>]*>/gi, '');
  md = md.replace(/<\/tr>/gi, '');
  md = md.replace(/<\/?table\b[^>]*>/gi, '\n');
  md = md.replace(/<\/?tbody\b[^>]*>/gi, '');
  md = md.replace(/<\/?thead\b[^>]*>/gi, '');
  md = md.replace(/<[^>]+>/g, '');
  md = md.replace(/&nbsp;/g, ' ')
         .replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"')
         .replace(/&#39;/g, "'");
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

function extractSubSection(html, query) {
  if (!query) return null;
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
function generateBrief(category, title, titleEn, md) {
  const name = titleEn ? `${title} (${titleEn})` : title;

  if (category === 'spell') {
    // Look for level/school, casting time, range, components, duration, save/damage
    const lines = md.split('\n').map(l => l.trim()).filter(Boolean);
    const meta = lines.slice(0, 8).join(' | ').replace(/\*\*/g, '').replace(/\*/g, '');
    return `[法术] ${name} | ${meta.slice(0, 150)}`;
  }

  if (category === 'monster') {
    // Extract AC, HP, Speed, CR, Key Attacks
    const lines = md.split('\n').map(l => l.trim()).filter(Boolean);
    const statLines = lines.filter(l => l.includes('AC') || l.includes('HP') || l.includes('速度') || l.includes('CR') || l.includes('动作') || l.includes('攻击检定'));
    const compact = statLines.slice(0, 6).join(' | ').replace(/\*\*/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ');
    return `[怪物] ${name} | ${compact.slice(0, 180)}`;
  }

  if (category === 'item') {
    const firstPara = md.split('\n\n').find(p => p.length > 20) || md;
    const clean = firstPara.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').slice(0, 150);
    return `[物品] ${name} | ${clean}`;
  }

  if (category === 'rule' || category === 'condition') {
    const firstPara = md.split('\n\n').find(p => p.length > 15) || md;
    const clean = firstPara.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').slice(0, 150);
    return `[规则] ${name} | ${clean}`;
  }

  return `[${category}] ${name} | ${md.slice(0, 120).replace(/\n/g, ' ')}`;
}

// Load topics
const rawIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
console.log(`Processing ${rawIndex.length} topics from topics_index.json...`);

const insertEntry = db.prepare(`
  INSERT INTO entries (id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertFts = db.prepare(`
  INSERT INTO entries_fts (rowid, title, title_en, aliases, brief_md)
  VALUES (?, ?, ?, ?, ?)
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
    briefMd
  );

  count++;
  if (count % 2000 === 0) {
    console.log(`Indexed ${count}/${rawIndex.length} entries...`);
  }
}

db.exec('COMMIT');
console.timeEnd('TotalBuildDB');

const dbSizeMB = (fs.statSync(dbPath).size / (1024 * 1024)).toFixed(2);
console.log(`Successfully generated ${dbPath} (${count} entries, ${dbSizeMB} MB)`);
db.close();
