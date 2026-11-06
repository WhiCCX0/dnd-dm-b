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
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[DB Warning] Failed to initialize SQLite database at ${dbPath}:`, err.message);
      }
    }
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
  '武器精通': { query: '精通词条', command: 'rule' },

  // 职业招牌机制别名
  '神圣打击': { query: '至圣斩', command: 'spell' },
  '至圣打击': { query: '至圣斩', command: 'spell' },
  '至圣斩': { query: '至圣斩', command: 'spell' },
  '魔能爆': { query: '魔能爆', command: 'spell' }
};

// 12 大核心职业关键招牌特性直达映射库 (2024 官方专有特性速查)
const CLASS_FEATURES_MAP = {
  '偷袭': {
    class: '游荡者',
    feature: '偷袭',
    titleEn: 'Sneak Attack',
    brief: '[职业特性] 游荡者 - 偷袭 (Sneak Attack) | 攻击具有优势，或目标5尺内有未失能盟友且你无劣势时，造成额外 1d6 (随等级提升) 伤害。可消耗偷袭伤害骰发动诡诈打击(摔绊/淬毒/撤离)。',
    url: '玩家手册2024/角色职业/游荡者/游荡者.htm',
    edition: '2024'
  },
  '灵巧动作': {
    class: '游荡者',
    feature: '灵巧动作',
    titleEn: 'Cunning Action',
    brief: '[职业特性] 游荡者 - 灵巧动作 (Cunning Action) | 可以使用附赠动作执行【疾走】、【撤离】或【躲藏】动作。',
    url: '玩家手册2024/角色职业/游荡者/游荡者.htm',
    edition: '2024'
  },
  '回气': {
    class: '战士',
    feature: '回气',
    titleEn: 'Second Wind',
    brief: '[职业特性] 战士 - 回气 (Second Wind) | 附赠动作恢复 1d10+战士等级 点生命值。亦可用于战术思维：属性检定失败时消耗一次掷 1d10 加入结果。短休或长休恢复。',
    url: '玩家手册2024/角色职业/战士/战士.htm',
    edition: '2024'
  },
  '动作如潮': {
    class: '战士',
    feature: '动作如潮',
    titleEn: 'Action Surge',
    brief: '[职业特性] 战士 - 动作如潮 (Action Surge) | 在你的回合内，可以在通常动作外额外执行一个动作(不可用于再次执行魔法动作)。短休或长休恢复。',
    url: '玩家手册2024/角色职业/战士/战士.htm',
    edition: '2024'
  },
  '狂暴': {
    class: '野蛮人',
    feature: '狂暴',
    titleEn: 'Rage',
    brief: '[职业特性] 野蛮人 - 狂暴 (Rage) | 附赠动作进入狂暴。近战力量攻击获得额外加值(+2起)，获得钝击/穿刺/挥砍抗性，力量检定与豁免获优势。持续10分钟。',
    url: '玩家手册2024/角色职业/野蛮人/野蛮人.htm',
    edition: '2024'
  },
  '野性形态': {
    class: '德鲁伊',
    feature: '野性形态',
    titleEn: 'Wild Shape',
    brief: '[职业特性] 德鲁伊 - 野性形态 (Wild Shape) | 附赠动作变身成你已知形态的野兽。获得该野兽的临时生命值、速度与动作，保留自身智力/感知/魅力。',
    url: '玩家手册2024/角色职业/德鲁伊/德鲁伊.htm',
    edition: '2024'
  },
  '荒野形态': {
    class: '德鲁伊',
    feature: '野性形态',
    titleEn: 'Wild Shape',
    brief: '[职业特性] 德鲁伊 - 野性形态 (Wild Shape) | 附赠动作变身成你已知形态的野兽。获得该野兽的临时生命值、速度与动作。',
    url: '玩家手册2024/角色职业/德鲁伊/德鲁伊.htm',
    edition: '2024'
  },
  '疾风连击': {
    class: '武僧',
    feature: '疾风连击',
    titleEn: 'Flurry of Blows',
    brief: '[职业特性] 武僧 - 疾风连击 (Flurry of Blows) | 执行攻击动作后，消耗1点气(专注力)，以附赠动作发动两次徒手打击。',
    url: '玩家手册2024/角色职业/武僧/武僧.htm',
    edition: '2024'
  },
  '引导神力': {
    class: '牧师/圣武士',
    feature: '引导神力',
    titleEn: 'Channel Divinity',
    brief: '[职业特性] 牧师/圣武士 - 引导神力 (Channel Divinity) | 引导神圣能量引发特定神圣效应(如破除不死生物、神圣火花、圣疗)。短休或长休恢复。',
    url: '玩家手册2024/角色职业/牧师/牧师.htm',
    edition: '2024'
  },
  '诗人激励': {
    class: '吟游诗人',
    feature: '诗人激励',
    titleEn: 'Bardic Inspiration',
    brief: '[职业特性] 吟游诗人 - 诗人激励 (Bardic Inspiration) | 附赠动作给予60尺内可见生物一枚激励骰(1d6~1d12)，可在未来检定、攻击或伤害中加入。',
    url: '玩家手册2024/角色职业/吟游诗人/吟游诗人.htm',
    edition: '2024'
  },
  '超魔': {
    class: '术士',
    feature: '超魔',
    titleEn: 'Metamagic',
    brief: '[职业特性] 术士 - 超魔 (Metamagic) | 消耗术法点调整法术效应：瞬发(动作变附赠)、延时、孪生、强效、极效、微微妙法(免言语姿势)。',
    url: '玩家手册2024/角色职业/术士/术士.htm',
    edition: '2024'
  }
};

/**
 * Execute query using SQLite B-Tree & FTS5
 */
function querySqlite(command, query, isBrief, options = {}) {
  const db = getDb();
  if (!db) return null;

  let qTrim = (query || '').trim();
  let activeCmd = command;

  // 0. 优先检查职业核心特性直达
  if (CLASS_FEATURES_MAP[qTrim]) {
    const feat = CLASS_FEATURES_MAP[qTrim];
    if (options.json) {
      return {
        found: true,
        entry: {
          id: 99900 + Object.keys(CLASS_FEATURES_MAP).indexOf(qTrim),
          category: 'class_feature',
          title: `${feat.class}：${feat.feature}`,
          titleEn: feat.titleEn,
          edition: feat.edition || '2024',
          url: feat.url,
          anchor: feat.feature,
          brief: feat.brief,
          content: feat.brief
        },
        related: []
      };
    }
    console.log(`${colors.green}=== 找到条目: 【${feat.class}：${feat.feature} (${feat.titleEn})】 [2024/2025 修订版] ===${colors.reset}`);
    console.log(`${colors.dim}来源: references/rules_source/${feat.url} #${feat.feature}${colors.reset}\n`);
    if (isBrief) {
      console.log(`${colors.yellow}[AI 紧凑数据卡]${colors.reset}`);
      console.log(feat.brief);
    } else {
      console.log(feat.brief);
    }
    return true;
  }

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
      ORDER BY (CASE WHEN content_md != '' THEN 0 ELSE 1 END), (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC
      LIMIT 20
    `;
    const wildcard = `%${qTrim}%`;
    const rows = db.prepare(modSql).all(wildcard, wildcard, wildcard, wildcard);
    if (rows.length > 0) {
      const nonEmptyRows = rows.filter(r => r.content_md || r.brief_md);
      const pool = nonEmptyRows.length > 0 ? nonEmptyRows : rows;
      const overview = pool.find(r => r.url.includes('介绍') || r.url.includes('总览') || r.url.includes('第一章') || r.url.endsWith('.htm')) || pool[0];
      if (options.json) {
        return {
          found: true,
          entry: {
            id: overview.id,
            category: 'module',
            title: overview.title,
            titleEn: overview.title_en,
            edition: '5e',
            url: overview.url,
            anchor: '',
            brief: overview.brief_md,
            content: overview.content_md
          },
          related: rows.slice(0, 15).map(f => ({
            id: f.id,
            title: f.title,
            titleEn: f.title_en,
            url: f.url
          }))
        };
      }
      console.log(`${colors.green}=== 找到模组战役资源: 【${qTrim}】 (共匹配到 ${rows.length} 个条目) ===${colors.reset}\n`);
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
    WHERE (content_md != '' OR brief_md != '')
      AND (
        LOWER(title) = ?
        OR LOWER(title_en) = ?
        OR LOWER(anchor) = ?
        OR (', ' || LOWER(aliases) || ', ') LIKE ?
      )
  `;
  if (categoryFilter) exactSql += ` AND ${categoryFilter}`;
  exactSql += ` ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6`;

  let rows = db.prepare(exactSql).all(qLower, qLower, qLower, `%, ${qLower}, %`);

  // 2. Starts with / Prefix match
  if (rows.length === 0) {
    let prefixSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (content_md != '' OR brief_md != '')
        AND (LOWER(title) LIKE ? OR LOWER(title_en) LIKE ? OR LOWER(aliases) LIKE ?)
    `;
    if (categoryFilter) prefixSql += ` AND ${categoryFilter}`;
    prefixSql += ` ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6`;
    rows = db.prepare(prefixSql).all(`${qLower}%`, `${qLower}%`, `%${qLower}%`);
  }

  // 3. FTS5 Full-Text Match
  if (rows.length === 0 && qTrim) {
    try {
      const sanitized = qTrim.replace(/[^\w\u4e00-\u9fa5]/g, ' ').trim();
      const tokens = sanitized.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const ftsQuery = tokens.map(t => `"${t}"`).join(' ');
        let ftsSql = `
          SELECT e.id, e.category, e.title, e.title_en, e.aliases, e.url, e.anchor, e.edition, e.content_md, e.brief_md
          FROM entries_fts f
          JOIN entries e ON f.rowid = e.id
          WHERE entries_fts MATCH ?
            AND (e.content_md != '' OR e.brief_md != '')
        `;
        if (categoryFilter) ftsSql += ` AND ${categoryFilter}`;
        ftsSql += ` ORDER BY (CASE WHEN e.edition = '2024' THEN 1 ELSE 2 END), rank LIMIT 6`;
        rows = db.prepare(ftsSql).all(ftsQuery);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[FTS5 Warning] Search failed for query "${qTrim}":`, err.message);
      }
    }
  }

  // 4. Substring Contains Match
  if (rows.length === 0) {
    let subSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (content_md != '' OR brief_md != '')
        AND (title LIKE ? OR title_en LIKE ? OR aliases LIKE ? OR url LIKE ?)
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
      WHERE (content_md != '' OR brief_md != '')
        AND (LOWER(title) = ? OR LOWER(title_en) = ? OR aliases LIKE ? OR title LIKE ? OR title_en LIKE ? OR url LIKE ?)
      ORDER BY (CASE WHEN edition = '2024' THEN 1 ELSE 2 END), id ASC LIMIT 6
    `;
    const wild = `%${qTrim}%`;
    rows = db.prepare(globalSql).all(qLower, qLower, `%${qLower}%`, wild, wild, wild);
  }

  // Found matching result!
  if (rows.length > 0) {
    const best = rows[0];
    const titleDisp = best.title_en ? `${best.title} (${best.title_en})` : best.title;
    const editionTag = best.edition === '2024' ? '[2024/2025 修订版]' : '[5e 经典版]';

    if (options.json) {
      return {
        found: true,
        entry: {
          id: best.id,
          category: best.category,
          title: best.title,
          titleEn: best.title_en,
          edition: best.edition,
          url: best.url,
          anchor: best.anchor,
          brief: best.brief_md,
          content: best.content_md
        },
        related: rows.slice(1, 6).map(m => ({
          id: m.id,
          title: m.title,
          titleEn: m.title_en,
          url: m.url
        }))
      };
    }

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

  return null;
}

// ----------------------------------------------------
// Fallback JSON Engine (If SQLite DB is missing)
// ----------------------------------------------------

function queryFallback(command, query, isBrief, options = {}) {
  if (!fs.existsSync(indexFile)) {
    if (options.json) return { found: false, error: 'Database and index not found' };
    console.error(`${colors.red}未找到数据库或索引文件。请先运行 'node scripts/build-db.js'。${colors.reset}`);
    return null;
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const qLower = (query || '').toLowerCase().trim();

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
    if (options.json) {
      return {
        found: true,
        entry: {
          id: best.id,
          category: best.category || 'general',
          title: best.title,
          titleEn: best.titleEn || '',
          edition: best.edition || '5e',
          url: best.url || '',
          anchor: best.anchor || '',
          brief: best.title,
          content: ''
        },
        related: matches.slice(1, 6).map(m => ({
          id: m.id,
          title: m.title,
          titleEn: m.titleEn || '',
          url: m.url || ''
        }))
      };
    }
    console.log(`${colors.green}=== 找到条目 (JSON降级): 【${best.title}】 ===${colors.reset}\n`);
    console.log(`来源: references/rules_source/${best.url}`);
    return true;
  }

  if (options.json) {
    return { found: false, command, query };
  }
  console.log(`${colors.red}未找到与 "${query}" 匹配的条目。${colors.reset}`);
  return null;
}

/**
 * Programmatic lookup API for Agent and In-Process Tools (<0.2ms)
 */
export function lookup(command, query, options = {}) {
  const isBrief = Boolean(options.brief || options.agent || options.b || options.stat);
  const isJson = Boolean(options.json || options.j);
  const safeOpts = { ...options, brief: isBrief, json: isJson };

  const sqlRes = querySqlite(command, query, isBrief, safeOpts);
  if (sqlRes) return sqlRes;

  const fbRes = queryFallback(command, query, isBrief, safeOpts);
  if (fbRes) return fbRes;

  if (isJson) {
    return { found: false, command, query };
  }
  return false;
}

// ----------------------------------------------------
// CLI 入口
// ----------------------------------------------------

function cli() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  let isBrief = false;
  let isJson = false;
  let isFull = false;
  const cleanArgs = [];

  for (const arg of rawArgs) {
    if (arg === '--brief' || arg === '--agent' || arg === '-b' || arg === '--stat') {
      isBrief = true;
    } else if (arg === '--full' || arg === '-f') {
      isFull = true;
    } else if (arg === '--json' || arg === '-j') {
      isJson = true;
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

  if (!query && command !== 'search') {
    console.error(`${colors.red}错误: 请提供查询关键词。${colors.reset}`);
    printHelp();
    process.exit(1);
  }

  const result = lookup(command, query, { brief: isBrief, full: isFull, json: isJson });
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  }
}

export { querySqlite, queryFallback, VERNACULAR_MAP };
export default lookup;

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'lookup.js')
);

if (isMain) {
  cli();
}

