#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) SQLite FTS5 预编译引擎构建器
 *
 * 核心功能:
 * 1. 利用 Node 24 原生 node:sqlite (零外部依赖) 构建 references/rules.db
 * 2. 智能编码探测 (UTF-8 fatal 优先 -> GBK 兜底)，清洗 HTML 头部、软换行与冗余粗体标记
 * 3. 按类别定制化提取高信息密度 --brief 数据卡 (法术 100% 保留骰子算式、怪物完整五维与动作、状态/物品零空摘要)
 * 4. 建立 tokenize='trigram' 的 FTS5 全文索引与大小写无关 B-Tree 表达式索引，支持任意中文子串毫秒级检索
 * 5. 记录上游版本元数据 (meta 表)，采用临时文件原子替换策略，构建完成后执行 FTS optimize 与 VACUUM 零碎片压缩
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
      cellText = decodeHtmlEntities(cellText)
        .replace(/\*{4,}/g, '**')
        .replace(/\s+/g, ' ')
        .trim();
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

  // Strip HTML comments, <head>...</head>, <script>, <style>
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');
  md = md.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  md = md.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Normalize soft linebreaks inside raw HTML before converting block elements and tables
  md = md.replace(/\r?\n/g, ' ');

  // Convert HTML tables into valid GFM tables with | --- | separator rows
  md = md.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, tableMatch => convertHtmlTableToMarkdown(tableMatch));

  // Normalize headings (strip inner linewraps so bilingual headings stay on one line)
  for (let level = 1; level <= 6; level++) {
    const hashes = '#'.repeat(level);
    const hRe = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    md = md.replace(hRe, (_, inner) => {
      const cleanInner = inner.replace(/<br\s*\/?>/gi, ' ').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      return `\n${hashes} ${cleanInner}\n`;
    });
  }

  // Convert list items cleanly
  md = md.replace(/<li\b[^>]*>\s*(?:<div\b[^>]*>)?/gi, '\n- ');
  md = md.replace(/(?:<\/div>)?\s*<\/li>/gi, '');
  md = md.replace(/<\/?(?:ul|ol|blockquote|div)\b[^>]*>/gi, '\n');

  // Inline formatting (do not bold <u> tags to avoid **** double-bolding with <strong><u>)
  md = md.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
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

  // Strip remaining HTML tags and decode entities
  md = md.replace(/<[^>]+>/g, '');
  md = decodeHtmlEntities(md);

  // Clean up adjacent/empty bold markers and list item spacing
  md = md.replace(/\*\*(\s*)\*\*/g, '$1');
  md = md.replace(/\*{4,}/g, '');
  md = md.replace(/^-\s+\n\s*/gm, '- ');
  md = md.replace(/[ \t]+\n/g, '\n');
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  return md;
}

