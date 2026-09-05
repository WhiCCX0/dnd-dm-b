#!/usr/bin/env node

/**
 * Lightweight D&D Campaign Session State Manager
 * Zero-dependency persistent state tracking for players and DMs.
 *
 * Usage:
 *   node scripts/state.js init <campaign> [options]
 *   node scripts/state.js show <campaign> [--hud] [--json]
 *   node scripts/state.js update <campaign> [options]
 *   node scripts/state.js rest <campaign> <--short | --long>
 *
 * Examples:
 *   node scripts/state.js init goblin-cave --name "瓦伦" --class "战士" --hp 12 --ac 16
 *   node scripts/state.js show goblin-cave --hud
 *   node scripts/state.js update goblin-cave --hp -4 --location "哥布林营地哨塔"
 *   node scripts/state.js update goblin-cave --slot 1 -1
 *   node scripts/state.js update goblin-cave --add-item "未鉴定的魔法红宝石" --gold +25
 *   node scripts/state.js rest goblin-cave --long
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SESSIONS_DIR = path.resolve(ROOT_DIR, 'sessions');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getSessionPath(campaignName) {
  const safeName = campaignName.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  return path.join(SESSIONS_DIR, safeName, 'state.json');
}

export function defaultState(campaignName, options = {}) {
  const maxHp = parseInt(options.hp || options.maxHp || '12', 10);
  const slotsConfig = options.slots ? parseSlots(options.slots) : { 1: { max: 0, current: 0 } };

  return {
    campaign: campaignName,
    character: {
      name: options.name || '冒险者',
      class: options.class || '战士',
      level: parseInt(options.level || '1', 10),
      ac: parseInt(options.ac || '16', 10),
      speed: 30,
      hp: {
        current: maxHp,
        max: maxHp,
        temp: 0
      },
      hitDice: {
        total: parseInt(options.level || '1', 10),
        current: parseInt(options.level || '1', 10),
        die: options.hitDie || 'd10'
      },
      heroicInspiration: false,
      spellSlots: slotsConfig
    },
    inventory: {
      gold: parseInt(options.gold || '15', 10),
      items: options.items || [
        { name: '治疗药水', count: 1 },
        { name: '火把', count: 2 },
        { name: '口粮(天)', count: 5 }
      ]
    },
    status: {
      conditions: [],
      location: options.location || '初始冒险营地',
      quest: options.quest || '探索未知区域',
      round: 0,
      inCombat: false
    },
    log: [
      {
        timestamp: new Date().toISOString(),
        action: '战役初始化',
        detail: `角色【${options.name || '冒险者'}】启程`
      }
    ],
    updatedAt: new Date().toISOString()
  };
}

function parseSlots(str) {
  // e.g. "1:2,2:1" -> { 1: { max: 2, current: 2 }, 2: { max: 1, current: 1 } }
  const res = {};
  const pairs = str.split(',');
  for (const pair of pairs) {
    const [lvl, count] = pair.split(':').map(s => parseInt(s.trim(), 10));
    if (!isNaN(lvl) && !isNaN(count)) {
      res[lvl] = { max: count, current: count };
    }
  }
  return res;
}

export function getState(campaignName) {
  const filePath = getSessionPath(campaignName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read session state for "${campaignName}": ${err.message}`);
  }
}

export function saveState(campaignName, state) {
  const filePath = getSessionPath(campaignName);
  ensureDir(path.dirname(filePath));
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  return state;
}

export function initSession(campaignName, options = {}) {
  const existing = getState(campaignName);
  if (existing && !options.force) {
    throw new Error(`战役 "${campaignName}" 已存在。使用 --force 覆盖。`);
  }
  const newState = defaultState(campaignName, options);
  return saveState(campaignName, newState);
}

export function updateState(campaignName, updates = {}) {
  let state = getState(campaignName);
  if (!state) {
    state = defaultState(campaignName);
  }

  const logs = [];

  // 1. HP Updates (with Temp HP absorption rules)
  if (updates.hp !== undefined) {
    const hpStr = String(updates.hp).trim();
    const hp = state.character.hp;

    if (hpStr.startsWith('+') || hpStr.startsWith('-')) {
      const delta = parseInt(hpStr, 10);
      if (delta < 0) {
        // Taking damage: temp HP absorbs first
        const damage = Math.abs(delta);
        if (hp.temp > 0) {
          if (hp.temp >= damage) {
            hp.temp -= damage;
            logs.push(`临时生命抵扣 ${damage} 点伤害 (剩余临时HP: ${hp.temp})`);
          } else {
            const remainder = damage - hp.temp;
            logs.push(`临时生命耗尽 (抵扣 ${hp.temp})，扣除实际生命 ${remainder} 点`);
            hp.temp = 0;
            hp.current = Math.max(0, hp.current - remainder);
          }
        } else {
          hp.current = Math.max(0, hp.current - damage);
          logs.push(`受到 ${damage} 点伤害 (当前HP: ${hp.current}/${hp.max})`);
        }
      } else {
        // Healing: cannot exceed max HP
        const prev = hp.current;
        hp.current = Math.min(hp.max, hp.current + delta);
        logs.push(`恢复 ${hp.current - prev} 点生命 (当前HP: ${hp.current}/${hp.max})`);
      }
    } else {
      hp.current = Math.max(0, Math.min(hp.max, parseInt(hpStr, 10)));
      logs.push(`设置当前生命为 ${hp.current}/${hp.max}`);
    }

    // Auto update Bloodied (浴血) condition
    const bloodiedIndex = state.status.conditions.indexOf('浴血');
    if (hp.current > 0 && hp.current <= Math.floor(hp.max / 2)) {
      if (bloodiedIndex === -1) {
        state.status.conditions.push('浴血');
        logs.push(`生命值跌破半数，进入【浴血】状态`);
      }
    } else if (bloodiedIndex !== -1) {
      state.status.conditions.splice(bloodiedIndex, 1);
      logs.push(`生命恢复半数以上，脱离【浴血】状态`);
    }

    // Unconscious check
    const unconsciousIdx = state.status.conditions.indexOf('昏迷');
    if (hp.current === 0 && unconsciousIdx === -1) {
      state.status.conditions.push('昏迷');
      logs.push(`生命值归零，陷入【昏迷】并需进行死亡豁免`);
    } else if (hp.current > 0 && unconsciousIdx !== -1) {
      state.status.conditions.splice(unconsciousIdx, 1);
      logs.push(`恢复生命，脱离【昏迷】状态`);
    }
  }

  // 2. Temp HP
  if (updates.tempHp !== undefined) {
    const val = parseInt(updates.tempHp, 10);
    state.character.hp.temp = Math.max(0, val);
    logs.push(`临时生命设置为 ${state.character.hp.temp}`);
  }

  // 3. Max HP
  if (updates.maxHp !== undefined) {
    const val = parseInt(updates.maxHp, 10);
    state.character.hp.max = Math.max(1, val);
    logs.push(`最大生命上限调整为 ${state.character.hp.max}`);
  }

  // 4. AC
  if (updates.ac !== undefined) {
    state.character.ac = parseInt(updates.ac, 10);
    logs.push(`防御等级(AC)调整为 ${state.character.ac}`);
  }

  // 5. Heroic Inspiration
  if (updates.inspiration !== undefined) {
    const insp = updates.inspiration === true || updates.inspiration === 'true' || updates.inspiration === 1 || updates.inspiration === '1';
    state.character.heroicInspiration = insp;
    logs.push(`英雄激励状态: ${insp ? '已拥有 [●]' : '已消耗 [○]'}`);
  }

  // 6. Spell Slots
  if (updates.slotLevel !== undefined && updates.slotChange !== undefined) {
    const lvl = parseInt(updates.slotLevel, 10);
    const changeStr = String(updates.slotChange).trim();
    if (!state.character.spellSlots[lvl]) {
      state.character.spellSlots[lvl] = { max: 1, current: 1 };
    }
    const slot = state.character.spellSlots[lvl];
    if (changeStr.startsWith('+') || changeStr.startsWith('-')) {
      const delta = parseInt(changeStr, 10);
      slot.current = Math.max(0, Math.min(slot.max, slot.current + delta));
    } else {
      slot.current = Math.max(0, Math.min(slot.max, parseInt(changeStr, 10)));
    }
    logs.push(`${lvl}环法术位更新: ${slot.current}/${slot.max}`);
  }

  // 7. Gold
  if (updates.gold !== undefined) {
    const goldStr = String(updates.gold).trim();
    if (goldStr.startsWith('+') || goldStr.startsWith('-')) {
      const delta = parseInt(goldStr, 10);
      state.inventory.gold = Math.max(0, state.inventory.gold + delta);
      logs.push(`金币变动 ${delta > 0 ? '+' + delta : delta}gp (现余: ${state.inventory.gold}gp)`);
    } else {
      state.inventory.gold = Math.max(0, parseInt(goldStr, 10));
      logs.push(`金币设置为 ${state.inventory.gold}gp`);
    }
  }

  // 8. Inventory items
  if (updates.addItem) {
    const itemName = updates.addItem.trim();
    const existing = state.inventory.items.find(i => i.name === itemName);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
    } else {
      state.inventory.items.push({ name: itemName, count: 1 });
    }
    logs.push(`获得物品: 【${itemName}】`);
  }

  if (updates.removeItem) {
    const itemName = updates.removeItem.trim();
    const idx = state.inventory.items.findIndex(i => i.name === itemName);
    if (idx !== -1) {
      if (state.inventory.items[idx].count > 1) {
        state.inventory.items[idx].count--;
      } else {
        state.inventory.items.splice(idx, 1);
      }
      logs.push(`消耗/移除物品: 【${itemName}】`);
    }
  }

  // 9. Conditions
  if (updates.addCondition) {
    const cond = updates.addCondition.trim();
    if (!state.status.conditions.includes(cond)) {
      state.status.conditions.push(cond);
      logs.push(`附加状态: 【${cond}】`);
    }
  }

  if (updates.removeCondition) {
    const cond = updates.removeCondition.trim();
    const idx = state.status.conditions.indexOf(cond);
    if (idx !== -1) {
      state.status.conditions.splice(idx, 1);
      logs.push(`移除状态: 【${cond}】`);
    }
  }

  // 10. Location / Quest / Round
  if (updates.location) {
    state.status.location = updates.location;
    logs.push(`当前地点更新为: ${updates.location}`);
  }

  if (updates.quest) {
    state.status.quest = updates.quest;
    logs.push(`主线任务目标更新为: ${updates.quest}`);
  }

  if (updates.round !== undefined) {
    const roundStr = String(updates.round).trim();
    if (roundStr.startsWith('+') || roundStr.startsWith('-')) {
      state.status.round = Math.max(0, state.status.round + parseInt(roundStr, 10));
    } else {
      state.status.round = Math.max(0, parseInt(roundStr, 10));
    }
    state.status.inCombat = state.status.round > 0;
    logs.push(`战斗轮次: 第 ${state.status.round} 轮`);
  }

  // Append to state log
  if (logs.length > 0) {
    state.log.push({
      timestamp: new Date().toISOString(),
      action: '状态变更',
      detail: logs.join('; ')
    });
    // Keep last 30 log records
    if (state.log.length > 30) {
      state.log = state.log.slice(-30);
    }
  }

  return saveState(campaignName, state);
}

export function applyRest(campaignName, restType = 'short') {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);

  if (restType === 'long') {
    // 2024 Long Rest Rules: Full HP recovery, reset temp HP, recover all spell slots, recover half hit dice
    const char = state.character;
    char.hp.current = char.hp.max;
    char.hp.temp = 0;

    // Hit dice recovery: half max (min 1)
    const diceRecover = Math.max(1, Math.floor(char.hitDice.total / 2));
    char.hitDice.current = Math.min(char.hitDice.total, char.hitDice.current + diceRecover);

    // Reset spell slots
    for (const lvl of Object.keys(char.spellSlots)) {
      char.spellSlots[lvl].current = char.spellSlots[lvl].max;
    }

    // Remove temporary negative conditions
    state.status.conditions = state.status.conditions.filter(c => !['浴血', '中毒', '力竭'].includes(c));

    state.log.push({
      timestamp: new Date().toISOString(),
      action: '长休完成',
      detail: `生命值完全恢复 (${char.hp.max}/${char.hp.max})，恢复法术位，恢复 ${diceRecover} 枚生命骰`
    });
  } else {
    // Short rest: Reset short rest abilities, combat round resets
    state.status.round = 0;
    state.status.inCombat = false;
    state.log.push({
      timestamp: new Date().toISOString(),
      action: '短休完成',
      detail: `休整 1 小时，重置短休可用特性与战斗轮次`
    });
  }

  return saveState(campaignName, state);
}

export function generateHud(state, mode = 'line') {
  const char = state.character;
  const hp = char.hp;
  const tempStr = hp.temp > 0 ? ` (+${hp.temp}临时)` : '';
  const bloodied = hp.current <= Math.floor(hp.max / 2) && hp.current > 0 ? ' [浴血]' : '';
  const inspStr = char.heroicInspiration ? ' [激励●]' : '';
  const conds = state.status.conditions.length > 0 ? ` [状态: ${state.status.conditions.join(', ')}]` : '';

  if (mode === 'line') {
    return `-----------------------------------------------------------------------------------------
📊 队伍状态: [🩸${char.name}(Lv${char.level} ${char.class}) HP: ${hp.current}/${hp.max}${tempStr}${bloodied} | 🛡️AC: ${char.ac}${inspStr}${conds}] | 🎒剩余金币: ${state.inventory.gold}gp | 📍${state.status.location}
-----------------------------------------------------------------------------------------`;
  }

  // Combat Dashboard mode
  const slotsText = Object.entries(char.spellSlots)
    .filter(([_, s]) => s.max > 0)
    .map(([lvl, s]) => `${lvl}环: [${'●'.repeat(s.current)}${'○'.repeat(s.max - s.current)}]`)
    .join(' | ');

  return `====================================== 角色行动仪表盘 ======================================
[当前先攻者]: ${char.name} (${char.class} Lv${char.level}) | 战斗第 ${state.status.round || 1} 轮
[生命状态]: 🩸 HP: ${hp.current}/${hp.max}${tempStr}${bloodied} | 🛡️ 基础 AC: ${char.ac}${conds}
[法术位资源]: ${slotsText || '无施法资源'}
[金币与物资]: 💰 ${state.inventory.gold}gp | 🎒 ${state.inventory.items.map(i => `${i.name}x${i.count}`).join(', ')}
[当前位置与目标]: 📍 ${state.status.location} | 🎯 ${state.status.quest}
==========================================================================================`;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}⚔️ D&D 战役状态持久化管理器 (Session State Manager)${colors.reset}

${colors.yellow}指令:${colors.reset}
  init <campaign> [options]    初始化新战役状态文件
  show <campaign> [options]    显示战役当前状态 (支持 --hud, --json)
  update <campaign> [options]  实时更新生命、法术位、金币、物品与状态
  rest <campaign> <--short|--long> 执行短休或长休恢复

${colors.yellow}初始化选项 (init):${colors.reset}
  --name <name>         角色名 (默认: 冒险者)
  --class <class>       职业 (默认: 战士)
  --level <level>       等级 (默认: 1)
  --hp <maxHp>          最大生命值 (默认: 12)
  --ac <ac>             防御等级 (默认: 16)
  --slots <1:2,2:1>     初始法术位 (环阶:数量)
  --gold <gp>           初始金币 (默认: 15)
  --force               若战役已存在则强制覆盖

${colors.yellow}更新选项 (update):${colors.reset}
  --hp <+/-N | N>       增减或设定当前 HP (自动计算临时生命抵扣、浴血与昏迷)
  --temp-hp <N>         设定临时生命值
  --max-hp <N>          调整最大生命上限
  --ac <N>              调整防御等级 AC
  --inspiration <1|0>   增减英雄激励
  --slot <level> <+/-N> 消耗或恢复对应环阶法术位
  --gold <+/-N | N>     增减或设定金币数量
  --add-item <name>     增加背包物品
  --remove-item <name>  移除或消耗背包物品
  --add-condition <c>   附加异常状态 (如: 中毒, 受擒)
  --remove-condition <c>解除异常状态
  --location <text>     更新当前地图与位置
  --quest <text>        更新当前主线/剧情目标
  --round <+/-N | N>    更新战斗轮次计数
`);
}

function parseCliArgs(args) {
  const command = args[0];
  const campaign = args[1];
  const options = {};

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--hud') options.hud = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--short') options.short = true;
    else if (arg === '--long') options.long = true;
    else if (arg === '--name') options.name = args[++i];
    else if (arg === '--class') options.class = args[++i];
    else if (arg === '--level') options.level = args[++i];
    else if (arg === '--hp') options.hp = args[++i];
    else if (arg === '--temp-hp') options.tempHp = args[++i];
    else if (arg === '--max-hp') options.maxHp = args[++i];
    else if (arg === '--ac') options.ac = args[++i];
    else if (arg === '--inspiration') options.inspiration = args[++i];
    else if (arg === '--slot') {
      options.slotLevel = args[++i];
      options.slotChange = args[++i];
    } else if (arg === '--slots') options.slots = args[++i];
    else if (arg === '--gold') options.gold = args[++i];
    else if (arg === '--add-item') options.addItem = args[++i];
    else if (arg === '--remove-item') options.removeItem = args[++i];
    else if (arg === '--add-condition') options.addCondition = args[++i];
    else if (arg === '--remove-condition') options.removeCondition = args[++i];
    else if (arg === '--location') options.location = args[++i];
    else if (arg === '--quest') options.quest = args[++i];
    else if (arg === '--round') options.round = args[++i];
  }

  return { command, campaign, options };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const { command, campaign, options } = parseCliArgs(args);
  if (!campaign) {
    console.error(`${colors.red}错误: 请指定战役名称 (例如: goblin-cave)${colors.reset}`);
    process.exit(1);
  }

  try {
    if (command === 'init') {
      const state = initSession(campaign, options);
      console.log(`${colors.green}✓ 战役 "${campaign}" 状态初始化成功！${colors.reset}`);
      console.log(`${colors.dim}存档路径: ${getSessionPath(campaign)}${colors.reset}\n`);
      console.log(generateHud(state, 'line'));
    } else if (command === 'show') {
      const state = getState(campaign);
      if (!state) {
        console.error(`${colors.red}未找到战役 "${campaign}"。请先运行: node scripts/state.js init ${campaign}${colors.reset}`);
        process.exit(1);
      }
      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
      } else if (options.hud) {
        console.log(generateHud(state, state.status.inCombat ? 'combat' : 'line'));
      } else {
        console.log(generateHud(state, 'combat'));
      }
    } else if (command === 'update') {
      const state = updateState(campaign, options);
      console.log(`${colors.green}✓ 战役 "${campaign}" 状态已更新！${colors.reset}\n`);
      console.log(generateHud(state, state.status.inCombat ? 'combat' : 'line'));
    } else if (command === 'rest') {
      const restType = options.long ? 'long' : 'short';
      const state = applyRest(campaign, restType);
      console.log(`${colors.green}✓ 战役 "${campaign}" 完成${restType === 'long' ? '长休' : '短休'}！${colors.reset}\n`);
      console.log(generateHud(state, 'line'));
    } else {
      console.error(`${colors.red}未知指令: "${command}"。请使用 init, show, update, 或 rest。${colors.reset}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'state.js')
);

if (isMain) {
  main();
}
