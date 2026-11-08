#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) 极速检索工具 (SQLite FTS5 Trigram 毫秒引擎版)
 *
 * 核心升级特性:
 * 1. 原生集成 references/rules.db (Node 22.16+ node:sqlite 驱动，零外部依赖)
 * 2. B-Tree 表达式索引点查与 FTS5 Trigram 全文倒排检索 (支持任意中文子串与正文 content_md 检索)
 * 3. 专为 AI Agent 打造的 --brief / --agent 紧凑模式 (保留完整骰子算式、豁免与动作，省去冗余关联列表)
 * 4. 严格遵循 D&D 2024/2025 规则文本，相关性优先于版本号排序，怪物检索优先返回数据卡而非背景设定页
 * 5. 官方模组 (module) 精确目录映射与资源分类展示，诚实标注附录范围并提供 DMG 2024 范例冒险直达
 */

import fs from 'fs';
import { createRequire } from 'node:module';
import path from 'path';
import { fileURLToPath } from 'url';
import { assertFts5Support } from './sqlite-capability.js';

let fts5SupportChecked = false;
function ensureFts5Support() {
  if (fts5SupportChecked) return;
  assertFts5Support();
  fts5SupportChecked = true;
}

const _require = createRequire(import.meta.url);
let _DatabaseSync = null;

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

function getDatabaseSync() {
  if (!_DatabaseSync) {
    _DatabaseSync = withSqliteWarningSuppressed(() => _require('node:sqlite').DatabaseSync);
  }
  return _DatabaseSync;
}

function openDatabaseSync(...args) {
  const DatabaseSync = getDatabaseSync();
  return withSqliteWarningSuppressed(() => new DatabaseSync(...args));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function resolveDbPath() {
  if (process.env.DND_DB_PATH) return path.resolve(process.env.DND_DB_PATH);
  if (process.env.DND_DB_DIR) return path.resolve(process.env.DND_DB_DIR, 'rules.db');
  return path.resolve(ROOT_DIR, 'references/rules.db');
}

function resolveIndexPath() {
  if (process.env.DND_INDEX_PATH) return path.resolve(process.env.DND_INDEX_PATH);
  if (process.env.DND_DB_DIR) return path.resolve(process.env.DND_DB_DIR, 'topics_index.json');
  return path.resolve(ROOT_DIR, 'references/topics_index.json');
}

export const VALID_COMMANDS = new Set([
  'monster',
  'spell',
  'rule',
  'condition',
  'item',
  'class',
  'module',
  'search',
  'feat',
  'origin',
  'lore'
]);

const useColor = Boolean(process.stdout && process.stdout.isTTY && !process.env.NO_COLOR);

// Color helpers (auto-disabled when stdout is not a TTY or NO_COLOR is set)
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bright: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  blue: useColor ? '\x1b[34m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  red: useColor ? '\x1b[31m' : '',
};

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}🐉 D&D 5e 中文全规则库 (5echm) SQLite FTS5 极速检索工具${colors.reset}

${colors.yellow}用法:${colors.reset}
  node scripts/lookup.js <命令> <查询词> [选项]

${colors.yellow}可用命令 (支持中英文、同义词与别名):${colors.reset}
  ${colors.green}monster${colors.reset} <名称>      怪物属性卡 (如: 地精武者, 巫妖, 狼, Goblin, 远古红龙)
  ${colors.green}spell${colors.reset} <名称>        法术详述 (如: 火球术, 护盾术, 恶言相加, Fireball, Shield)
  ${colors.green}rule${colors.reset} <名称>         核心规则与武器精通 (如: 武器专精, 横扫, 擦掠, Cleave, 突袭, 借机攻击)
  ${colors.green}condition${colors.reset} <名称>    异常状态规则 (如: 倒地, 目盲, 力竭, 恐慌, Prone, Exhaustion)
  ${colors.green}item${colors.reset} <名称>         魔法物品与武器装备 (如: 次元袋, 治疗药水, 触月长剑, 鸦族圣徽)
  ${colors.green}class${colors.reset} <名称>        职业成长与子职特性 (如: 战士, 圣武士, 圣疗, 回气, 奇械师)
  ${colors.green}feat${colors.reset} <名称>         2024 起源/通用/战斗风格/传奇恩惠专长 (如: 警戒, 健壮, 巨武器大师)
  ${colors.green}origin${colors.reset} <名称>       种族/物种与背景 (如: 矮人, 精灵, 侍僧, 罪犯)
  ${colors.green}module${colors.reset} <名称>       DMG 2024 范例冒险全文及 5e 官方模组附录资源 (如: 秽染溪泉, 矿坑, 施特拉德)
  ${colors.green}lore${colors.reset} <设定词>       剑火纪元设定按需切片检索 (默认仅检索公开 lore/，加 --gm 检索 secret/)
  ${colors.green}search${colors.reset} <关键词>     全库 FTS5 Trigram 全文检索 (覆盖标题、别名与完整正文)

${colors.yellow}选项:${colors.reset}
  ${colors.cyan}--brief, --agent, -b${colors.reset}   AI Agent 紧凑数据卡模式 (保留完整骰子与机制，省略关联列表)
  ${colors.cyan}--full, -f${colors.reset}             完整长篇输出模式 (不折叠超过 300 行的长文)
  ${colors.cyan}--json, -j${colors.reset}             输出结构化 JSON 对象
  ${colors.cyan}--gm${colors.reset}                   在 lore 命令中允许检索 worlds/jianhuo/secret/ 内档真相

${colors.yellow}高频示例:${colors.reset}
  node scripts/lookup.js monster "地精武者" --brief # AI 跑团调用：获取完整五维与动作数据卡
  node scripts/lookup.js rule "武器专精"            # 提取 2024 八大精通词条完整列表
  node scripts/lookup.js spell "火球术" --brief     # 提取 2024 火球术紧凑卡 (含 8d6 与升环)
  node scripts/lookup.js item "治疗药水" --brief    # 提取 2024 治疗药水紧凑卡 (含 2d4+2 简表)
  node scripts/lookup.js module "秽染溪泉"          # 调取 DMG 2024 官方 1 级冒险全文
  node scripts/lookup.js lore "铁锚自由同盟" --brief # 调取剑火纪元公开设定切片
`);
}

// ----------------------------------------------------
// SQLite Engine & Statement Cache
// ----------------------------------------------------

let sqliteDb = null;
let sqliteDbPath = null;
const stmtCache = new Map();

function getDb() {
  const currentDbPath = resolveDbPath();
  if (sqliteDb && sqliteDbPath === currentDbPath) return sqliteDb;
  if (sqliteDb) {
    try { sqliteDb.close(); } catch (_) {}
    sqliteDb = null;
    sqliteDbPath = null;
    stmtCache.clear();
  }
  if (fs.existsSync(currentDbPath)) {
    try {
      sqliteDb = openDatabaseSync(currentDbPath, { readOnly: true });
      sqliteDbPath = currentDbPath;
      stmtCache.clear();
      return sqliteDb;
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[DB Warning] Failed to initialize SQLite database at ${currentDbPath}:`, err.message);
      }
    }
  }
  return null;
}

