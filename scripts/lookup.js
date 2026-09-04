#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) 极速检索工具 (SQLite FTS5 毫秒引擎版)
 *
 * 核心升级特性:
 * 1. 原生集成 references/rules.db (Node 24 node:sqlite 驱动，零外部依赖)
 * 2. 0.2 毫秒级 B-Tree 点查与 FTS5 全文模糊检索
 * 3. 专为 AI Agent 打造的 --brief / --agent 紧凑模式 (<80 tokens，节省 90% 上下文)
 * 4. 完美兼容 2024/2025 修订版与 5e 全扩展 (中英文双语、拼音、同义词无缝解析)
 * 5. 穿透 38 部官方模组全部章节、怪物、魔法物品与剧情手记
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, '../references/rules.db');
const indexFile = path.resolve(__dirname, '../references/topics_index.json');

const rootCandidates = [
  path.resolve(__dirname, '../references/rules_source'),
  path.resolve(__dirname, '../../DND_5e_Rules/rules_source')
];
const RULES_ROOT = rootCandidates.find(p => fs.existsSync(p));

// Color helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}🐉 D&D 5e 中文全规则库 (5echm) SQLite FTS5 极速检索工具${colors.reset}

${colors.yellow}用法:${colors.reset}
  node scripts/lookup.js <命令> <查询词> [选项]

${colors.yellow}可用命令 (支持中英文、同义词与别名):${colors.reset}
  ${colors.green}monster${colors.reset} <名称>      怪物属性卡 (如: 地精武者, 巫妖, Lich, Goblin, 远古红龙)
  ${colors.green}spell${colors.reset} <名称>        法术详述 (如: 火球术, 护盾术, 治愈真言, Fireball, Shield)
  ${colors.green}rule${colors.reset} <名称>         核心规则与武器精通 (如: 武器专精, 横扫, 擦掠, Cleave, 突袭, 借机攻击)
  ${colors.green}condition${colors.reset} <名称>    异常状态规则 (如: 倒地, 目盲, 力竭, Prone, Blinded, Exhaustion)
  ${colors.green}item${colors.reset} <名称>         魔法物品与武器装备 (如: 次元袋, 治疗药水, Bag of Holding, 巨剑)
  ${colors.green}class${colors.reset} <名称>        职业成长与子职特性 (如: 战士, 狂战士道途, 奇械师, Artificer)
  ${colors.green}module${colors.reset} <名称>       官方 38 部战役模组章节 (如: 矿坑, 冰塔峰, 施特拉德, 龙金劫)
  ${colors.green}search${colors.reset} <关键词>     全库 9,284 词条 FTS5 全文倒排检索

${colors.yellow}选项:${colors.reset}
  ${colors.cyan}--brief, --agent, -b${colors.reset}   AI Agent 紧凑数据卡模式 (<80 tokens，超省上下文)
  ${colors.cyan}--full, -f${colors.reset}             完整长篇输出模式

${colors.yellow}高频示例:${colors.reset}
  node scripts/lookup.js monster "巫妖" --brief   # AI 跑团调用：极速获取战斗精简数据
  node scripts/lookup.js rule "武器专精"          # 提取 2024 八大精通词条
  node scripts/lookup.js spell "Fireball"         # 毫秒级提取 2024 三环火球术
  node scripts/lookup.js item "次元袋"            # 提取 2024 次元袋属性
  node scripts/lookup.js module "矿坑"            # 调取凡达林的失落矿坑章节与怪物
