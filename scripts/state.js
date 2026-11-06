#!/usr/bin/env node

/**
 * Lightweight D&D Campaign Session State Manager
 * Zero-dependency persistent state tracking for players and DMs.
 *
 * Usage:
 *   node scripts/state.js init <campaign> [options]
 *   node scripts/state.js show <campaign> [--hud] [--json]
 *   node scripts/state.js update <campaign> [options]
 *   node scripts/state.js rest <campaign> <--short | --long> [--dice <N>] [--con <mod>]
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
const MAX_LOG_ENTRIES = 30;

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

const CLASS_HIT_DIE_MAP = {
  '野蛮人': 'd12',
  'barbarian': 'd12',
  '战士': 'd10',
  'fighter': 'd10',
  '圣武士': 'd10',
  'paladin': 'd10',
  '游侠': 'd10',
  'ranger': 'd10',
  '法师': 'd6',
  'wizard': 'd6',
  '术士': 'd6',
  'sorcerer': 'd6',
  '吟游诗人': 'd8',
  '诗人': 'd8',
  'bard': 'd8',
  '牧师': 'd8',
  'cleric': 'd8',
  '德鲁伊': 'd8',
  'druid': 'd8',
  '武僧': 'd8',
  'monk': 'd8',
  '游荡者': 'd8',
  '盗贼': 'd8',
  'rogue': 'd8',
  '魔契师': 'd8',
  '邪术师': 'd8',
  'warlock': 'd8',
  '奇械师': 'd8',
  'artificer': 'd8',
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getSessionsDir() {
  return process.env.DND_SESSIONS_DIR || process.env.SESSIONS_DIR || path.resolve(ROOT_DIR, 'sessions');
}

export function parseIntStrict(value, fieldName = '数值', { min = -100000000, max = 100000000 } = {}) {
  if (value === undefined || value === null || typeof value === 'boolean') {
    throw new Error(`参数 "${fieldName}" 必须是有效整数，收到: ${String(value)}`);
  }
  const str = String(value).trim();
  if (!/^[+-]?\d+$/.test(str)) {
    throw new Error(`参数 "${fieldName}" 必须是有效整数，收到: "${value}"`);
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < min || num > max) {
    throw new Error(`参数 "${fieldName}" 超出有效范围 [${min}, ${max}]，收到: "${value}"`);
  }
  return num;
}

function inferHitDie(className, explicitHitDie) {
  if (explicitHitDie !== undefined) {
    const clean = String(explicitHitDie).trim().toLowerCase();
    if (!/^d(4|6|8|10|12|20)$/.test(clean)) {
      throw new Error(`无效的生命骰规格: "${explicitHitDie}" (仅支持 d4/d6/d8/d10/d12/d20)`);
    }
    return clean;
  }
  const cls = String(className || '战士').trim().toLowerCase();
  for (const [key, die] of Object.entries(CLASS_HIT_DIE_MAP)) {
    if (cls.includes(key)) return die;
  }
  return 'd10';
}

function inferSpeed(options = {}) {
  if (options.speed !== undefined) {
    return parseIntStrict(options.speed, 'speed', { min: 0, max: 300 });
  }
  const species = String(options.race || options.species || '').trim().toLowerCase();
  if (
    species.includes('木精灵') ||
    species.includes('wood elf') ||
    species.includes('歌利亚') ||
    species.includes('goliath')
  ) {
    return 35;
  }
  return 30;
}

export function getSessionPath(campaignName) {
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    throw new Error('战役名称不能为空');
  }
  const safeName = campaignName.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  if (!safeName || /^_+$/.test(safeName)) {
    throw new Error(`无效的战役名称: "${campaignName}"`);
  }
  return path.join(getSessionsDir(), safeName, 'state.json');
}

function parseSlots(str) {
  // e.g. "1:2,2:1" -> { 1: { max: 2, current: 2 }, 2: { max: 1, current: 1 } }
  const res = {};
  const pairs = String(str).split(',').map(s => s.trim()).filter(Boolean);
  if (pairs.length === 0) {
    throw new Error(`无效的法术位配置: "${str}" (格式示例: 1:2,2:1)`);
  }
  for (const pair of pairs) {
    const parts = pair.split(':');
    if (parts.length !== 2) {
      throw new Error(`无效的法术位配置项: "${pair}" (格式示例: 1:2)`);
    }
    const lvl = parseIntStrict(parts[0], '法术位环阶', { min: 1, max: 9 });
    const count = parseIntStrict(parts[1], '法术位数量', { min: 0, max: 99 });
    res[lvl] = { max: count, current: count };
  }
  return res;
}

function appendLog(state, action, detail) {
  if (!Array.isArray(state.log)) {
    state.log = [];
  }
  state.log.push({
    timestamp: new Date().toISOString(),
    action,
    detail
  });
  if (state.log.length > MAX_LOG_ENTRIES) {
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
  }
}

function syncHpConditions(state, logs = []) {
  const hp = state.character.hp;
  if (!state.character.deathSaves) {
    state.character.deathSaves = { successes: 0, failures: 0 };
  }

  // Auto update Bloodied (浴血) condition
  const bloodiedIndex = state.status.conditions.indexOf('浴血');
  if (hp.current > 0 && hp.current <= Math.floor(hp.max / 2)) {
    if (bloodiedIndex === -1) {
      state.status.conditions.push('浴血');
      logs.push('生命值跌破半数，进入【浴血】状态');
    }
  } else if (bloodiedIndex !== -1) {
    state.status.conditions.splice(bloodiedIndex, 1);
    logs.push('生命恢复半数以上，脱离【浴血】状态');
  }

  // Unconscious check & Death Save reset on heal
  const unconsciousIdx = state.status.conditions.indexOf('昏迷');
  if (hp.current === 0 && unconsciousIdx === -1) {
    if (!state.status.conditions.includes('死亡')) {
      state.status.conditions.push('昏迷');
      logs.push('生命值归零，陷入【昏迷】并需进行死亡豁免');
    }
  } else if (hp.current > 0) {
    if (unconsciousIdx !== -1) {
      state.status.conditions.splice(unconsciousIdx, 1);
      logs.push('恢复生命，脱离【昏迷】状态');
    }
    const deadIdx = state.status.conditions.indexOf('死亡');
    if (deadIdx !== -1) {
      state.status.conditions.splice(deadIdx, 1);
    }
    state.character.deathSaves = { successes: 0, failures: 0 };
  }
}

export function defaultState(campaignName, options = {}) {
  const maxHp = parseIntStrict(options.hp ?? options.maxHp ?? '12', 'hp', { min: 1, max: 9999 });
  const level = parseIntStrict(options.level ?? '1', 'level', { min: 1, max: 20 });
  const ac = parseIntStrict(options.ac ?? '16', 'ac', { min: 1, max: 99 });
  const gold = parseIntStrict(options.gold ?? '15', 'gold', { min: 0, max: 100000000 });
  const charClass = options.class || '战士';
  const hitDie = inferHitDie(charClass, options.hitDie);
  const speed = inferSpeed(options);
  const slotsConfig = options.slots ? parseSlots(options.slots) : { 1: { max: 0, current: 0 } };

  return {
    campaign: campaignName,
    character: {
      name: options.name || '冒险者',
      class: charClass,
      level,
      ac,
      speed,
      hp: {
        current: maxHp,
        max: maxHp,
        temp: 0
      },
      hitDice: {
        total: level,
        max: level,
        current: level,
        die: hitDie
      },
      deathSaves: {
        successes: 0,
        failures: 0
      },
      heroicInspiration: false,
      spellSlots: slotsConfig
    },
    inventory: {
      gold,
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
      inCombat: false,
      encounter: {
        active: false,
        mobs: []
      }
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
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  if (Array.isArray(state.log) && state.log.length > MAX_LOG_ENTRIES) {
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
  }
  state.updatedAt = new Date().toISOString();

  const payload = JSON.stringify(state, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const bakPath = `${filePath}.bak`;

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, bakPath);
    } catch (_) {
      // Ignore backup error if concurrent or permission restricted
    }
  }

  fs.writeFileSync(tmpPath, payload, 'utf-8');
  fs.renameSync(tmpPath, filePath);
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
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }

  if (!state.character.deathSaves) {
    state.character.deathSaves = { successes: 0, failures: 0 };
  }

  const logs = [];

  // 0. Max HP (Process before HP so clamping and bloodied checks stay consistent)
  if (updates.maxHp !== undefined) {
    const val = parseIntStrict(updates.maxHp, 'maxHp', { min: 1, max: 9999 });
    state.character.hp.max = val;
    if (state.character.hp.current > val) {
      state.character.hp.current = val;
    }
    logs.push(`最大生命上限调整为 ${state.character.hp.max} (当前HP: ${state.character.hp.current}/${state.character.hp.max})`);
    if (updates.hp === undefined) {
      syncHpConditions(state, logs);
    }
  }

  // 1. HP Updates (with Temp HP absorption rules & HUD delta formula tracking)
  if (updates.hp !== undefined) {
    const hpStr = String(updates.hp).trim();
    const hp = state.character.hp;
    const prevHp = hp.current;
    const reasonSuffix = updates.reason ? ` ${updates.reason}` : '';

    if (hpStr.startsWith('+') || hpStr.startsWith('-')) {
      const delta = parseIntStrict(hpStr, 'hp', { min: -99999, max: 99999 });
      if (delta < 0) {
        // Taking damage: temp HP absorbs first
        const damage = Math.abs(delta);
        let unabsorbed = damage;
        if (hp.temp > 0) {
          if (hp.temp >= damage) {
            hp.temp -= damage;
            unabsorbed = 0;
            hp.lastDelta = `-0 (临时HP抵扣${damage}${reasonSuffix})`;
            logs.push(`临时生命抵扣 ${damage} 点伤害 (剩余临时HP: ${hp.temp})`);
          } else {
            unabsorbed = damage - hp.temp;
            logs.push(`临时生命耗尽 (抵扣 ${hp.temp})，扣除实际生命 ${unabsorbed} 点`);
            hp.temp = 0;
            hp.current = Math.max(0, hp.current - unabsorbed);
            hp.lastDelta = `-${prevHp - hp.current}${reasonSuffix}`;
          }
        } else {
          hp.current = Math.max(0, hp.current - damage);
          hp.lastDelta = `-${prevHp - hp.current}${reasonSuffix}`;
          logs.push(`受到 ${damage} 点伤害 (当前HP: ${hp.current}/${hp.max})`);
        }

        // 0 HP taking damage triggers Death Save failure(s)
        if (prevHp === 0 && unabsorbed > 0) {
          const failAdded = updates.crit ? 2 : 1;
          state.character.deathSaves.failures = Math.min(3, state.character.deathSaves.failures + failAdded);
          logs.push(`0 HP 状态下受击，死亡豁免失败 +${failAdded} (累计失败: ${state.character.deathSaves.failures}/3)`);
          if (state.character.deathSaves.failures >= 3 || unabsorbed >= hp.max) {
            state.character.deathSaves.failures = 3;
            if (!state.status.conditions.includes('死亡')) {
              state.status.conditions.push('死亡');
            }
            logs.push('死亡豁免累计 3 次失败，角色【死亡】！');
          }
        }
      } else {
        // Healing: cannot exceed max HP
        hp.current = Math.min(hp.max, hp.current + delta);
        const healed = hp.current - prevHp;
        hp.lastDelta = `+${healed}${reasonSuffix}`;
        logs.push(`恢复 ${healed} 点生命 (当前HP: ${hp.current}/${hp.max})`);
      }
    } else {
      const targetHp = parseIntStrict(hpStr, 'hp', { min: 0, max: 99999 });
      hp.current = Math.max(0, Math.min(hp.max, targetHp));
      const diff = hp.current - prevHp;
      if (diff !== 0) {
        hp.lastDelta = `${diff > 0 ? '+' : ''}${diff}${reasonSuffix}`;
      } else {
        delete hp.lastDelta;
      }
      logs.push(`设置当前生命为 ${hp.current}/${hp.max}`);
    }

    syncHpConditions(state, logs);
  }

  // 2. Temp HP (D&D 5e/2024: Temp HP does not stack; take the higher value unless resetting to 0)
  if (updates.tempHp !== undefined) {
    const val = parseIntStrict(updates.tempHp, 'tempHp', { min: 0, max: 9999 });
    if (val === 0) {
      state.character.hp.temp = 0;
    } else {
      state.character.hp.temp = Math.max(state.character.hp.temp || 0, val);
    }
    logs.push(`临时生命设置为 ${state.character.hp.temp}`);
  }

  // 3. AC & Speed
  if (updates.ac !== undefined) {
    state.character.ac = parseIntStrict(updates.ac, 'ac', { min: 1, max: 99 });
    logs.push(`防御等级(AC)调整为 ${state.character.ac}`);
  }

  if (updates.speed !== undefined) {
    state.character.speed = parseIntStrict(updates.speed, 'speed', { min: 0, max: 300 });
    logs.push(`移动速度调整为 ${state.character.speed}`);
  }

  // 4. Death Saves manual tracking
  if (updates.deathSave !== undefined) {
    const ds = String(updates.deathSave).trim().toLowerCase();
    const saves = state.character.deathSaves;
    if (ds === 'success') {
      saves.successes = Math.min(3, saves.successes + 1);
      logs.push(`死亡豁免成功 (${saves.successes}/3)`);
      if (saves.successes >= 3) {
        saves.successes = 0;
        saves.failures = 0;
        logs.push('累计 3 次死亡豁免成功，伤势稳定！');
      }
    } else if (ds === 'fail' || ds === 'failure') {
      saves.failures = Math.min(3, saves.failures + 1);
      logs.push(`死亡豁免失败 (${saves.failures}/3)`);
      if (saves.failures >= 3 && !state.status.conditions.includes('死亡')) {
        state.status.conditions.push('死亡');
        logs.push('累计 3 次死亡豁免失败，角色【死亡】！');
      }
    } else if (ds === 'crit-fail' || ds === 'nat1') {
      saves.failures = Math.min(3, saves.failures + 2);
      logs.push(`死亡豁免自然 1 大失败！失败 +2 (${saves.failures}/3)`);
      if (saves.failures >= 3 && !state.status.conditions.includes('死亡')) {
        state.status.conditions.push('死亡');
        logs.push('累计 3 次死亡豁免失败，角色【死亡】！');
      }
    } else if (ds === 'crit-success' || ds === 'nat20') {
      state.character.hp.current = 1;
      state.character.hp.lastDelta = '+1 死亡豁免自然20苏醒';
      syncHpConditions(state, logs);
      logs.push('死亡豁免自然 20 奇迹苏醒！恢复 1 点生命值');
    } else if (ds === 'reset') {
      saves.successes = 0;
      saves.failures = 0;
      logs.push('重置死亡豁免计数');
    } else {
      throw new Error(`未知的死亡豁免指令: "${updates.deathSave}" (支持: success, fail, crit-success, crit-fail, reset)`);
    }
  }

  // 5. Heroic Inspiration
  if (updates.inspiration !== undefined) {
    const insp = updates.inspiration === true || updates.inspiration === 'true' || updates.inspiration === 1 || updates.inspiration === '1';
    state.character.heroicInspiration = insp;
    logs.push(`英雄激励状态: ${insp ? '已拥有 [●]' : '已消耗 [○]'}`);
  }

  // 6. Spell Slots
  if (updates.slots !== undefined) {
    state.character.spellSlots = parseSlots(updates.slots);
    logs.push('法术位配置已更新');
  }

  if (updates.slotLevel !== undefined && updates.slotChange !== undefined) {
    const lvl = parseIntStrict(updates.slotLevel, 'slotLevel', { min: 1, max: 9 });
    const changeStr = String(updates.slotChange).trim();
    const slot = state.character.spellSlots[lvl];
    if (!slot || slot.max <= 0) {
      throw new Error(`角色没有可用的 ${lvl} 环法术位`);
    }
    const prevSlot = slot.current;
    if (changeStr.startsWith('+') || changeStr.startsWith('-')) {
      const delta = parseIntStrict(changeStr, 'slotChange', { min: -99, max: 99 });
      slot.current = Math.max(0, Math.min(slot.max, slot.current + delta));
    } else {
      const target = parseIntStrict(changeStr, 'slotChange', { min: 0, max: 99 });
      slot.current = Math.max(0, Math.min(slot.max, target));
    }
    const slotDiff = slot.current - prevSlot;
    if (slotDiff !== 0) {
      slot.lastDelta = `${slotDiff > 0 ? '+' : ''}${slotDiff}`;
    }
    logs.push(`${lvl}环法术位更新: ${slot.current}/${slot.max}`);
  }

  // 7. Gold
  if (updates.gold !== undefined) {
    const goldStr = String(updates.gold).trim();
    if (goldStr.startsWith('+') || goldStr.startsWith('-')) {
      const delta = parseIntStrict(goldStr, 'gold', { min: -100000000, max: 100000000 });
      state.inventory.gold = Math.max(0, state.inventory.gold + delta);
      logs.push(`金币变动 ${delta > 0 ? '+' + delta : delta}gp (现余: ${state.inventory.gold}gp)`);
    } else {
      const val = parseIntStrict(goldStr, 'gold', { min: 0, max: 100000000 });
      state.inventory.gold = val;
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

  // 9. Conditions (supports comma-separated list)
  if (updates.addCondition) {
    const conds = String(updates.addCondition).split(',').map(s => s.trim()).filter(Boolean);
    for (const cond of conds) {
      if (!state.status.conditions.includes(cond)) {
        state.status.conditions.push(cond);
        logs.push(`附加状态: 【${cond}】`);
      }
    }
  }

  if (updates.removeCondition) {
    const conds = String(updates.removeCondition).split(',').map(s => s.trim()).filter(Boolean);
    for (const cond of conds) {
      const idx = state.status.conditions.indexOf(cond);
      if (idx !== -1) {
        state.status.conditions.splice(idx, 1);
        logs.push(`移除状态: 【${cond}】`);
      }
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
      const delta = parseIntStrict(roundStr, 'round', { min: -9999, max: 9999 });
      state.status.round = Math.max(0, state.status.round + delta);
    } else {
      const val = parseIntStrict(roundStr, 'round', { min: 0, max: 9999 });
      state.status.round = val;
    }
    state.status.inCombat = state.status.round > 0;
    logs.push(`战斗轮次: 第 ${state.status.round} 轮`);
  }

  // Append to state log
  if (logs.length > 0) {
    appendLog(state, '状态变更', logs.join('; '));
  }

  return saveState(campaignName, state);
}

export function applyRest(campaignName, restType = 'short', options = {}) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);

  const char = state.character;
  if (!char.deathSaves) {
    char.deathSaves = { successes: 0, failures: 0 };
  }

  if (restType === 'long') {
    // 2024 Long Rest Rules: Full HP recovery, reset temp HP, recover all spell slots, regain ALL spent Hit Dice, reduce exhaustion by 1
    const healed = char.hp.max - char.hp.current;
    char.hp.current = char.hp.max;
    char.hp.temp = 0;
    char.deathSaves = { successes: 0, failures: 0 };
    if (healed > 0) {
      char.hp.lastDelta = `+${healed} 长休恢复`;
    } else {
      delete char.hp.lastDelta;
    }

    // 2024 PHB: Regain all spent Hit Point Dice
    const diceRecover = char.hitDice.total - char.hitDice.current;
    char.hitDice.current = char.hitDice.total;

    // Reset spell slots
    for (const lvl of Object.keys(char.spellSlots)) {
      char.spellSlots[lvl].current = char.spellSlots[lvl].max;
      delete char.spellSlots[lvl].lastDelta;
    }

    // Remove HP-dependent conditions (浴血, 昏迷) & decrement multi-level Exhaustion (力竭) by 1
    // Note: Do NOT automatically remove '中毒' on long rest
    const nextConditions = [];
    for (const c of state.status.conditions) {
      if (['浴血', '昏迷', '力竭', '力竭 1', '力竭1'].includes(c)) {
        continue;
      }
      const exhMatch = c.match(/^力竭\s*(\d+)$/);
      if (exhMatch) {
        const nextLvl = parseInt(exhMatch[1], 10) - 1;
        if (nextLvl >= 1) {
          nextConditions.push(c.includes(' ') ? `力竭 ${nextLvl}` : `力竭${nextLvl}`);
        }
        continue;
      }
      nextConditions.push(c);
    }
    state.status.conditions = nextConditions;
    state.status.round = 0;
    state.status.inCombat = false;

    appendLog(
      state,
      '长休完成',
      `生命值完全恢复 (${char.hp.max}/${char.hp.max})，恢复全部法术位，重获全部生命骰 (+${diceRecover}，现 ${char.hitDice.current}/${char.hitDice.total})`
    );
  } else {
    // Short rest: Optional Hit Dice spending + reset short rest abilities & combat round
    let hdDetail = '';
    const diceToSpend = options.dice ?? options.hitDice;
    if (diceToSpend !== undefined) {
      const spend = parseIntStrict(diceToSpend, 'dice', { min: 1, max: 20 });
      if (spend > char.hitDice.current) {
        throw new Error(`可用生命骰不足 (当前剩余: ${char.hitDice.current}/${char.hitDice.total})`);
      }
      const conMod = options.con !== undefined ? parseIntStrict(options.con, 'con', { min: -5, max: 10 }) : 0;
      const sides = parseInt(String(char.hitDice.die || 'd10').replace(/^d/i, ''), 10) || 10;

      let totalRolled = 0;
      const rolls = [];
      if (options.heal !== undefined) {
        totalRolled = parseIntStrict(options.heal, 'heal', { min: 0, max: 9999 });
      } else {
        for (let i = 0; i < spend; i++) {
          const r = Math.floor(Math.random() * sides) + 1;
          const gained = Math.max(1, r + conMod);
          rolls.push(r);
          totalRolled += gained;
        }
      }

      char.hitDice.current -= spend;
      const prevHp = char.hp.current;
      char.hp.current = Math.min(char.hp.max, char.hp.current + totalRolled);
      const actualHealed = char.hp.current - prevHp;
      char.hp.lastDelta = `+${actualHealed} 短休生命骰`;
      syncHpConditions(state, []);
      hdDetail = `，消耗 ${spend} 枚生命骰(${char.hitDice.die}${rolls.length ? ': [' + rolls.join(',') + ']' : ''})恢复 ${actualHealed} 点生命 (HP ${char.hp.current}/${char.hp.max})`;
    }

    state.status.round = 0;
    state.status.inCombat = false;
    appendLog(
      state,
      '短休完成',
      `休整 1 小时，重置短休可用特性与战斗轮次${hdDetail}`
    );
  }

  return saveState(campaignName, state);
}

export function addEncounterMob(campaignName, options = {}) {
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }
  if (!state.status.encounter) {
    state.status.encounter = { active: false, mobs: [] };
  }

  const name = (options.name || '敌方目标').trim();
  const maxHp = parseIntStrict(options.hp ?? options.maxHp ?? '10', 'hp', { min: 1, max: 9999 });
  const ac = parseIntStrict(options.ac ?? '12', 'ac', { min: 1, max: 99 });
  const count = parseIntStrict(options.count ?? '1', 'count', { min: 1, max: 50 });
  const init = options.init !== undefined && options.init !== null
    ? parseIntStrict(options.init, 'init', { min: -20, max: 99 })
    : null;

  // Determine highest existing index for mobs of the same base name to prevent overwriting
  let maxExistingIdx = 0;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numberedRegex = new RegExp(`^${escapedName}-(\\d+)$`);
  for (const m of state.status.encounter.mobs) {
    if (m.id === name || m.name === name) {
      maxExistingIdx = Math.max(maxExistingIdx, 1);
    }
    const match = m.id.match(numberedRegex);
    if (match) {
      maxExistingIdx = Math.max(maxExistingIdx, parseInt(match[1], 10));
    }
  }

  const added = [];
  for (let i = 1; i <= count; i++) {
    const seqNum = maxExistingIdx + i;
    const id = `${name}-${seqNum}`;
    const mob = {
      id,
      name,
      hp: maxHp,
      maxHp,
      ac,
      initiative: init,
      conditions: []
    };
    state.status.encounter.mobs.push(mob);
    added.push(mob);
  }

  state.status.encounter.active = true;
  state.status.inCombat = true;
  if (!state.status.round) state.status.round = 1;

  appendLog(
    state,
    '加入遭遇战敌方',
    `新增 ${added.map(m => `【${m.id}】(HP ${m.hp}/${m.maxHp}, AC ${m.ac})`).join(', ')}`
  );

  return saveState(campaignName, state);
}

export function damageEncounterMob(campaignName, target, damageOrHeal) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);
  if (!state.status.encounter || !state.status.encounter.mobs || !state.status.encounter.mobs.length) {
    throw new Error(`当前战役 "${campaignName}" 无进行中的遭遇战敌方`);
  }

  const targetStr = String(target || '').trim().toLowerCase();
  if (!targetStr) {
    throw new Error('请指定受击目标名称或编号');
  }

  const val = parseIntStrict(damageOrHeal, 'damage', { min: -99999, max: 99999 });
  const mobs = state.status.encounter.mobs;

  // Priority target resolution: prefer alive targets when matching by generic name/substring
  const mob =
    mobs.find(m => m.id.toLowerCase() === targetStr && m.hp > 0) ||
    mobs.find(m => m.id.toLowerCase() === targetStr) ||
    mobs.find(m => m.name.toLowerCase() === targetStr && m.hp > 0) ||
    mobs.find(m => (m.id.toLowerCase().includes(targetStr) || m.name.toLowerCase().includes(targetStr)) && m.hp > 0) ||
    mobs.find(m => m.name.toLowerCase() === targetStr || m.id.toLowerCase().includes(targetStr));

  if (!mob) {
    throw new Error(`未找到匹配的敌方目标: "${target}"`);
  }

  let logDetail = '';

  if (val >= 0) {
    mob.hp = Math.max(0, mob.hp - val);
    logDetail = `【${mob.id}】受到 ${val} 点伤害 (当前HP: ${mob.hp}/${mob.maxHp})`;
  } else {
    const heal = Math.abs(val);
    mob.hp = Math.min(mob.maxHp, mob.hp + heal);
    logDetail = `【${mob.id}】恢复 ${heal} 点生命 (当前HP: ${mob.hp}/${mob.maxHp})`;
  }

  // 浴血判定 (Bloodied: HP <= 50% maxHp and > 0)
  const bloodiedIdx = mob.conditions.indexOf('浴血');
  if (mob.hp > 0 && mob.hp <= Math.floor(mob.maxHp / 2)) {
    if (bloodiedIdx === -1) {
      mob.conditions.push('浴血');
      logDetail += '，进入【浴血】状态';
    }
  } else if (bloodiedIdx !== -1) {
    mob.conditions.splice(bloodiedIdx, 1);
    logDetail += '，解除【浴血】状态';
  }

  // 阵亡判定
  const deadIdx = mob.conditions.indexOf('阵亡');
  if (mob.hp === 0) {
    if (deadIdx === -1) {
      mob.conditions.push('阵亡');
      logDetail += '，已【阵亡】倒下！';
    }
  } else if (deadIdx !== -1) {
    mob.conditions.splice(deadIdx, 1);
  }

  appendLog(state, '敌方血量变动', logDetail);

  return saveState(campaignName, state);
}

export function clearEncounter(campaignName) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);

  if (state.status.encounter) {
    state.status.encounter.mobs = [];
    state.status.encounter.active = false;
  }
  state.status.round = 0;
  state.status.inCombat = false;

  appendLog(state, '遭遇战结束', '战场已清理，重置战斗轮次与敌方态势');

  return saveState(campaignName, state);
}

export function generateHud(state, mode = 'line') {
  const char = state.character;
  const hp = char.hp;
  const deltaStr = hp.lastDelta ? ` (${hp.lastDelta})` : '';
  const tempStr = hp.temp > 0 ? ` (+${hp.temp}临时)` : '';
  const isBloodied = hp.current <= Math.floor(hp.max / 2) && hp.current > 0;
  const bloodied = isBloodied ? ' [浴血]' : '';
  const inspStr = char.heroicInspiration ? ' [激励●]' : '';
  const displayConditions = state.status.conditions.filter(c => !(isBloodied && c === '浴血'));
  const conds = displayConditions.length > 0 ? ` [状态: ${displayConditions.join(', ')}]` : '';

  let mobsLine = '';
  if (state.status.encounter && state.status.encounter.mobs && state.status.encounter.mobs.length > 0) {
    const mobList = state.status.encounter.mobs.map(m => {
      const condStr = m.conditions.length > 0 ? ` [${m.conditions.join(',')}]` : '';
      return `${m.id}(${m.hp}/${m.maxHp}${condStr})`;
    }).join(', ');
    mobsLine = `\n👾 敌方态势: [${mobList}]`;
  }

  if (mode === 'line') {
    return `-----------------------------------------------------------------------------------------
📊 队伍状态: [🩸${char.name}(Lv${char.level} ${char.class}) HP: ${hp.current}/${hp.max}${deltaStr}${tempStr}${bloodied} | 🛡️AC: ${char.ac}${inspStr}${conds}] | 🎒剩余金币: ${state.inventory.gold}gp | 📍${state.status.location}${mobsLine}
-----------------------------------------------------------------------------------------`;
  }

  // Combat Dashboard mode
  const slotsText = Object.entries(char.spellSlots)
    .filter(([_, s]) => s.max > 0)
    .map(([lvl, s]) => `${lvl}环: [${'●'.repeat(s.current)}${'○'.repeat(s.max - s.current)}]${s.lastDelta ? ` (${s.lastDelta})` : ''}`)
    .join(' | ');

  let mobsDashboard = '';
  if (state.status.encounter && state.status.encounter.mobs && state.status.encounter.mobs.length > 0) {
    const lines = state.status.encounter.mobs.map(m => {
      const condStr = m.conditions.length > 0 ? ` [${m.conditions.join(', ')}]` : '';
      const initStr = m.initiative !== null ? ` | 先攻 ${m.initiative}` : '';
      return `  • ${m.id}: 🩸 HP ${m.hp}/${m.maxHp} | 🛡️ AC ${m.ac}${initStr}${condStr}`;
    }).join('\n');
    mobsDashboard = `\n[敌方战斗目标]:\n${lines}`;
  }

  return `====================================== 角色行动仪表盘 ======================================
[当前先攻者]: ${char.name} (${char.class} Lv${char.level}) | 战斗第 ${state.status.round || 1} 轮
[生命状态]: 🩸 HP: ${hp.current}/${hp.max}${deltaStr}${tempStr}${bloodied} | 🛡️ 基础 AC: ${char.ac}${conds}
[法术位资源]: ${slotsText || '无施法资源'}
[金币与物资]: 💰 ${state.inventory.gold}gp | 🎒 ${state.inventory.items.map(i => `${i.name}x${i.count}`).join(', ')}
[当前位置与目标]: 📍 ${state.status.location} | 🎯 ${state.status.quest}${mobsDashboard}
==========================================================================================`;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}⚔️ D&D 战役状态持久化管理器 (Session State Manager)${colors.reset}

${colors.yellow}指令:${colors.reset}
  init <campaign> [options]    初始化新战役状态文件
  show <campaign> [options]    显示战役当前状态 (支持 --hud, --json)
  update <campaign> [options]  实时更新生命、法术位、金币、物品与状态
  rest <campaign> <--short|--long> [--dice <N>] [--con <mod>] 执行短休或长休恢复
  mob-add <campaign> [options] 遭遇战加入敌方怪物 (--name <名> --hp <血> --ac <甲> --count <数> --init <先攻>)
  mob-hit <campaign> [options] 扣减或恢复敌方生命 (--target <目标名/编号> --damage <伤害值>)
  mob-clear <campaign>         遭遇战结束，清理战场所有怪物与轮次

${colors.yellow}初始化选项 (init):${colors.reset}
  --name <name>         角色名 (默认: 冒险者)
  --class <class>       职业 (默认: 战士，自动推导对应生命骰 d6~d12)
  --level <level>       等级 (默认: 1)
  --hp <maxHp>          最大生命值 (默认: 12)
  --ac <ac>             防御等级 (默认: 16)
  --speed <ft>          移动速度 (默认: 30，木精灵自动 35)
  --hit-die <dN>        显式指定生命骰 (如: d8, d10, d12)
  --slots <1:2,2:1>     初始法术位 (环阶:数量)
  --gold <gp>           初始金币 (默认: 15)
  --force               若战役已存在则强制覆盖

${colors.yellow}更新选项 (update):${colors.reset}
  --hp <+/-N | N>       增减或设定当前 HP (自动计算临时生命抵扣、浴血、昏迷及 0 HP 受击死亡豁免失败)
  --reason <text>       HP 变动原因注记 (如: "狼爪"，在 HUD 中生成增量算式防漂移锁)
  --temp-hp <N>         设定临时生命值 (自动遵循不叠加取高值规则，传 0 清零)
  --max-hp <N>          调整最大生命上限 (自动压低超出的当前 HP 并重算浴血)
  --ac <N>              调整防御等级 AC
  --speed <N>           调整移动速度
  --death-save <type>   记录死亡豁免 (success | fail | crit-success | crit-fail | reset)
  --inspiration <1|0>   增减英雄激励
  --slot <level> <+/-N> 消耗或恢复对应环阶法术位
  --slots <1:2,2:1>     更新角色法术位配置
  --gold <+/-N | N>     增减或设定金币数量
  --add-item <name>     增加背包物品
  --remove-item <name>  移除或消耗背包物品
  --add-condition <c>   附加异常状态 (如: 中毒, 受擒, 力竭 2)
  --remove-condition <c>解除异常状态
  --location <text>     更新当前地图与位置
  --quest <text>        更新当前主线/剧情目标
  --round <+/-N | N>    更新战斗轮次计数

${colors.yellow}遭遇战怪物选项 (mob-add / mob-hit):${colors.reset}
  --target <id/name>    目标怪物 ID (如: 地精武者-1，按名称匹配时自动优先命中存活目标)
  --damage <N>          对目标造成的伤害点数
  --count <N>           生成怪物数量 (默认: 1，同名怪物自动往后续编不覆盖)
  --init <N>            怪物先攻检定值
`);
}

export function parseCliArgs(args) {
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
    else if (arg === '--crit') options.crit = true;
    else if (arg === '--name') options.name = args[++i];
    else if (arg === '--class') options.class = args[++i];
    else if (arg === '--race' || arg === '--species') options.species = args[++i];
    else if (arg === '--level') options.level = args[++i];
    else if (arg === '--hp') options.hp = args[++i];
    else if (arg === '--reason') options.reason = args[++i];
    else if (arg === '--temp-hp') options.tempHp = args[++i];
    else if (arg === '--max-hp') options.maxHp = args[++i];
    else if (arg === '--ac') options.ac = args[++i];
    else if (arg === '--speed') options.speed = args[++i];
    else if (arg === '--hit-die') options.hitDie = args[++i];
    else if (arg === '--death-save') options.deathSave = args[++i];
    else if (arg === '--dice' || arg === '--hit-dice') options.dice = args[++i];
    else if (arg === '--con') options.con = args[++i];
    else if (arg === '--heal') options.heal = args[++i];
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
    else if (arg === '--target') options.target = args[++i];
    else if (arg === '--damage') options.damage = args[++i];
    else if (arg === '--count') options.count = args[++i];
    else if (arg === '--init') options.init = args[++i];
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
      const state = applyRest(campaign, restType, options);
      console.log(`${colors.green}✓ 战役 "${campaign}" 完成${restType === 'long' ? '长休' : '短休'}！${colors.reset}\n`);
      console.log(generateHud(state, 'line'));
    } else if (command === 'mob-add') {
      const state = addEncounterMob(campaign, options);
      console.log(`${colors.green}✓ 遭遇战怪物已加入 "${campaign}"！${colors.reset}\n`);
      console.log(generateHud(state, 'combat'));
    } else if (command === 'mob-hit') {
      const target = options.target || options.name;
      const dmg = options.damage !== undefined ? options.damage : (options.hp !== undefined ? options.hp : 0);
      if (!target) {
        console.error(`${colors.red}错误: 请通过 --target 指定受击目标 (例如: --target "地精武者-1")${colors.reset}`);
        process.exit(1);
      }
      const state = damageEncounterMob(campaign, target, dmg);
      console.log(`${colors.green}✓ 目标 "${target}" 结算完成！${colors.reset}\n`);
      console.log(generateHud(state, 'combat'));
    } else if (command === 'mob-clear') {
      const state = clearEncounter(campaign);
      console.log(`${colors.green}✓ 战役 "${campaign}" 遭遇战已清空，退出战斗轮！${colors.reset}\n`);
      console.log(generateHud(state, 'line'));
    } else {
      console.error(`${colors.red}未知指令: "${command}"。请使用 init, show, update, rest, mob-add, mob-hit, 或 mob-clear。${colors.reset}`);
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