function prepareCached(db, sql) {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

export function escapeLike(str) {
  return String(str).replace(/[\\%_]/g, '\\$&');
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

  // 状态与机制 (修正 晕厥 -> 昏迷，与 眩晕 -> 震慑 区分)
  '摔倒': { query: '倒地', command: 'condition' },
  '跌倒': { query: '倒地', command: 'condition' },
  '隐身': { query: '隐形', command: 'condition' },
  '定身': { query: '麻痹', command: 'condition' },
  '瘫痪': { query: '麻痹', command: 'condition' },
  '眩晕': { query: '震慑', command: 'condition' },
  '晕厥': { query: '昏迷', command: 'condition' },
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

  // 道具、武器与工具常用异译/俗称
  '血瓶': { query: '治疗药水', command: 'item' },
  '红药水': { query: '治疗药水', command: 'item' },
  '大红': { query: '高等治疗药水', command: 'item' },
  '高级治疗药水': { query: '高等治疗药水', command: 'item' },
  '储物袋': { query: '次元袋', command: 'item' },
  '空间袋': { query: '次元袋', command: 'item' },
  '日圣符': { query: '鸦族圣徽', command: 'item' },
  '渡鸦圣徽': { query: '鸦族圣徽', command: 'item' },
  '麻绳': { query: '绳索', command: 'item' },
  '丝绳': { query: '绳索', command: 'item' },
  '草药师工具': { query: '草药工具', command: 'item' },
  '炼金术士工具': { query: '炼金工具', command: 'item' },
  '酿酒师工具': { query: '酿酒工具', command: 'item' },
  '制图师工具': { query: '制图工具', command: 'item' },
  '毒药师工具': { query: '毒药工具', command: 'item' },
  '大砍刀': { query: '长柄刀', command: 'item' },
  '大斧': { query: '巨斧', command: 'item' },
  '细剑': { query: '刺剑', command: 'item' },
  '连枷': { query: '链枷', command: 'item' },
  '晨星锤': { query: '钉头锤', command: 'item' },
  '条板甲': { query: '板条甲', command: 'item' },

  // 角色起源异译
  '农夫': { query: '农民', command: 'origin' },
  '流浪儿': { query: '流浪者', command: 'origin' },

  // 怪物通俗俗称
  '哥布林': { query: '地精', command: 'monster' },
  '大眼怪': { query: '眼魔', command: 'monster' },
  '章鱼头': { query: '夺心魔', command: 'monster' },

  // 武器精通别名
  '武器精通': { query: '精通词条', command: 'rule' },
  '武器专精': { query: '精通词条', command: 'rule' },
  '精通词条': { query: '精通词条', command: 'rule' },

  // 法术与职业特性常用旧译/异译
  '复苏之风': { query: '回气', command: 'rule' },
  '恶言相向': { query: '恶言相加', command: 'spell' },
  '地狱之斥': { query: '炼狱叱喝', command: 'spell' },
  '圣疗术': { query: '圣疗', command: 'class' },
  '神圣打击': { query: '至圣斩', command: 'spell' },
  '至圣打击': { query: '至圣斩', command: 'spell' },
  '至圣斩': { query: '至圣斩', command: 'spell' },
  '魔能爆': { query: '魔能爆', command: 'spell' }
};

// 12 大核心职业关键招牌特性直达映射库 (严格对齐 2024 玩家手册规则原文与锚点)
export const CLASS_FEATURES_MAP = {
  '偷袭': {
    class: '游荡者',
    feature: '偷袭',
    titleEn: 'Sneak Attack',
    brief: '[职业特性] 游荡者 - 偷袭 (Sneak Attack) | 每回合一次，当你使用具有灵巧(Finesse)词条或远程武器发动的攻击检定命中目标，且你在该检定中具有优势，或目标5尺内有至少一名未处于失能状态的你的盟友且你在该检定中不具有劣势时，可对目标造成额外 1d6 (随游荡者等级提升) 点伤害。第5级起可消耗偷袭伤害骰发动【诡诈打击】(撤离/摔绊/淬毒)。',
    url: '玩家手册2024/角色职业/游荡者/游荡者.htm',
    anchor: '1级：偷袭',
    edition: '2024'
  },
  '灵巧动作': {
    class: '游荡者',
    feature: '灵巧动作',
    titleEn: 'Cunning Action',
    brief: '[职业特性] 游荡者 - 灵巧动作 (Cunning Action) | 在你的回合内，你可以使用附赠动作执行【疾走】、【撤离】或【躲藏】动作。',
    url: '玩家手册2024/角色职业/游荡者/游荡者.htm',
    anchor: '2级：灵巧动作',
    edition: '2024'
  },
  '回气': {
    class: '战士',
    feature: '回气',
    titleEn: 'Second Wind',
    brief: '[职业特性] 战士 - 回气 (Second Wind) | 以附赠动作恢复 1d10 + 战士等级 点生命值。2级解锁【战术思维】：属性检定失败时可消耗一次回气掷 1d10 加入检定(若仍失败则不消耗)。1级可使用2次(随等级升至3~4次)；每次完成短休恢复1次已消耗次数，完成长休恢复全部次数。',
    url: '玩家手册2024/角色职业/战士/战士.htm',
    anchor: '1级：回气',
    edition: '2024'
  },
  '动作如潮': {
    class: '战士',
    feature: '动作如潮',
    titleEn: 'Action Surge',
    brief: '[职业特性] 战士 - 动作如潮 (Action Surge) | 在你的回合内，你可以在通常动作与附赠动作之外额外执行一个动作，但该额外动作不可用于执行【魔法】动作。完成短休或长休后恢复使用次数。',
    url: '玩家手册2024/角色职业/战士/战士.htm',
    anchor: '2级：动作如潮',
    edition: '2024'
  },
  '狂暴': {
    class: '野蛮人',
    feature: '狂暴',
    titleEn: 'Rage',
    brief: '[职业特性] 野蛮人 - 狂暴 (Rage) | 未着重甲时以附赠动作进入狂暴：获得钝击/穿刺/挥砍伤害抗性；使用力量发动攻击造成额外狂暴伤害(+2起)；力量检定与力量豁免具有优势；狂暴期间无法维持专注或施展法术。狂暴持续至下回合结束，若你在回合内进行了针对敌人的攻击检定、迫使敌人豁免或以附赠动作延长狂暴，则可维持狂暴(最长10分钟)。短休恢复1次，长休恢复全部。',
    url: '玩家手册2024/角色职业/野蛮人/野蛮人.htm',
    anchor: '1级：狂暴',
    edition: '2024'
  },
  '野性形态': {
    class: '德鲁伊',
    feature: '荒野变形',
    titleEn: 'Wild Shape',
    brief: '[职业特性] 德鲁伊 - 荒野变形 (Wild Shape) | 以附赠动作变身为你已知形态的野兽：你保留自身生命值与生命值骰，同时获得等同于你的德鲁伊等级的临时生命值(月亮结社为3倍德鲁伊等级)；采用野兽数据卡的体型、属性、速度与特殊感官(保留自身人格、智力/感知/魅力与语言)。变形期间不可施法，但可维持已有法术专注。短休恢复1次，长休恢复全部。',
    url: '玩家手册2024/角色职业/德鲁伊/德鲁伊.htm',
    anchor: '2级：荒野变形',
    edition: '2024'
  },
  '荒野形态': {
    class: '德鲁伊',
    feature: '荒野变形',
    titleEn: 'Wild Shape',
    brief: '[职业特性] 德鲁伊 - 荒野变形 (Wild Shape) | 以附赠动作变身为你已知形态的野兽：保留自身生命值，并获得等同于德鲁伊等级的临时生命值(月亮结社为3倍)；采用野兽数据卡并保留自身智力/感知/魅力。短休恢复1次，长休恢复全部。',
    url: '玩家手册2024/角色职业/德鲁伊/德鲁伊.htm',
    anchor: '2级：荒野变形',
    edition: '2024'
  },
  '疾风连击': {
    class: '武僧',
    feature: '疾风连击',
    titleEn: 'Flurry of Blows',
    brief: '[职业特性] 武僧 - 疾风连击 (Flurry of Blows) | 消耗1点武功点(Focus Point)，你可以立即以附赠动作发动两次徒手打击(2024版无须先执行攻击动作)。10级解锁强效武功后升级为三次徒手打击。',
    url: '玩家手册2024/角色职业/武僧/武僧.htm',
    anchor: '2级：武僧武功',
    edition: '2024'
  },
  '引导神力': {
    class: '牧师/圣武士',
    feature: '引导神力',
    titleEn: 'Channel Divinity',
    brief: '[职业特性] 牧师/圣武士 - 引导神力 (Channel Divinity) | 引导来自外层位面的神圣能量触发特定效应(如牧师的神圣火花/驱散不死生物、圣武士的神圣感知与子职誓言效应)。每次完成短休恢复1次已消耗次数，完成长休恢复全部次数。',
    url: '玩家手册2024/角色职业/牧师/牧师.htm',
    anchor: '2级：引导神力',
    edition: '2024'
  },
  '诗人激励': {
    class: '吟游诗人',
    feature: '吟游诗人激励',
    titleEn: 'Bardic Inspiration',
    brief: '[职业特性] 吟游诗人 - 吟游诗人激励 (Bardic Inspiration) | 以附赠动作激励60尺内一名可见或可听见的生物，令其获得一枚吟游诗人激励骰(1d6，随等级升至1d8/1d10/1d12)，持续1小时。当该生物在一次D20检定(属性检定、攻击检定或豁免检定)失败时，可掷出该激励骰并将结果加到D20检定上，可能将其改为成功(2024版不可加在伤害上)。',
    url: '玩家手册2024/角色职业/吟游诗人/吟游诗人.htm',
    anchor: '1级：吟游诗人激励',
    edition: '2024'
  },
  '超魔': {
    class: '术士',
    feature: '超魔法',
    titleEn: 'Metamagic',
    brief: '[职业特性] 术士 - 超魔法 (Metamagic) | 施展法术时消耗术法点调整法术效应：谨慎、远距、强效、延效、升阶、瞬发(消耗2点将1动作法术改为附赠动作)、求索、潜默、转化、孪生。通常对同一道法术只能应用一项超魔法选项。',
    url: '玩家手册2024/角色职业/术士/术士.htm',
    anchor: '2级：超魔法',
    edition: '2024'
  },
  '圣疗': {
    class: '圣武士',
    feature: '圣疗',
    titleEn: 'Lay on Hands',
    brief: '[职业特性] 圣武士 - 圣疗 (Lay on Hands) | 你获得可恢复生命值总值等于“圣武士等级×5”的治疗能量池，完成长休时补满。你可以用附赠动作触碰一名生物(含自己)从池中抽取任意剩余点数恢复其生命值；或消耗5点治疗量移除目标身上的中毒状态。',
    url: '玩家手册2024/角色职业/圣武士/圣武士.htm',
    anchor: '1级：圣疗',
    edition: '2024'
  },
  '圣疗术': {
    class: '圣武士',
    feature: '圣疗',
    titleEn: 'Lay on Hands',
    brief: '[职业特性] 圣武士 - 圣疗 (Lay on Hands) | 你获得可恢复生命值总值等于“圣武士等级×5”的治疗能量池，完成长休时补满。你可以用附赠动作触碰一名生物(含自己)从池中抽取任意剩余点数恢复其生命值；或消耗5点治疗量移除目标身上的中毒状态。',
    url: '玩家手册2024/角色职业/圣武士/圣武士.htm',
    anchor: '1级：圣疗',
    edition: '2024'
  }
};

function resolveClassFeature(command, qTrim, isBrief, options = {}) {
  // Only intercept for rule, class, or search commands (never hijack monster/item/spell queries)
  if (command && !['rule', 'class', 'search'].includes(command)) return null;
  if (!CLASS_FEATURES_MAP[qTrim]) return null;
  const feat = CLASS_FEATURES_MAP[qTrim];
  const anchorStr = feat.anchor || feat.feature;
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
        anchor: anchorStr,
        brief: feat.brief,
        content: feat.brief
      },
      related: []
    };
  }
  console.log(`${colors.green}=== 找到条目: 【${feat.class}：${feat.feature} (${feat.titleEn})】 [2024/2025 修订版] ===${colors.reset}`);
  console.log(`${colors.dim}来源: 5echm/${feat.url} #${anchorStr}${colors.reset}\n`);
  if (isBrief) {
    console.log(`${colors.yellow}[AI 紧凑数据卡]${colors.reset}`);
    console.log(feat.brief);
  } else {
    console.log(feat.brief);
  }
  return true;
}