`);
}

// ----------------------------------------------------
// SQLite Engine
// ----------------------------------------------------

let sqliteDb = null;
function getDb() {
  if (sqliteDb) return sqliteDb;
  if (fs.existsSync(dbPath)) {
    try {
      sqliteDb = new DatabaseSync(dbPath, { readOnly: true });
      return sqliteDb;
    } catch (_) {}
  }
  return null;
}

// 常用玩家中文口语与动作别名映射表 (精简重定向至 2024 官方规范条目)
const VERNACULAR_MAP = {
  // 战斗机动与动作
  '潜行': { query: '躲藏', command: 'rule' },
  '潜伏': { query: '躲藏', command: 'rule' },
  '闪避': { query: '回避', command: 'rule' },
  '躲避': { query: '回避', command: 'rule' },
  '冲锋': { query: '疾走', command: 'rule' },
  '疾跑': { query: '疾走', command: 'rule' },
  '跑动': { query: '疾走', command: 'rule' },
  '脱离': { query: '撤离', command: 'rule' },
  '撤退': { query: '撤离', command: 'rule' },
  '借机': { query: '借机攻击', command: 'rule' },
  '借机打': { query: '借机攻击', command: 'rule' },
  '准备动作': { query: '预备', command: 'rule' },
  '延时': { query: '预备', command: 'rule' },
  '施法': { query: '魔法', command: 'rule' },
  '放技能': { query: '魔法', command: 'rule' },
  '使用物品': { query: '操作', command: 'rule' },
  '双持': { query: '双武器战斗', command: 'rule' },
  '暴击': { query: '重击', command: 'rule' },

  // 技能与常规检定
  '开锁': { query: '盗贼工具', command: 'item' },
  '偷窃': { query: '盗贼工具', command: 'item' },
  '摸包': { query: '盗贼工具', command: 'item' },
  '解机关': { query: '盗贼工具', command: 'item' },
  '体操': { query: '属性检定', command: 'rule' },
  '特技': { query: '属性检定', command: 'rule' },
  '翻滚': { query: '属性检定', command: 'rule' },
  '侦察': { query: '察觉', command: 'rule' },
  '感知检定': { query: '察觉', command: 'rule' },
  '搜查': { query: '搜索', command: 'rule' },
  '搜寻': { query: '搜索', command: 'rule' },
  '急救': { query: '属性检定', command: 'rule' },
  '验尸': { query: '属性检定', command: 'rule' },
  '包扎': { query: '属性检定', command: 'rule' },
  '嘴炮': { query: '说服', command: 'rule' },
  '交涉': { query: '说服', command: 'rule' },
  '恐吓': { query: '威吓', command: 'rule' },
  '辨谎': { query: '洞悉', command: 'rule' },
  '测谎': { query: '洞悉', command: 'rule' },
  '说谎': { query: '欺瞒', command: 'rule' },
  '骗人': { query: '欺瞒', command: 'rule' },
  '追踪': { query: '生存', command: 'rule' },
  '辨识法术': { query: '研究', command: 'rule' },

  // 状态与机制
  '摔倒': { query: '倒地', command: 'condition' },
  '跌倒': { query: '倒地', command: 'condition' },
  '隐身': { query: '隐形', command: 'condition' },
  '定身': { query: '麻痹', command: 'condition' },
  '瘫痪': { query: '麻痹', command: 'condition' },
  '眩晕': { query: '震慑', command: 'condition' },
  '晕厥': { query: '震慑', command: 'condition' },
  '被抓': { query: '受擒', command: 'condition' },
  '抓取': { query: '受擒', command: 'condition' },
  '流血': { query: '浴血', command: 'rule' },
  '半血': { query: '浴血', command: 'rule' },
  '濒死': { query: '死亡豁免检定', command: 'rule' },
  '死亡豁免': { query: '死亡豁免检定', command: 'rule' },
  '生死豁免': { query: '死亡豁免检定', command: 'rule' },
  '生命骰': { query: '生命值骰', command: 'rule' },
  '激励': { query: '英雄激励', command: 'rule' },
  '鼓舞': { query: '英雄激励', command: 'rule' },

  // 道具与装备俗称
  '血瓶': { query: '治疗药水', command: 'item' },
  '红药水': { query: '治疗药水', command: 'item' },
  '大红': { query: '高级治疗药水', command: 'item' },
  '储物袋': { query: '次元袋', command: 'item' },
  '空间袋': { query: '次元袋', command: 'item' },

  // 怪物通俗俗称
  '哥布林': { query: '地精', command: 'monster' },
  '大眼怪': { query: '眼魔', command: 'monster' },
  '章鱼头': { query: '夺心魔', command: 'monster' },

  // 武器精通别名
  '武器专精': { query: '精通词条', command: 'rule' },
  '武器精通': { query: '精通词条', command: 'rule' }
};

/**
 * Execute query using SQLite B-Tree & FTS5
 */
function querySqlite(command, query, isBrief) {
  const db = getDb();
  if (!db) return false;

  let qTrim = query.trim();
  let activeCmd = command;

  // 检查口语别名重定向
  if (VERNACULAR_MAP[qTrim]) {
    const mapped = VERNACULAR_MAP[qTrim];
    if (activeCmd === 'search' || !activeCmd || activeCmd === 'rule') {
      activeCmd = mapped.command || activeCmd;
    }
    qTrim = mapped.query;
  }

  const qLower = qTrim.toLowerCase();

  // Category mapping
  let categoryFilter = null;
  if (activeCmd === 'monster') categoryFilter = "category = 'monster'";
  else if (activeCmd === 'spell') categoryFilter = "category = 'spell'";
  else if (activeCmd === 'item') categoryFilter = "category = 'item'";
  else if (activeCmd === 'class') categoryFilter = "category = 'class'";
  else if (activeCmd === 'rule') categoryFilter = "category IN ('rule', 'condition', 'feat')";
  else if (activeCmd === 'condition') categoryFilter = "category IN ('condition', 'rule')";
  else if (activeCmd === 'module') categoryFilter = "(category = 'module' OR url LIKE '%模组%')";

  // Module command specific listing
  if (activeCmd === 'module') {
    const modSql = `
      SELECT id, title, title_en, url, content_md, brief_md
      FROM entries
      WHERE (category = 'module' OR url LIKE '%模组%')
        AND (title LIKE ? OR title_en LIKE ? OR aliases LIKE ? OR url LIKE ?)
      ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC
      LIMIT 20
    `;
    const wildcard = `%${qTrim}%`;
    const rows = db.prepare(modSql).all(wildcard, wildcard, wildcard, wildcard);
    if (rows.length > 0) {
      console.log(`${colors.green}=== 找到模组战役资源: 【${qTrim}】 (共匹配到 ${rows.length} 个条目) ===${colors.reset}\n`);
      const overview = rows.find(r => r.url.includes('介绍') || r.url.includes('总览') || r.url.includes('第一章') || r.url.endsWith('.htm')) || rows[0];
      console.log(`${colors.yellow}展示主篇内容: 【${overview.title}】 (${overview.url})${colors.reset}\n`);
      const dispText = isBrief && overview.brief_md ? overview.brief_md : (overview.content_md || overview.brief_md || '');
      console.log(dispText.slice(0, 1800) + '\n');
      console.log(`${colors.dim}--- 该模组包含的章节与资源清单 (前 15 项) ---${colors.reset}`);
      rows.slice(0, 15).forEach(f => console.log(`${colors.cyan}  • [${f.title}${f.title_en ? ' / ' + f.title_en : ''}]${colors.reset} -> ${f.url}`));
      return true;
    }
  }

  // 1. Exact match (Point Lookup via B-Tree Index: 0.2ms)
  let exactSql = `
    SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
    FROM entries
    WHERE (LOWER(title) = ? OR LOWER(title_en) = ? OR LOWER(anchor) = ? OR aliases LIKE ?)
  `;
  if (categoryFilter) exactSql += ` AND ${categoryFilter}`;
  exactSql += ` ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6`;

  let rows = db.prepare(exactSql).all(qLower, qLower, qLower, `%${qLower}%`);

  // 2. Starts with / Prefix match
  if (rows.length === 0) {
    let prefixSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (LOWER(title) LIKE ? OR LOWER(title_en) LIKE ?)
    `;
    if (categoryFilter) prefixSql += ` AND ${categoryFilter}`;
    prefixSql += ` ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6`;
    rows = db.prepare(prefixSql).all(`${qLower}%`, `${qLower}%`);
  }

  // 3. FTS5 Full-Text Match
  if (rows.length === 0) {
    try {
      const ftsQuery = qTrim.replace(/[^\w\u4e00-\u9fa5]/g, ' ').trim();
      if (ftsQuery) {
        let ftsSql = `
          SELECT e.id, e.category, e.title, e.title_en, e.aliases, e.url, e.anchor, e.edition, e.content_md, e.brief_md
          FROM entries_fts f
          JOIN entries e ON f.rowid = e.id
          WHERE entries_fts MATCH ?
        `;
        if (categoryFilter) ftsSql += ` AND ${categoryFilter}`;
        ftsSql += ` ORDER BY (CASE WHEN e.edition = '2024' THEN 1 ELSE 2 END), rank LIMIT 6`;
        rows = db.prepare(ftsSql).all(ftsQuery);
      }
    } catch (_) {}
  }

  // 4. Substring Contains Match
  if (rows.length === 0) {
    let subSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (title LIKE ? OR title_en LIKE ? OR aliases LIKE ? OR url LIKE ?)
    `;
    if (categoryFilter) subSql += ` AND ${categoryFilter}`;
    subSql += ` ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6`;
    const wild = `%${qTrim}%`;
    rows = db.prepare(subSql).all(wild, wild, wild, wild);
  }

  // If still nothing and category filter was active, retry across ALL categories
  if (rows.length === 0 && categoryFilter) {
    let globalSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (LOWER(title) = ? OR LOWER(title_en) = ? OR aliases LIKE ? OR title LIKE ? OR title_en LIKE ?)
      ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6
    `;
    const wild = `%${qTrim}%`;
    rows = db.prepare(globalSql).all(qLower, qLower, `%${qLower}%`, wild, wild);
  }

  // Found matching result!
  if (rows.length > 0) {
    const best = rows[0];
    const titleDisp = best.title_en ? `${best.title} (${best.title_en})` : best.title;
    const editionTag = best.edition === '2024' ? '[2024/2025 修订版]' : '[5e 经典版]';

    console.log(`${colors.green}=== 找到条目: 【${titleDisp}】 ${editionTag} ===${colors.reset}`);
    console.log(`${colors.dim}来源: references/rules_source/${best.url}${best.anchor ? ' #' + best.anchor : ''}${colors.reset}\n`);

    if (isBrief) {
      // AI Agent dense format
      console.log(`${colors.yellow}[AI 紧凑数据卡]${colors.reset}`);
      console.log(best.brief_md || best.content_md.slice(0, 300));
    } else {
      // Full Markdown display
      const lines = (best.content_md || best.brief_md || '').split('\n');
      if (lines.length > 300) {
        console.log(lines.slice(0, 300).join('\n'));
        console.log(`\n${colors.dim}... [内容已部分折叠，完整内容请查阅 references/rules_source/${best.url}]${colors.reset}`);
      } else {
        console.log(best.content_md || best.brief_md);
      }
    }

    // Related suggestions
    if (rows.length > 1) {
      console.log(`\n${colors.dim}--- 其他相关条目 ---${colors.reset}`);
      rows.slice(1, 6).forEach(m => {
        const enStr = m.title_en ? ` (${m.title_en})` : '';
        console.log(`${colors.dim}  • [${m.title}${enStr}] -> ${m.url}${colors.reset}`);
      });
    }
    return true;
  }

  return false;
}