export function extractSubSection(html, query) {
  if (!query || !html) return null;
  const q = query.trim();
  if (!q) return null;
  const qEscaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Heading id="query" exact match
  for (let level = 1; level <= 6; level++) {
    const higherOrSame = `[1-${level}]`;
    const idRegex = new RegExp(`(<h${level}[^>]*id=["']${qEscaped}["'][^>]*>[\\s\\S]*?<\\/h${level}>)([\\s\\S]*?)(?=<h${higherOrSame}\\b|<\\/body>|$)`, 'i');
    const mId = html.match(idRegex);
    if (mId) return mId[1] + mId[2];
  }

  // 2. Heading inner text match
  for (let level = 1; level <= 6; level++) {
    const higherOrSame = `[1-${level}]`;
    const hRegex = new RegExp(`(<h${level}[^>]*>(?:(?!<\\/h${level}>)[\\s\\S])*?${qEscaped}[\\s\\S]*?<\\/h${level}>)([\\s\\S]*?)(?=<h${higherOrSame}\\b|<\\/body>|$)`, 'i');
    const mH = html.match(hRegex);
    if (mH) return mH[1] + mH[2];
  }

  // 3. Maroon sub-heading paragraph (<p>...<font color=#800000>Query...</font>...</p> or <span style="...#810000...">)
  // Slices until the next maroon sub-heading paragraph, heading, or </body>
  const maroonRegex = new RegExp(
    `<p\\b[^>]*>(?:(?!<\\/p>)[\\s\\S])*?(?:color\\s*=\\s*["']?#?8[01]0000|color\\s*:\\s*#8[01]0000)(?:(?!<\\/p>)[\\s\\S])*?${qEscaped}[\\s\\S]*?(?=<p\\b[^>]*>(?:(?!<\\/p>)[\\s\\S])*?(?:color\\s*=\\s*["']?#?8[01]0000|color\\s*:\\s*#8[01]0000)|<h[1-6]\\b|<\\/body>|$)`,
    'i'
  );
  const mMaroon = html.match(maroonRegex);
  if (mMaroon) return mMaroon[0];

  // 4. Bold paragraph start match
  const pRegex = new RegExp(`(<p[^>]*>(?:(?!<\\/p>)[\\s\\S])*?<(?:strong|b)[^>]*>(?:(?!<\\/(?:strong|b)>)[\\s\\S])*?${qEscaped}[\\s\\S]*?<\\/(?:strong|b)>[\\s\\S]*?<\\/p>)`, 'i');
  const mP = html.match(pRegex);
  if (mP) return mP[1];

  // 5. Fallback window around first text occurrence
  const textIdx = html.toLowerCase().indexOf(q.toLowerCase());
  if (textIdx !== -1) {
    const prevBlock = Math.max(0, html.lastIndexOf('<p', textIdx), html.lastIndexOf('<h', textIdx));
    const nextBlock = html.indexOf('<h', textIdx + q.length);
    const end = nextBlock !== -1 ? nextBlock : Math.min(html.length, textIdx + 2000);
    return html.slice(prevBlock, end);
  }
  return null;
}