function resolveVernacular(command, qTrim) {
  let activeCmd = command;
  let resolvedQuery = qTrim;
  if (VERNACULAR_MAP[qTrim]) {
    const mapped = VERNACULAR_MAP[qTrim];
    if (activeCmd === 'search' || !activeCmd || activeCmd === 'rule' || activeCmd === mapped.command) {
      activeCmd = mapped.command || activeCmd;
    }
    resolvedQuery = mapped.query;
  }
  return { activeCmd, resolvedQuery };
}

function getCategoryFilterSql(activeCmd, { useIndex = true, alias = '' } = {}) {
  const prefix = alias ? `${alias}.` : '';
  const col = useIndex ? `${prefix}category` : `+${prefix}category`;
  const urlCol = `${prefix}url`;
  if (activeCmd === 'monster') return `${col} = 'monster'`;
  if (activeCmd === 'spell') return `${col} = 'spell'`;
  if (activeCmd === 'item') return `${col} = 'item'`;
  if (activeCmd === 'class') return `${col} = 'class'`;
  if (activeCmd === 'feat') return `${col} = 'feat'`;
  if (activeCmd === 'origin') return `${col} = 'origin'`;
  if (activeCmd === 'rule') return `${col} IN ('rule', 'condition', 'feat', 'class', 'origin')`;
  if (activeCmd === 'condition') return `${col} IN ('condition', 'rule')`;
  if (activeCmd === 'module') return `(${col} = 'module' OR ${urlCol} LIKE '%模组%' OR ${urlCol} LIKE '%范例冒险%')`;
  return null;
}

function matchesCategoryJs(entryCat, entryUrl, activeCmd) {
  if (!activeCmd || activeCmd === 'search') return true;
  if (activeCmd === 'monster') return entryCat === 'monster';
  if (activeCmd === 'spell') return entryCat === 'spell';
  if (activeCmd === 'item') return entryCat === 'item';
  if (activeCmd === 'class') return entryCat === 'class';
  if (activeCmd === 'feat') return entryCat === 'feat';
  if (activeCmd === 'origin') return entryCat === 'origin';
  if (activeCmd === 'rule') return ['rule', 'condition', 'feat', 'class', 'origin'].includes(entryCat);
  if (activeCmd === 'condition') return ['condition', 'rule'].includes(entryCat);
  if (activeCmd === 'module') return entryCat === 'module' || (entryUrl && (entryUrl.includes('模组') || entryUrl.includes('范例冒险')));
  return true;
}

let _equipmentTableCache = null;