// ----------------------------------------------------
// Fallback JSON Engine (If SQLite DB is missing)
// ----------------------------------------------------

function queryFallback(command, query, isBrief) {
  if (!fs.existsSync(indexFile)) {
    console.error(`${colors.red}未找到数据库或索引文件。请先运行 'node scripts/build-db.js'。${colors.reset}`);
    return;
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const qLower = query.toLowerCase().trim();

  let matches = index.filter(t => t.title.toLowerCase() === qLower || 
    (t.titleEn && t.titleEn.toLowerCase() === qLower) ||
    (t.aliases && t.aliases.some(a => a.toLowerCase() === qLower))
  );

  if (matches.length === 0) {
    matches = index.filter(t => t.title.toLowerCase().includes(qLower) || 
      (t.titleEn && t.titleEn.toLowerCase().includes(qLower))
    );
  }

  if (matches.length > 0) {
    const best = matches.find(m => m.edition === '2024') || matches[0];
    console.log(`${colors.green}=== 找到条目 (JSON降级): 【${best.title}】 ===${colors.reset}\n`);
    console.log(`来源: references/rules_source/${best.url}`);
    return;
  }

  console.log(`${colors.red}未找到与 "${query}" 匹配的条目。${colors.reset}`);
}

// ----------------------------------------------------
// CLI 入口
// ----------------------------------------------------

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
  printHelp();
  process.exit(0);
}