function stripMdFormatting(str) {
  return String(str || '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Scope a multi-monster Markdown document to a single monster's statblock
 */
function scopeSingleMonsterMd(cleanMd, title, titleEn) {
  const lines = Array.isArray(cleanMd)
    ? cleanMd
    : String(cleanMd || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Find all lines that start a statblock (AC / 护甲等级)
  const acLineIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const plain = stripMdFormatting(lines[i]).replace(/^\|?\s*/, '');
    if (/^(?:AC|护甲等级)\b/i.test(plain)) {
      acLineIndices.push(i);
    }
  }

  if (acLineIndices.length === 0) return lines;
  if (acLineIndices.length === 1) {
    return lines.slice(Math.max(0, acLineIndices[0] - 1));
  }

  // If multiple statblocks exist on the page, pick the one closest to the matching heading, or the first one
  let chosenAcIdx = acLineIndices[0];
  if (title) {
    for (const acIdx of acLineIndices) {
      const lookback = lines.slice(Math.max(0, acIdx - 4), acIdx).map(stripMdFormatting).join(' ');
      if (lookback.includes(title) || (titleEn && lookback.toLowerCase().includes(titleEn.toLowerCase()))) {
        chosenAcIdx = acIdx;
        break;
      }
    }
  }

  const nextAcRank = acLineIndices.indexOf(chosenAcIdx) + 1;
  const startIdx = Math.max(0, chosenAcIdx - 1);
  const endIdx = nextAcRank < acLineIndices.length ? Math.max(chosenAcIdx + 1, acLineIndices[nextAcRank] - 2) : lines.length;
  return lines.slice(startIdx, endIdx);
}

/**
 * Generate high-density, category-tailored --brief summary for Agent consumption
 */
export function generateBrief(category, title, titleEn, md) {
  const name = titleEn ? `${title} (${titleEn})` : title;
  const cleanMd = (md || '').trim();
  if (!cleanMd) return `[${category || 'general'}] ${name}`;

  const rawLines = cleanMd
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // Filter out pure heading lines that merely repeat the entry title
  const contentLines = rawLines.filter(l => {
    if (!l.startsWith('#')) return true;
    const hText = stripMdFormatting(l);
    if (!hText) return false;
    if (hText === title || hText === titleEn || hText.includes(title)) return false;
    return true;
  });

  // 1. SPELL: Preserve level/school, casting time, range, components, duration, and 100% of dice/save/damage mechanics
  if (category === 'spell') {
    const metaLines = [];
    const bodyLines = [];
    for (const line of contentLines) {
      const plain = stripMdFormatting(line);
      if (!plain || plain === name) continue;
      if (
        /^(?:戏法(?![强升])|\d+环|[一二三四五六七八九]环|施法时间|施法距离|法术成分|持续时间)/i.test(plain) ||
        (metaLines.length === 0 && /(?:塑能|防护|咒法|预言|附魔|幻术|死灵|变化)/.test(plain))
      ) {
        metaLines.push(plain);
      } else {
        bodyLines.push(plain);
      }
    }

    const bodyText = bodyLines.join(' ');
    const sentences = bodyText.split(/(?<=[。！？；.!?;])\s*/).filter(Boolean);
    const keySentences = [];
    for (const s of sentences) {
      if (
        /\d*d\d+/i.test(s) ||
        /豁免|攻击检定|命中|伤害|治疗|恢复|临时生命值|AC|速度|优势|劣势|失能|倒地|目盲|魅惑|恐慌|麻痹|中毒|束缚|震慑|昏迷|隐形|升环施法|戏法升级|戏法强化|尺/.test(s)
      ) {
        keySentences.push(s.trim());
      }
    }

    let effectSummary = keySentences.length > 0 ? keySentences.join(' ') : bodyText;
    if (effectSummary.length > 360) {
      effectSummary = effectSummary.slice(0, 360);
    }

    // Guarantee 100% dice retention for every dice expression in cleanMd
    const allDice = [...new Set((cleanMd.match(/\b\d*d\d+(?:\s*[+\-]\s*\d+)?/gi) || []).map(d => d.replace(/\s+/g, '')))];
    const missingDice = allDice.filter(d => !effectSummary.replace(/\s+/g, '').includes(d));
    if (missingDice.length > 0) {
      for (const d of missingDice) {
        const matchingSent = sentences.find(s => s.replace(/\s+/g, '').includes(d));
        if (matchingSent && !effectSummary.includes(matchingSent)) {
          effectSummary += ` ${matchingSent.trim()}`;
        }
      }
    }

    const metaStr = metaLines.slice(0, 5).join(' | ');
    return `[法术] ${name}${metaStr ? ' | ' + metaStr : ''} | ${effectSummary.trim()}`;
  }

  // 2. MONSTER: Distinguish statblocks from lore pages; extract AC, HP, Speed, 6 abilities, CR, traits & actions
  if (category === 'monster') {
    const plainAll = stripMdFormatting(cleanMd);
    const hasAc = /(?:^|\||\s)(?:AC|护甲等级)\s*[:：]?\s*\d+/i.test(plainAll);
    const hasHp = /(?:^|\||\s)(?:HP|生命值)\s*[:：]?\s*\d+/i.test(plainAll);

    if (!hasAc && !hasHp) {
      const lore = contentLines.map(stripMdFormatting).filter(Boolean).join(' ').slice(0, 260);
      return `[怪物设定] ${name} | ${lore}`;
    }

    const scopedLines = scopeSingleMonsterMd(contentLines, title, titleEn);
    const summaryParts = [];
    const abilityScores = [];

    for (const line of scopedLines) {
      const plain = stripMdFormatting(line);
      if (!plain) continue;

      // Parse 2025/2024 Markdown table row for 6 ability scores
      if (line.startsWith('|') && /(?:力量|敏捷|体质|智力|感知|魅力)/.test(plain)) {
        const cells = line.split('|').map(c => stripMdFormatting(c)).filter(Boolean);
        for (let i = 0; i < cells.length; i++) {
          if (/^(?:力量|敏捷|体质|智力|感知|魅力)$/.test(cells[i]) && cells[i + 1] && /^\d+$/.test(cells[i + 1])) {
            const mod = cells[i + 2] || '';
            const save = cells[i + 3] && cells[i + 3] !== mod ? `/豁免${cells[i + 3]}` : '';
            abilityScores.push(`${cells[i]}${cells[i + 1]}(${mod}${save})`);
          }
        }
        continue;
      }
      if (line.startsWith('| ---')) continue;

      const cleanPart = plain
        .replace(/\|/g, ' ')
        .replace(/(?:调整\s+豁免\s*)+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanPart) continue;

      summaryParts.push(cleanPart);
    }

    if (abilityScores.length > 0) {
      summaryParts.splice(Math.min(3, summaryParts.length), 0, `六维: ${abilityScores.join(' ')}`);
    }

    const joined = (summaryParts.length > 0 ? summaryParts : scopedLines.map(stripMdFormatting))
      .join(' | ')
      .slice(0, 480);
    return `[怪物] ${name} | ${joined}`;
  }

  // 3. CONDITION / RULE / FEAT: Skip boilerplate intro and preserve complete effect list
  if (category === 'condition' || category === 'rule' || category === 'feat') {
    const tag = category === 'condition' ? '状态' : (category === 'feat' ? '专长' : '规则');
    const meaningful = contentLines
      .map(stripMdFormatting)
      .filter(l => l && !/你将遭受以下这些效应|你在处于.*状态期间|你获得以下增益|这些专长从属于/.test(l));
    const text = (meaningful.length > 0 ? meaningful : rawLines.map(stripMdFormatting))
      .join(' | ')
      .slice(0, 360);
    return `[${tag}] ${name} | ${text}`;
  }

  // 4. ITEM: Skip headings, include rarity/type, core effect, and preserve compact tables (e.g. Potion of Healing)
  if (category === 'item') {
    const meaningful = contentLines
      .filter(l => !l.startsWith('| ---'))
      .map(l => {
        if (l.startsWith('|')) {
          return l.replace(/^\|\s*|\s*\|$/g, '').replace(/\s*\|\s*/g, ' / ').replace(/\*\*/g, '');
        }
        return stripMdFormatting(l);
      })
      .filter(Boolean);
    const text = (meaningful.length > 0 ? meaningful : rawLines.map(stripMdFormatting))
      .join(' | ')
      .slice(0, 360);
    return `[物品] ${name} | ${text}`;
  }

  // 5. CLASS / ORIGIN / GENERAL
  const tagMap = { class: '职业', origin: '起源', module: '模组' };
  const label = tagMap[category] || category || '条目';
  const meaningful = contentLines.map(stripMdFormatting).filter(Boolean);
  const text = (meaningful.length > 0 ? meaningful : rawLines.map(stripMdFormatting))
    .join(' | ')
    .slice(0, 300);
  return `[${label}] ${name} | ${text}`;
}

export function readHtmlSmart(fullPath) {
  if (!fullPath || !fs.existsSync(fullPath)) return null;
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) return null;
  const buf = fs.readFileSync(fullPath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) {
    return new TextDecoder('gbk').decode(buf);
  }
}

function main() {
  const candidates = [
    process.env.RULES_SOURCE_DIR,
    path.resolve(__dirname, '../references/rules_source'),
    path.resolve(__dirname, '../../DND_5e_Rules/rules_source'),
    '/tmp/5echm_web/topics'
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

  function readTopicHtml(relPath) {
    if (!relPath) return null;
    const full = path.join(rulesRoot, relPath.replace(/\\/g, '/'));
    return readHtmlSmart(full);
  }

  // Build to a temporary file first so an interrupted build never destroys the existing DB
  const tmpDbPath = `${dbPath}.${process.pid}.tmp`;
  if (fs.existsSync(tmpDbPath)) {
    fs.unlinkSync(tmpDbPath);
  }

  console.log(`Building SQLite FTS5 (trigram) database via temporary file: ${tmpDbPath}`);
  console.time('TotalBuildDB');

  const db = new DatabaseSync(tmpDbPath);

  try {
    // Initialize Tables, Meta, Case-Insensitive B-Tree Indexes & Trigram Full-Content FTS5
    db.exec(`
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

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
        content_md,
        content='entries',
        content_rowid='id',
        tokenize='trigram'
      );
    `);

    const rawIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    console.log(`Processing ${rawIndex.length} topics from topics_index.json...`);

    const insertEntry = db.prepare(`
      INSERT INTO entries (id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO entries_fts (rowid, title, title_en, aliases, content_md)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMeta = db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
    `);

    db.exec('BEGIN TRANSACTION');

    let count = 0;
    for (const item of rawIndex) {
      let contentMd = '';
      let briefMd = '';

      if (item.url) {
        const rawHtml = readTopicHtml(item.url);
        if (rawHtml) {
          let targetHtml = rawHtml;
          if (item.anchor) {
            const sub = extractSubSection(rawHtml, item.anchor);
            if (sub) targetHtml = sub;
          }
          contentMd = htmlToMarkdown(targetHtml);
          if (!contentMd) {
            contentMd = `[${item.category || 'general'}] ${item.title}`;
          }
          // Avoid storing duplicate 50KB+ full text on container index pages whose children are already sliced
          const isSlicedContainer = !item.anchor && (
            /^玩家手册2024\/法术详述\/\d环\.htm$/.test(item.url) ||
            /^城主指南2024\/7\.宝藏\/魔法物品详述\//.test(item.url) ||
            /^玩家手册2024\/专长\/(?:起源|通用|战斗风格|传奇恩惠)专长\.htm$/.test(item.url) ||
            /^速查\/.*大全/.test(item.url)
          );
          if (isSlicedContainer && contentMd.length > 2500) {
            contentMd = `${contentMd.slice(0, 2500)}\n\n... [本章各独立词条已全部拆分为单体条目索引，请直接按名称检索具体法术/物品/专长]`;
          } else if (!item.anchor && contentMd.length > 10000 && item.category !== 'monster' && item.edition !== '2024') {
            contentMd = contentMd.slice(0, 10000);
          }
          briefMd = generateBrief(item.category, item.title, item.titleEn, contentMd);
        }
      }

      if (!contentMd && !briefMd) {
        briefMd = `[${item.category || 'general'}] ${item.title}`;
        contentMd = briefMd;
      }

      const aliasesStr = (item.aliases || []).join(', ');

      // For FTS5 trigram index: strip markdown table dividers/asterisks and cap long pages
      // so the database stays ~85 MB (well below GitHub's 100 MB file limit) while 100% of core entries are indexed in full
      const ftsCap = item.edition === '2024' ? 2400 : 1600;
      const ftsText = contentMd
        .replace(/\|\s*---\s*(?:\|\s*---\s*)*\|/g, ' ')
        .replace(/[*#|`~]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, ftsCap);

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
        ftsText
      );

      count++;
      if (count % 2000 === 0) {
        console.log(`Indexed ${count}/${rawIndex.length} entries...`);
      }
    }

    insertMeta.run('upstream_repo', 'https://github.com/DND5eChm/5echm_web');
    insertMeta.run('upstream_commit', process.env.UPSTREAM_COMMIT || 'c1425c8');
    insertMeta.run('build_date', new Date().toISOString());
    insertMeta.run('entry_count', String(count));
    insertMeta.run('fts_tokenizer', 'trigram');

    db.exec('COMMIT');

    console.log('Optimizing FTS5 trigram inverted index, running ANALYZE and VACUUM...');
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