function getEquipmentTableMap(db) {
  if (_equipmentTableCache && _equipmentTableCache.db === db) {
    return _equipmentTableCache.map;
  }
  const map = new Map();
  const pages = db.prepare(`
    SELECT id, category, title, title_en, url, edition, content_md
    FROM entries
    WHERE edition = '2024' AND url IN ('玩家手册2024/装备/武器.htm', '玩家手册2024/装备/护甲.htm')
  `).all();

  for (const page of pages) {
    const isWeapon = page.url.endsWith('武器.htm');
    let groupLabel = isWeapon ? '武器' : '护甲';
    for (const rawLine of (page.content_md || '').split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith('|') || !line.endsWith('|')) continue;
      const cells = line.slice(1, -1).split('|').map(c => c.trim());
      if (cells.length < 5) continue;
      if (cells.every(c => /^[-:\s]*$/.test(c))) continue;
      if (/^\*[^*]+\*$/.test(cells[0]) && cells.slice(1).every(c => c === '')) {
        groupLabel = cells[0].replace(/^\*+|\*+$/g, '').trim();
        continue;
      }
      const nameMatch = cells[0].match(/^([\u4e00-\u9fa5]+)\s*([A-Za-z][A-Za-z\s'-]*)$/);
      if (!nameMatch) continue;
      const zhName = nameMatch[1].trim();
      const enName = nameMatch[2].trim();
      const brief = isWeapon
        ? `[物品] ${zhName} (${enName}) | 类别: ${groupLabel} | 伤害: ${cells[1]} | 词条: ${cells[2]} | 精通: ${cells[3]} | 重量: ${cells[4]} | 价格: ${cells[5] || '—'}`
        : `[物品] ${zhName} (${enName}) | 类别: ${groupLabel} | AC: ${cells[1]} | 力量要求: ${cells[2]} | 隐匿: ${cells[3]} | 重量: ${cells[4]} | 价格: ${cells[5] || '—'}`;
      const record = { page, zhName, enName, groupLabel, brief };
      map.set(zhName.toLowerCase(), record);
      map.set(enName.toLowerCase(), record);
    }
  }
  _equipmentTableCache = { db, map };
  return map;
}

function resolveEquipmentTableRow(db, activeCmd, qTrim, isBrief, isFull, options = {}) {
  if (activeCmd && !['item', 'search'].includes(activeCmd)) return null;
  const rec = getEquipmentTableMap(db).get(qTrim.toLowerCase());
  if (!rec) return null;
  const { page, zhName, enName, brief } = rec;

  if (options.json) {
    return {
      found: true,
      entry: {
        id: page.id,
        category: 'item',
        title: zhName,
        titleEn: enName,
        edition: '2024',
        url: page.url,
        anchor: zhName,
        brief,
        content: `${brief}\n\n${page.content_md}`
      },
      related: []
    };
  }

  console.log(`${colors.green}=== 找到条目: 【${zhName} (${enName})】 [2024/2025 修订版] ===${colors.reset}`);
  console.log(`${colors.dim}来源: 5echm/${page.url} #${zhName} (ID: #${page.id})${colors.reset}\n`);
  if (isBrief) {
    console.log(`${colors.yellow}[AI 紧凑数据卡]${colors.reset}`);
    console.log(brief);
  } else {
    console.log(brief);
    console.log('');
    const lines = (page.content_md || '').split('\n');
    if (!isFull && lines.length > 300) {
      console.log(lines.slice(0, 300).join('\n'));
      console.log(`\n${colors.dim}... [内容已部分折叠，完整内容请添加 --full 参数查阅 (${page.url})]${colors.reset}`);
    } else {
      console.log(page.content_md);
    }
  }
  return true;
}

// 精确模组目录映射表 (防止 "矿坑" 混入 "矿坑方尖碑")
const MODULE_DIR_MAP = {
  '矿坑': { dir: '模组/矿坑/', name: '凡达林的失落矿坑 (Lost Mine of Phandelver)' },
  '失落矿坑': { dir: '模组/矿坑/', name: '凡达林的失落矿坑 (Lost Mine of Phandelver)' },
  '凡达林的失落矿坑': { dir: '模组/矿坑/', name: '凡达林的失落矿坑 (Lost Mine of Phandelver)' },
  'lmop': { dir: '模组/矿坑/', name: '凡达林的失落矿坑 (Lost Mine of Phandelver)' },
  '矿坑方尖碑': { dir: '模组/矿坑方尖碑/', name: '凡达林与破碎方尖碑 (Phandelver and Below: The Shattered Obelisk)' },
  '破碎方尖碑': { dir: '模组/矿坑方尖碑/', name: '凡达林与破碎方尖碑 (Phandelver and Below: The Shattered Obelisk)' },
  '冰塔峰': { dir: '模组/冰塔峰/', name: '冰塔峰巨龙 (Dragon of Icespire Peak)' },
  '冰塔峰巨龙': { dir: '模组/冰塔峰/', name: '冰塔峰巨龙 (Dragon of Icespire Peak)' },
  'doip': { dir: '模组/冰塔峰/', name: '冰塔峰巨龙 (Dragon of Icespire Peak)' },
  '施特拉德': { dir: '模组/施特拉德的诅咒/', name: '施特拉德的诅咒 (Curse of Strahd)' },
  '施特拉德的诅咒': { dir: '模组/施特拉德的诅咒/', name: '施特拉德的诅咒 (Curse of Strahd)' },
  '鸦阁': { dir: '模组/施特拉德的诅咒/', name: '施特拉德的诅咒 (Curse of Strahd)' },
  'cos': { dir: '模组/施特拉德的诅咒/', name: '施特拉德的诅咒 (Curse of Strahd)' },
  '龙金劫': { dir: '模组/深水城：龙金劫/', name: '深水城：龙金劫 (Waterdeep: Dragon Heist)' },
  '深水城：龙金劫': { dir: '模组/深水城：龙金劫/', name: '深水城：龙金劫 (Waterdeep: Dragon Heist)' },
  'wdh': { dir: '模组/深水城：龙金劫/', name: '深水城：龙金劫 (Waterdeep: Dragon Heist)' },
  '疯法师': { dir: '模组/深水城：疯法师/', name: '深水城：疯法师的地牢 (Waterdeep: Dungeon of the Mad Mage)' },
  '疯法师地牢': { dir: '模组/深水城：疯法师/', name: '深水城：疯法师的地牢 (Waterdeep: Dungeon of the Mad Mage)' },
  '深水城：疯法师的地牢': { dir: '模组/深水城：疯法师/', name: '深水城：疯法师的地牢 (Waterdeep: Dungeon of the Mad Mage)' },
  'dotmm': { dir: '模组/深水城：疯法师/', name: '深水城：疯法师的地牢 (Waterdeep: Dungeon of the Mad Mage)' },
  '坠入阿弗纳斯': { dir: '模组/坠入阿弗纳斯/', name: '博德之门：坠入阿弗纳斯 (Baldur\'s Gate: Descent into Avernus)' },
  '阿弗纳斯': { dir: '模组/坠入阿弗纳斯/', name: '博德之门：坠入阿弗纳斯 (Baldur\'s Gate: Descent into Avernus)' },
  '博德之门：坠入阿弗纳斯': { dir: '模组/坠入阿弗纳斯/', name: '博德之门：坠入阿弗纳斯 (Baldur\'s Gate: Descent into Avernus)' },
  'dia': { dir: '模组/坠入阿弗纳斯/', name: '博德之门：坠入阿弗纳斯 (Baldur\'s Gate: Descent into Avernus)' },
  '冰风谷': { dir: '模组/冰风谷/', name: '冰风谷：霜脉之女的严寒 (Icewind Dale: Rime of the Frostmaiden)' },
  '霜脉之女': { dir: '模组/冰风谷/', name: '冰风谷：霜脉之女的严寒 (Icewind Dale: Rime of the Frostmaiden)' },
  'rotf': { dir: '模组/冰风谷/', name: '冰风谷：霜脉之女的严寒 (Icewind Dale: Rime of the Frostmaiden)' },
  '湮灭之墓': { dir: '模组/湮灭之墓/', name: '湮灭之墓 (Tomb of Annihilation)' },
  'toa': { dir: '模组/湮灭之墓/', name: '湮灭之墓 (Tomb of Annihilation)' }
};

function handleModuleCommand(db, rawQuery, isBrief, isFull, options = {}) {
  const qLower = rawQuery.trim().toLowerCase();

  // Check if querying DMG 2024 official sample adventures (which have full adventure text!)
  const dmgAdventures = ['秽染溪泉', '矿洞惊魂', '有翼之神', '兽之角冠', '北风舞会', '范例冒险'];
  if (dmgAdventures.some(a => rawQuery.includes(a))) {
    const dmgRows = prepareCached(
      db,
      `SELECT id, category, title, title_en, edition, url, anchor, content_md, brief_md
       FROM entries
       WHERE url LIKE '城主指南2024/4.创建冒险/范例冒险/%'
         AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
       ORDER BY id ASC`
    ).all(`%${escapeLike(rawQuery)}%`, `%${escapeLike(rawQuery)}%`);

    if (dmgRows.length > 0) {
      const best = dmgRows[0];
      if (options.json) {
        return {
          found: true,
          hasFullPlot: true,
          entry: {
            id: best.id,
            category: 'module',
            title: best.title,
            titleEn: best.title_en,
            edition: '2024',
            url: best.url,
            anchor: best.anchor,
            brief: best.brief_md,
            content: best.content_md
          },
          related: dmgRows.slice(1).map(r => ({ id: r.id, title: r.title, titleEn: r.title_en, url: r.url }))
        };
      }
      console.log(`${colors.green}=== 找到 DMG 2024 官方完整短冒险: 【${best.title}】 [2024/2025 修订版] ===${colors.reset}`);
      console.log(`${colors.dim}来源: 5echm/${best.url} (包含官方完整剧情与遭遇正文；配套主持包见 resources/starter-adventure/)${colors.reset}\n`);
      console.log(isBrief ? best.brief_md : best.content_md);
      return true;
    }
  }

  const mappedMod = MODULE_DIR_MAP[qLower];
  let rows = [];
  let displayModName = rawQuery;

  if (mappedMod) {
    displayModName = mappedMod.name;
    rows = prepareCached(
      db,
      `SELECT id, category, title, title_en, url, anchor, content_md, brief_md
       FROM entries
       WHERE url LIKE ? ESCAPE '\\'
         AND (content_md != '' OR brief_md != '')
       ORDER BY id ASC`
    ).all(`${escapeLike(mappedMod.dir)}%`);
  } else {
    // Try matching a specific module folder name first: 模组/<folder>/
    const folderRows = prepareCached(
      db,
      `SELECT id, category, title, title_en, url, anchor, content_md, brief_md
       FROM entries
       WHERE url LIKE ? ESCAPE '\\'
         AND (content_md != '' OR brief_md != '')
       ORDER BY id ASC`
    ).all(`模组/%${escapeLike(rawQuery)}%/%`);

    if (folderRows.length > 0) {
      // Lock onto the shortest matching module root folder to avoid mixing e.g. 矿坑 and 矿坑方尖碑
      const firstFolder = folderRows
        .map(r => r.url.split('/').slice(0, 2).join('/') + '/')
        .sort((a, b) => a.length - b.length)[0];
      rows = folderRows.filter(r => r.url.startsWith(firstFolder));
      displayModName = firstFolder.replace(/^模组\/|\/$/g, '');
    } else {
      const wildcard = `%${escapeLike(rawQuery)}%`;
      rows = prepareCached(
        db,
        `SELECT id, category, title, title_en, url, anchor, content_md, brief_md
         FROM entries
         WHERE (category = 'module' OR url LIKE '模组/%')
           AND (title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
           AND (content_md != '' OR brief_md != '')
         ORDER BY id ASC
         LIMIT 40`
      ).all(wildcard, wildcard, wildcard, wildcard);
    }
  }

  if (rows.length === 0) return null;

  const monsters = rows.filter(r => r.category === 'monster' || /图鉴|生物|怪物|NPC/i.test(r.url));
  const items = rows.filter(r => !monsters.includes(r) && (r.category === 'item' || /魔法物品|宝藏|万器/i.test(r.url)));
  const others = rows.filter(r => !monsters.includes(r) && !items.includes(r));

  const overview = others[0] || items[0] || monsters[0] || rows[0];
  const disclaimer = '⚠️ 注意：5echm 规则库仅收录该 5e 官方模组的附录资源（专属怪物/NPC图鉴、魔法物品与背景手记），不含完整章节剧情与房间遭遇正文。如需库内含官方完整剧情的冒险，请使用 DMG 2024 五篇范例冒险（秽染溪泉/矿洞惊魂/有翼之神/兽之角冠/北风舞会）或自创模组《低语地窖》。';

  if (options.json) {
    return {
      found: true,
      hasFullPlot: false,
      disclaimer,
      moduleName: displayModName,
      entry: {
        id: overview.id,
        category: 'module',
        title: overview.title,
        titleEn: overview.title_en,
        edition: '5e',
        url: overview.url,
        anchor: overview.anchor || '',
        brief: overview.brief_md,
        content: overview.content_md
      },
      groups: {
        monsters: monsters.map(r => ({ id: r.id, title: r.title, titleEn: r.title_en, url: r.url })),
        items: items.map(r => ({ id: r.id, title: r.title, titleEn: r.title_en, url: r.url })),
        appendices: others.map(r => ({ id: r.id, title: r.title, titleEn: r.title_en, url: r.url }))
      },
      related: rows.slice(0, 25).map(f => ({
        id: f.id,
        title: f.title,
        titleEn: f.title_en,
        url: f.url
      }))
    };
  }

  console.log(`${colors.green}=== 找到官方模组附录资源: 【${displayModName}】 (共 ${rows.length} 个条目) ===${colors.reset}`);
  console.log(`${colors.yellow}${disclaimer}${colors.reset}\n`);

  if (monsters.length > 0) {
    console.log(`${colors.cyan}【怪物与 NPC 图鉴 (${monsters.length})】${colors.reset}`);
    monsters.slice(0, 12).forEach(m => console.log(`  • #${m.id} [${m.title}${m.title_en ? ' / ' + m.title_en : ''}] -> ${m.url}`));
    if (monsters.length > 12) console.log(`  ${colors.dim}... 及其他 ${monsters.length - 12} 个生物条目${colors.reset}`);
    console.log('');
  }

  if (items.length > 0) {
    console.log(`${colors.cyan}【专属魔法物品 (${items.length})】${colors.reset}`);
    items.slice(0, 10).forEach(i => console.log(`  • #${i.id} [${i.title}${i.title_en ? ' / ' + i.title_en : ''}] -> ${i.url}`));
    console.log('');
  }

  if (others.length > 0) {
    console.log(`${colors.cyan}【背景手记与扩展附录 (${others.length})】${colors.reset}`);
    others.slice(0, 10).forEach(o => console.log(`  • #${o.id} [${o.title}${o.title_en ? ' / ' + o.title_en : ''}] -> ${o.url}`));
    console.log('');
  }

  if (!isBrief) {
    console.log(`${colors.yellow}--- 附录代表条目预览: 【${overview.title}】 (${overview.url}) ---${colors.reset}`);
    const dispText = overview.content_md || overview.brief_md || '';
    console.log(isFull ? dispText : dispText.slice(0, 1200));
  }
  return true;
}

/**
 * Execute query using SQLite B-Tree & FTS5 Trigram
 * Returns:
 *   - null if SQLite DB is not available (triggers JSON fallback)
 *   - result object / boolean if DB is available (even when no entry is found)
 */
function querySqlite(command, query, isBrief, options = {}) {
  const db = getDb();
  if (!db) return null;

  const rawTrim = (query || '').trim();
  const isFull = Boolean(options.full || options.f);

  if (!rawTrim || !/[a-zA-Z0-9\u4e00-\u9fa5]/.test(rawTrim)) {
    if (options.json) return { found: false, command, query: rawTrim };
    return false;
  }

  // 0. 优先检查职业核心特性直达 (仅限 rule / class / search，不劫持 monster / item)
  const classFeatRes = resolveClassFeature(command, rawTrim, isBrief, options);
  if (classFeatRes) return classFeatRes;

  // 检查口语别名重定向
  const { activeCmd, resolvedQuery: qTrim } = resolveVernacular(command, rawTrim);

  // Check class features again if vernacular mapped to a class feature (e.g. 圣疗术 -> 圣疗)
  const mappedClassFeatRes = resolveClassFeature(activeCmd, qTrim, isBrief, options);
  if (mappedClassFeatRes) return mappedClassFeatRes;

  const qLower = qTrim.toLowerCase();
  const qEscaped = escapeLike(qTrim);
  const qLowerEscaped = escapeLike(qLower);
  const hasSqlWildcardLiteral = /[%_]/.test(rawTrim);

  const categoryFilter = getCategoryFilterSql(activeCmd, { useIndex: true });
  const categoryFilterNoIdx = getCategoryFilterSql(activeCmd, { useIndex: false });
  const categoryFilterFts = getCategoryFilterSql(activeCmd, { useIndex: true, alias: 'e' });

  // Module command specific listing
  if (activeCmd === 'module') {
    const modRes = handleModuleCommand(db, qTrim, isBrief, isFull, options);
    if (modRes !== null) return modRes;
  }

  // Helper SQL clause: prefer monster statblocks ([怪物]) over monster lore pages ([怪物设定])
  const statblockOrder = `(CASE WHEN brief_md LIKE '[怪物设定]%' THEN 1 ELSE 0 END)`;
  const editionOrder = `(CASE WHEN edition = '2024' THEN 1 ELSE 2 END)`;

  // 1a. Exact match via B-Tree expression indexes (MULTI-INDEX OR: ~0.1ms)
  let exactIdxSql = `
    SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
    FROM entries
    WHERE (LOWER(title) = ? OR LOWER(title_en) = ? OR LOWER(anchor) = ?)
      AND (content_md != '' OR brief_md != '')
  `;
  if (categoryFilterNoIdx) exactIdxSql += ` AND ${categoryFilterNoIdx}`;
  exactIdxSql += `
    ORDER BY
      (CASE WHEN LOWER(title) = ? OR LOWER(title_en) = ? THEN 0 ELSE 1 END),
      ${statblockOrder},
      ${editionOrder},
      id ASC
    LIMIT 6
  `;

  let rows = prepareCached(db, exactIdxSql).all(qLower, qLower, qLower, qLower, qLower);

  // 1b. Exact alias match (only if title/title_en/anchor exact match returned nothing)
  if (rows.length === 0) {
    let exactAliasSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (content_md != '' OR brief_md != '')
        AND (', ' || LOWER(aliases) || ', ') LIKE ? ESCAPE '\\'
    `;
    if (categoryFilter) exactAliasSql += ` AND ${categoryFilter}`;
    exactAliasSql += ` ORDER BY ${statblockOrder}, ${editionOrder}, id ASC LIMIT 6`;
    rows = prepareCached(db, exactAliasSql).all(`%, ${qLowerEscaped}, %`);
  }

  // 1c. 2024 PHB Mundane Weapon & Armor Table Row Direct Match (#876 武器 / #879 护甲)
  if (rows.length === 0) {
    const equipRes = resolveEquipmentTableRow(db, activeCmd, qTrim, isBrief, isFull, options);
    if (equipRes !== null) return equipRes;
  }

  // 2. Starts with / Prefix match (ordered by match quality BEFORE edition!)
  if (rows.length === 0) {
    let prefixSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (content_md != '' OR brief_md != '')
        AND (LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(title_en) LIKE ? ESCAPE '\\' OR LOWER(aliases) LIKE ? ESCAPE '\\')
    `;
    if (categoryFilter) prefixSql += ` AND ${categoryFilter}`;
    prefixSql += `
      ORDER BY
        (CASE
          WHEN LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(title_en) LIKE ? ESCAPE '\\' THEN 0
          ELSE 1
        END),
        ${statblockOrder},
        ${editionOrder},
        LENGTH(title) ASC,
        id ASC
      LIMIT 6
    `;
    rows = prepareCached(db, prefixSql).all(
      `${qLowerEscaped}%`,
      `${qLowerEscaped}%`,
      `%${qLowerEscaped}%`,
      `${qLowerEscaped}%`,
      `${qLowerEscaped}%`
    );
  }

  // 3. FTS5 Trigram Full-Text Match (supports >=3 char Chinese/English substrings in ~0.4ms)
  if (rows.length === 0 && qTrim && !hasSqlWildcardLiteral) {
    try {
      const sanitized = qTrim.replace(/[^\w\u4e00-\u9fa5]/g, ' ').trim();
      const tokens = sanitized.split(/\s+/).filter(t => t.length >= 3);
      if (tokens.length > 0) {
        const ftsQuery = tokens.map(t => `"${t}"`).join(' ');
        let ftsSql = `
          SELECT e.id, e.category, e.title, e.title_en, e.aliases, e.url, e.anchor, e.edition, e.content_md, e.brief_md
          FROM entries_fts f
          JOIN entries e ON f.rowid = e.id
          WHERE entries_fts MATCH ?
            AND (e.content_md != '' OR e.brief_md != '')
        `;
        if (categoryFilterFts) ftsSql += ` AND ${categoryFilterFts}`;
        ftsSql += `
          ORDER BY
            (CASE
              WHEN LOWER(e.title) LIKE ? ESCAPE '\\' OR LOWER(e.title_en) LIKE ? ESCAPE '\\' THEN 0
              WHEN LOWER(e.aliases) LIKE ? ESCAPE '\\' THEN 1
              ELSE 2
            END),
            (CASE WHEN e.brief_md LIKE '[怪物设定]%' THEN 1 ELSE 0 END),
            rank,
            (CASE WHEN e.edition = '2024' THEN 1 ELSE 2 END)
          LIMIT 6
        `;
        const wildLower = `%${qLowerEscaped}%`;
        rows = prepareCached(db, ftsSql).all(ftsQuery, wildLower, wildLower, wildLower);
      }
    } catch (err) {
      if (process.env.DEBUG) {
        console.error(`[FTS5 Warning] Search failed for query "${qTrim}":`, err.message);
      }
    }
  }

  // 4. Substring Contains Match (handles 1~2 char Chinese queries and URL matches, ranked by match field first)
  if (rows.length === 0) {
    const searchContentToo = activeCmd === 'search' && !hasSqlWildcardLiteral;
    let subSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (content_md != '' OR brief_md != '')
        AND (title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\'${searchContentToo ? " OR content_md LIKE ? ESCAPE '\\'" : ''})
    `;
    if (categoryFilter) subSql += ` AND ${categoryFilter}`;
    subSql += `
      ORDER BY
        (CASE
          WHEN title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' THEN 0
          WHEN aliases LIKE ? ESCAPE '\\' THEN 1
          WHEN url LIKE ? ESCAPE '\\' THEN 2
          ELSE 3
        END),
        ${statblockOrder},
        ${editionOrder},
        LENGTH(title) ASC,
        id ASC
      LIMIT 6
    `;
    const wild = `%${qEscaped}%`;
    const params = searchContentToo
      ? [wild, wild, wild, wild, wild, wild, wild, wild, wild]
      : [wild, wild, wild, wild, wild, wild, wild, wild];
    rows = prepareCached(db, subSql).all(...params);
  }

  // 5. If still nothing and category filter was active, retry across ALL categories
  if (rows.length === 0 && categoryFilter) {
    // 5a. Global B-Tree exact match
    const globalExactSql = `
      SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
      FROM entries
      WHERE (LOWER(title) = ? OR LOWER(title_en) = ? OR LOWER(anchor) = ?)
        AND (content_md != '' OR brief_md != '')
      ORDER BY ${statblockOrder}, ${editionOrder}, id ASC LIMIT 6
    `;
    rows = prepareCached(db, globalExactSql).all(qLower, qLower, qLower);

    // 5b. Global substring match
    if (rows.length === 0) {
      const globalSubSql = `
        SELECT id, category, title, title_en, aliases, url, anchor, edition, content_md, brief_md
        FROM entries
        WHERE (content_md != '' OR brief_md != '')
          AND (aliases LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\')
        ORDER BY
          (CASE
            WHEN title LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' THEN 0
            WHEN aliases LIKE ? ESCAPE '\\' THEN 1
            ELSE 2
          END),
          ${statblockOrder},
          ${editionOrder},
          id ASC
        LIMIT 6
      `;
      const wild = `%${qEscaped}%`;
      rows = prepareCached(db, globalSubSql).all(`%${qLowerEscaped}%`, wild, wild, wild, wild, wild, `%${qLowerEscaped}%`);
    }
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
    console.log(`${colors.dim}来源: 5echm/${best.url}${best.anchor ? ' #' + best.anchor : ''} (ID: #${best.id})${colors.reset}\n`);

    if (isBrief) {
      // AI Agent dense format (omit verbose related suggestions to save context tokens)
      console.log(`${colors.yellow}[AI 紧凑数据卡]${colors.reset}`);
      console.log(best.brief_md || best.content_md.slice(0, 360));
    } else {
      // Full Markdown display
      const fullText = best.content_md || best.brief_md || '';
      const lines = fullText.split('\n');
      if (!isFull && lines.length > 300) {
        console.log(lines.slice(0, 300).join('\n'));
        console.log(`\n${colors.dim}... [内容已部分折叠，完整内容请添加 --full 参数查阅 (${best.url})]${colors.reset}`);
      } else {
        console.log(fullText);
      }

      // Related suggestions only in non-brief mode
      if (rows.length > 1) {
        console.log(`\n${colors.dim}--- 其他相关条目 ---${colors.reset}`);
        rows.slice(1, 6).forEach(m => {
          const enStr = m.title_en ? ` (${m.title_en})` : '';
          console.log(`${colors.dim}  • #${m.id} [${m.title}${enStr}] -> ${m.url}${colors.reset}`);
        });
      }
    }
    return true;
  }

  if (options.json) {
    return { found: false, command, query };
  }
  console.log(`${colors.red}未找到与 "${query}" 匹配的条目。${colors.reset}`);
  return false;
}

// ----------------------------------------------------
// Fallback JSON Engine (Only used if SQLite DB is missing)
// ----------------------------------------------------

let cachedFallbackIndex = null;
let cachedFallbackPath = null;
function getFallbackIndex() {
  const currentIndexFile = resolveIndexPath();
  if (cachedFallbackIndex && cachedFallbackPath === currentIndexFile) return cachedFallbackIndex;
  if (!fs.existsSync(currentIndexFile)) return null;
  cachedFallbackIndex = JSON.parse(fs.readFileSync(currentIndexFile, 'utf8'));
  cachedFallbackPath = currentIndexFile;
  return cachedFallbackIndex;
}

function getMissingDbGuide() {
  const setupScript = path.resolve(__dirname, 'setup-db.js');
  const expectedDb = resolveDbPath();
  return `未找到规则数据库（${expectedDb}；可通过 DND_DB_PATH 或 DND_DB_DIR 指定数据库位置）：请运行 "node ${setupScript}" 一键获取（下载 Release 预编译包并校验 SHA-256，或加 "--from-source" 本地构建，详见 README.md）。`;
}

function queryFallback(command, query, isBrief, options = {}) {
  const index = getFallbackIndex();
  if (!index) {
    const guide = getMissingDbGuide();
    if (options.json) return { found: false, error: guide };
    console.error(`${colors.red}${guide}${colors.reset}`);
    return null;
  }

  const rawTrim = (query || '').trim();
  if (!rawTrim || !/[a-zA-Z0-9\u4e00-\u9fa5]/.test(rawTrim)) {
    if (options.json) return { found: false, command, query: rawTrim };
    return false;
  }

  // 0. Class features direct map
  const classFeatRes = resolveClassFeature(command, rawTrim, isBrief, options);
  if (classFeatRes) return classFeatRes;

  // 1. Vernacular mapping
  const { activeCmd, resolvedQuery: qTrim } = resolveVernacular(command, rawTrim);
  const mappedClassFeatRes = resolveClassFeature(activeCmd, qTrim, isBrief, options);
  if (mappedClassFeatRes) return mappedClassFeatRes;

  const qLower = qTrim.toLowerCase();

  // Filter out empty URL nodes
  const validEntries = index.filter(t => Boolean(t && t.title && t.url));
  const categoryPool = validEntries.filter(t => matchesCategoryJs(t.category, t.url, activeCmd));

  const searchPool = (pool) => {
    let matches = pool.filter(t =>
      t.title.toLowerCase() === qLower ||
      (t.titleEn && t.titleEn.toLowerCase() === qLower) ||
      (t.aliases && t.aliases.some(a => a.toLowerCase() === qLower))
    );
    if (matches.length === 0) {
      matches = pool.filter(t =>
        t.title.toLowerCase().includes(qLower) ||
        (t.titleEn && t.titleEn.toLowerCase().includes(qLower)) ||
        (t.aliases && t.aliases.some(a => a.toLowerCase().includes(qLower)))
      );
    }
    return matches;
  };

  let matches = searchPool(categoryPool);
  if (matches.length === 0 && categoryPool.length !== validEntries.length) {
    matches = searchPool(validEntries);
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
          brief: `[${best.category || 'general'}] ${best.title}`,
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
    console.log(`来源: 5echm/${best.url}`);
    return true;
  }

  if (options.json) {
    return { found: false, command, query };
  }
  console.log(`${colors.red}未找到与 "${query}" 匹配的条目。${colors.reset}`);
  return false;
}

/**
 * 剑火纪元设定按需切片检索：默认仅检索公开 lore/*.md、capsule.md、mapping.md；
 * 仅当 options.gm === true 时才检索 worlds/jianhuo/secret/*.md。
 */
export function queryLore(query, isBrief = false, options = {}) {
  const qStr = String(query ?? '').trim();
  const isGm = Boolean(options.gm);
  const jianhuoDir = path.join(ROOT_DIR, 'worlds/jianhuo');
  const loreDir = path.join(jianhuoDir, 'lore');
  const secretDir = path.join(jianhuoDir, 'secret');

  const candidateFiles = [];
  if (fs.existsSync(loreDir)) {
    for (const f of fs.readdirSync(loreDir).filter(n => n.endsWith('.md')).sort()) {
      candidateFiles.push({
        absPath: path.join(loreDir, f),
        relFile: `worlds/jianhuo/lore/${f}`,
        isPrimaryLore: true
      });
    }
  }
  for (const topDoc of ['capsule.md', 'mapping.md']) {
    const p = path.join(jianhuoDir, topDoc);
    if (fs.existsSync(p)) {
      candidateFiles.push({
        absPath: p,
        relFile: `worlds/jianhuo/${topDoc}`,
        isPrimaryLore: false
      });
    }
  }
  if (isGm && fs.existsSync(secretDir)) {
    for (const f of fs.readdirSync(secretDir).filter(n => n.endsWith('.md')).sort()) {
      candidateFiles.push({
        absPath: path.join(secretDir, f),
        relFile: `worlds/jianhuo/secret/${f}`,
        isPrimaryLore: true
      });
    }
  }

  const sections = [];
  let secAutoId = 900001;

  for (const fileInfo of candidateFiles) {
    const raw = fs.readFileSync(fileInfo.absPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let docTitle = path.basename(fileInfo.relFile, '.md');
    let curHeading = docTitle;
    let curLines = [];

    const flushSection = () => {
      const body = curLines.join('\n').trim();
      if (!body) return;
      sections.push({
        id: secAutoId++,
        title: curHeading,
        relFile: fileInfo.relFile,
        isPrimaryLore: fileInfo.isPrimaryLore,
        content: body
      });
    };

    for (const line of lines) {
      const h1 = line.match(/^#\s+(.+)$/);
      const h2 = line.match(/^##\s+(.+)$/);
      if (h1) {
        flushSection();
        docTitle = h1[1].trim();
        curHeading = docTitle;
        curLines = [line];
      } else if (h2) {
        flushSection();
        curHeading = h2[1].trim();
        curLines = [line];
      } else {
        curLines.push(line);
      }
    }
    flushSection();
  }

  const qLower = qStr.toLowerCase();
  const scored = [];
  for (const sec of sections) {
    const titleLower = sec.title.toLowerCase();
    const contentLower = sec.content.toLowerCase();
    if (!titleLower.includes(qLower) && !contentLower.includes(qLower)) {
      continue;
    }

    let score = 0;
    if (titleLower === qLower) score += 1000;
    else if (titleLower.includes(qLower)) score += 500;

    if (sec.content.includes(`**${qStr}**`) || contentLower.includes(`**${qLower}`)) {
      score += 300;
    }

    let idx = 0;
    let count = 0;
    while ((idx = contentLower.indexOf(qLower, idx)) !== -1) {
      count += 1;
      idx += Math.max(1, qLower.length);
    }
    score += 100 + Math.min(count, 20) * 10;
    if (sec.isPrimaryLore) score += 50;

    scored.push({ ...sec, score });
  }

  scored.sort((a, b) => b.score - a.score || a.id - b.id);

  if (scored.length === 0) {
    if (options.json) {
      return { found: false, command: 'lore', query: qStr };
    }
    console.log(`${colors.red}未在剑火纪元设定中找到与 "${qStr}" 匹配的切片。${colors.reset}`);
    return false;
  }

  const best = scored[0];
  const briefLines = best.content.split(/\r?\n/).slice(0, 18).join('\n');
  const entry = {
    id: best.id,
    category: 'lore',
    title: best.title,
    edition: 'jianhuo',
    file: best.relFile,
    url: best.relFile,
    visibility: best.relFile.includes('/secret/') ? 'secret' : 'public',
    brief: briefLines,
    content: isBrief ? briefLines : best.content
  };
  const related = scored.slice(1, 5).map(s => ({
    id: s.id,
    category: 'lore',
    title: s.title,
    file: s.relFile,
    url: s.relFile
  }));

  if (options.json) {
    return { found: true, entry, related };
  }

  console.log(`${colors.green}=== 找到剑火设定切片: 【${entry.title}】 ===${colors.reset}`);
  console.log(`${colors.dim}来源: ${entry.file}${colors.reset}\n`);
  console.log(entry.content);
  if (!isBrief && related.length > 0) {
    console.log(`\n${colors.cyan}关联切片:${colors.reset} ${related.map(r => `${r.title} (${r.file})`).join(' | ')}`);
  }
  return true;
}

/**
 * Programmatic lookup API for Agent and In-Process Tools
 */
export function lookup(command, query, options = {}) {
  ensureFts5Support();
  const isBrief = Boolean(options.brief || options.agent || options.b || options.stat);
  const isJson = Boolean(options.json || options.j);
  const isFull = Boolean(options.full || options.f);
  const isGm = Boolean(options.gm);
  const safeOpts = { ...options, brief: isBrief, json: isJson, full: isFull, gm: isGm };

  const normalizedCmd = String(command || 'search').trim().toLowerCase();
  if (!VALID_COMMANDS.has(normalizedCmd)) {
    const errMsg = `未知检索命令: "${command}"。可用命令: ${[...VALID_COMMANDS].join(', ')}`;
    if (isJson) {
      return { found: false, error: errMsg, command, query };
    }
    console.error(`${colors.red}错误: ${errMsg}${colors.reset}`);
    return false;
  }

  const qStr = String(query ?? '').trim();
  if (!qStr) {
    const errMsg = '请提供非空查询关键词';
    if (isJson) {
      return { found: false, error: errMsg, command: normalizedCmd, query: '' };
    }
    console.error(`${colors.red}错误: ${errMsg}${colors.reset}`);
    return false;
  }

  if (normalizedCmd === 'lore') {
    return queryLore(qStr, isBrief, safeOpts);
  }

  const sqlRes = querySqlite(normalizedCmd, qStr, isBrief, safeOpts);
  if (sqlRes !== null) {
    return sqlRes;
  }

  const fbRes = queryFallback(normalizedCmd, qStr, isBrief, safeOpts);
  if (fbRes !== null) {
    return fbRes;
  }

  if (isJson) {
    return { found: false, command: normalizedCmd, query: qStr };
  }
  return false;
}

// ----------------------------------------------------
// CLI 入口
// ----------------------------------------------------

function cli() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  try {
    ensureFts5Support();
  } catch (error) {
    console.error(`${colors.red}${error.message}${colors.reset}`);
    process.exit(1);
  }

  let isBrief = false;
  let isJson = false;
  let isFull = false;
  let isGm = false;
  const cleanArgs = [];

  for (const rawArg of rawArgs) {
    const arg = rawArg.includes('=') ? rawArg.split('=')[0] : rawArg;
    if (arg === '--brief' || arg === '--agent' || arg === '-b' || arg === '--stat') {
      isBrief = true;
    } else if (arg === '--full' || arg === '-f') {
      isFull = true;
    } else if (arg === '--json' || arg === '-j') {
      isJson = true;
    } else if (arg === '--gm') {
      isGm = true;
    } else if (arg.startsWith('-')) {
      console.error(`${colors.red}错误: 未知选项参数 "${rawArg}"。可用选项: --brief (-b), --full (-f), --json (-j), --gm, --help (-h)${colors.reset}`);
      process.exit(1);
    } else {
      cleanArgs.push(rawArg);
    }
  }

  if (cleanArgs.length === 0) {
    console.error(`${colors.red}错误: 请提供查询命令与关键词。${colors.reset}`);
    printHelp();
    process.exit(1);
  }

  const command = cleanArgs[0].toLowerCase();
  if (!VALID_COMMANDS.has(command)) {
    console.error(`${colors.red}错误: 未知检索命令 "${command}"。可用命令: ${[...VALID_COMMANDS].join(', ')}${colors.reset}`);
    process.exit(1);
  }

  const query = cleanArgs.slice(1).join(' ').trim();
  if (!query) {
    console.error(`${colors.red}错误: 请提供查询关键词。${colors.reset}`);
    printHelp();
    process.exit(1);
  }

  const result = lookup(command, query, { brief: isBrief, full: isFull, json: isJson, gm: isGm });
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