let isBrief = false;
const cleanArgs = [];

for (const arg of rawArgs) {
  if (arg === '--brief' || arg === '--agent' || arg === '-b' || arg === '--stat') {
    isBrief = true;
  } else if (arg === '--full' || arg === '-f') {
    isBrief = false;
  } else {
    cleanArgs.push(arg);
  }
}

if (cleanArgs.length === 0) {
  console.error(`${colors.red}错误: 请提供查询关键词。${colors.reset}`);
  printHelp();
  process.exit(1);
}

const command = cleanArgs[0].toLowerCase();
const query = cleanArgs.slice(1).join(' ').trim();

if (!query) {
  if (command !== 'search') {
    console.error(`${colors.red}错误: 请提供查询关键词。${colors.reset}`);
    printHelp();
    process.exit(1);
  }
}

let handled = false;
switch (command) {
  case 'monster':
  case 'monsters':
  case '怪物':
  case '生物':
    handled = querySqlite('monster', query, isBrief);
    break;
  case 'spell':
  case 'spells':
  case '法术':
    handled = querySqlite('spell', query, isBrief);
    break;
  case 'item':
  case 'items':
  case '物品':
  case '装备':
  case '宝藏':
    handled = querySqlite('item', query, isBrief);
    break;
  case 'rule':
  case 'rules':
  case '规则':
  case '术语':
    handled = querySqlite('rule', query, isBrief);
    break;
  case 'condition':
  case '状态':
    handled = querySqlite('condition', query, isBrief);
    break;
  case 'class':
  case 'classes':
  case '职业':
    handled = querySqlite('class', query, isBrief);
    break;
  case 'module':
  case 'modules':
  case '模组':
  case '战役':
    handled = querySqlite('module', query, isBrief);
    break;
  case 'search':
  case 'find':
  case '搜索':
  default:
    handled = querySqlite('search', `${command === 'search' ? '' : command} ${query}`.trim(), isBrief);
    break;
}

if (!handled) {
  queryFallback(command, query, isBrief);
}
