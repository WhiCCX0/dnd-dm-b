#!/usr/bin/env node

/**
 * Lightweight D&D Campaign Session State Manager
 * Zero-dependency persistent state tracking for players and DMs.
 *
 * Usage:
 *   node scripts/state.js init <campaign> [options]
 *   node scripts/state.js add-member <campaign> [options]
 *   node scripts/state.js show <campaign> [--hud] [--json] [--veil]
 *   node scripts/state.js update <campaign> [options]
 *   node scripts/state.js rest <campaign> <--short | --long> [--dice <N>] [--con <mod>]
 *   node scripts/state.js next <campaign>
 *   node scripts/state.js note <campaign> [--cat <npc|location|clue|quest|fact>] [--add <text> | --remove <text> | --list]
 *   node scripts/state.js encounter-calc [<campaign>] --party <lv1,lv2> --crs <cr1,cr2>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from './roll-dice.js';
import {
  WORLD_SCHEMA_VERSION,
  JIANHUO_WORLD_ID,
  coinsToCopper,
  formatCopper,
  executeDualFileTx,
  recoverPendingOp
} from './world-contract.js';
import { advanceWorldTimeWithTracks } from './world.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PRESETS_PATH = path.resolve(ROOT_DIR, 'resources', 'premade-characters', 'presets.json');
const MAX_LOG_ENTRIES = 30;

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bright: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  blue: useColor ? '\x1b[34m' : '',
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

// DMG 2024 XP Budgets per character level (Low, Moderate, High)
const XP_BUDGET_BY_LEVEL = {
  0: { low: 25, moderate: 50, high: 75 },
  1: { low: 50, moderate: 75, high: 100 },
  2: { low: 100, moderate: 150, high: 200 },
  3: { low: 150, moderate: 225, high: 400 },
  4: { low: 250, moderate: 375, high: 500 },
  5: { low: 500, moderate: 750, high: 1100 },
  6: { low: 600, moderate: 1000, high: 1400 },
  7: { low: 750, moderate: 1300, high: 1700 },
  8: { low: 1000, moderate: 1700, high: 2100 },
  9: { low: 1300, moderate: 2000, high: 2600 },
  10: { low: 1600, moderate: 2300, high: 3100 },
  11: { low: 1900, moderate: 2900, high: 4100 },
  12: { low: 2200, moderate: 3700, high: 4700 },
  13: { low: 2600, moderate: 4200, high: 5400 },
  14: { low: 2900, moderate: 4900, high: 6200 },
  15: { low: 3300, moderate: 5400, high: 7800 },
  16: { low: 3800, moderate: 6100, high: 9800 },
  17: { low: 4500, moderate: 7200, high: 11700 },
  18: { low: 5000, moderate: 8700, high: 14200 },
  19: { low: 5500, moderate: 10700, high: 17200 },
  20: { low: 6400, moderate: 13200, high: 22000 },
};

const CR_XP_MAP = {
  '0': 10,
  '1/8': 25,
  '0.125': 25,
  '1/4': 50,
  '0.25': 50,
  '1/2': 100,
  '0.5': 100,
  '1': 200,
  '2': 450,
  '3': 700,
  '4': 1100,
  '5': 1800,
  '6': 2300,
  '7': 2900,
  '8': 3900,
  '9': 5000,
  '10': 5900,
  '11': 7200,
  '12': 8400,
  '13': 10000,
  '14': 11500,
  '15': 13000,
  '16': 15000,
  '17': 18000,
  '18': 20000,
  '19': 22000,
  '20': 25000,
  '21': 33000,
  '22': 41000,
  '23': 50000,
  '24': 62000,
  '25': 75000,
  '26': 90000,
  '27': 105000,
  '28': 120000,
  '29': 135000,
  '30': 155000,
};

const NOTE_CATEGORIES = ['npc', 'location', 'clue', 'quest', 'fact'];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function loadPresets() {
  if (!fs.existsSync(PRESETS_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(PRESETS_PATH, 'utf-8'));
}

export function getDefaultUserSessionsDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'dnd-dm-b', 'sessions');
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'dnd-dm-b', 'sessions');
}

export function getSessionsDir() {
  return process.env.DND_SESSIONS_DIR || process.env.SESSIONS_DIR || getDefaultUserSessionsDir();
}

export function isSessionOnSystemDrive(sessionPath, env = process.env, platform = process.platform) {
  if (!sessionPath) return false;
  const rawSysDrive = env.SystemDrive || (platform === 'win32' ? 'C:' : '');
  if (!rawSysDrive) return false;

  const normPath = String(sessionPath).replace(/\\/g, '/').replace(/\/+$/, '');
  const normSys = String(rawSysDrive).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normSys) return false;

  if (/^[a-zA-Z]:$/.test(normSys)) {
    return normPath.toUpperCase().startsWith(`${normSys.toUpperCase()}/`);
  }
  return normPath === normSys || normPath.startsWith(`${normSys}/`);
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
  if (explicitHitDie !== undefined && explicitHitDie !== null) {
    const normalized = String(explicitHitDie).trim().toLowerCase().replace(/^(\d+)$/, 'd$1');
    if (!/^d(4|6|8|10|12|20)$/.test(normalized)) {
      throw new Error(`无效的生命骰规格: "${explicitHitDie}" (仅支持 d4/d6/d8/d10/d12/d20)`);
    }
    return normalized;
  }
  const cls = String(className || '战士').trim().toLowerCase();
  if (cls === '平民' || cls === 'commoner') return 'd8';
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

  const explicitEnvDir = process.env.DND_SESSIONS_DIR || process.env.SESSIONS_DIR;
  if (explicitEnvDir) {
    return path.join(explicitEnvDir, safeName, 'state.json');
  }

  const userDir = getDefaultUserSessionsDir();
  const userPath = path.join(userDir, safeName, 'state.json');
  const legacyPath = path.join(path.resolve(ROOT_DIR, 'sessions'), safeName, 'state.json');

  if (fs.existsSync(legacyPath) && !fs.existsSync(userPath)) {
    console.warn(
      `[提示] 检测到旧位置存档 (${legacyPath})，当前继续读取旧位置；可将存档目录迁移至 ${path.join(userDir, safeName)} 以免更新技能时受影响。`
    );
    return legacyPath;
  }

  return userPath;
}

function parseSlots(str) {
  if (typeof str === 'object' && str !== null) {
    const copy = {};
    const entries = Object.entries(str);
    if (entries.length === 0) {
      return { 1: { max: 0, current: 0 } };
    }
    for (const [k, v] of entries) {
      const maxVal = Number(v.max) || 0;
      const curVal = v.current !== undefined
        ? Number(v.current)
        : (v.used !== undefined ? Math.max(0, maxVal - Number(v.used)) : maxVal);
      copy[k] = { max: maxVal, current: curVal };
    }
    return copy;
  }
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

function parseResourceSpec(specStr) {
  // Format: "名称:当前/上限[:恢复规则]" or "名称:上限[:恢复规则]"
  // e.g. "回气:2/2:short:1" or "引导神力:2/2:short:1" or "圣疗池:5:long:all"
  const raw = String(specStr || '').trim();
  const firstColon = raw.indexOf(':');
  if (firstColon <= 0) {
    throw new Error(`无效的资源配置格式: "${specStr}" (格式示例: 回气:2/2:short:1)`);
  }
  const name = raw.slice(0, firstColon).trim();
  const rest = raw.slice(firstColon + 1).trim();
  const secondColon = rest.indexOf(':');
  const countPart = secondColon === -1 ? rest : rest.slice(0, secondColon).trim();
  const recovery = secondColon === -1 ? 'long:all' : rest.slice(secondColon + 1).trim();

  let current;
  let max;
  if (countPart.includes('/')) {
    const [curStr, maxStr] = countPart.split('/');
    current = parseIntStrict(curStr, '资源当前值', { min: 0, max: 999 });
    max = parseIntStrict(maxStr, '资源上限值', { min: 1, max: 999 });
  } else {
    max = parseIntStrict(countPart, '资源上限值', { min: 1, max: 999 });
    current = max;
  }
  current = Math.min(current, max);
  return { name, resource: { current, max, recovery } };
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

function ensurePartyStructure(state) {
  if (!state.status) {
    state.status = {
      conditions: [],
      location: '初始冒险营地',
      quest: '探索未知区域',
      round: 0,
      inCombat: false,
      encounter: { active: false, mobs: [] }
    };
  }
  if (!Array.isArray(state.status.conditions)) {
    state.status.conditions = [];
  }
  if (!state.character.deathSaves) {
    state.character.deathSaves = { successes: 0, failures: 0 };
  }
  if (!state.character.resources) {
    state.character.resources = {};
  }
  if (state.character.concentration === undefined) {
    state.character.concentration = null;
  }
  if (state.character.initiative === undefined) {
    state.character.initiative = null;
  }
  // Keep primary character conditions linked with state.status.conditions
  state.character.conditions = state.status.conditions;

  if (!Array.isArray(state.party) || state.party.length === 0) {
    state.party = [state.character];
  } else {
    state.party[0] = state.character;
    for (let i = 1; i < state.party.length; i++) {
      const m = state.party[i];
      if (!m.deathSaves) m.deathSaves = { successes: 0, failures: 0 };
      if (!m.resources) m.resources = {};
      if (!Array.isArray(m.conditions)) m.conditions = [];
      if (m.concentration === undefined) m.concentration = null;
      if (m.initiative === undefined) m.initiative = null;
    }
  }

  if (!state.notes) {
    state.notes = { npc: [], location: [], clue: [], quest: [], fact: [] };
  } else {
    for (const cat of NOTE_CATEGORIES) {
      if (!Array.isArray(state.notes[cat])) state.notes[cat] = [];
    }
  }
}

function clearEphemeralDeltas(state) {
  ensurePartyStructure(state);
  for (const member of state.party) {
    if (member.hp) delete member.hp.lastDelta;
    delete member.concentrationCheckDc;
    if (member.spellSlots) {
      for (const s of Object.values(member.spellSlots)) {
        if (s && typeof s === 'object') delete s.lastDelta;
      }
    }
    if (member.resources) {
      for (const r of Object.values(member.resources)) {
        if (r && typeof r === 'object') delete r.lastDelta;
      }
    }
  }
  if (state.status?.encounter?.mobs) {
    for (const mob of state.status.encounter.mobs) {
      delete mob.lastDelta;
    }
  }
}

function resolvePartyMember(state, who) {
  ensurePartyStructure(state);
  if (!who) return state.party[0];
  const query = String(who).trim().toLowerCase();
  if (!query) return state.party[0];

  const exact = state.party.find(
    m => (m.id && m.id.toLowerCase() === query) || (m.name && m.name.toLowerCase() === query)
  );
  if (exact) return exact;

  const partial = state.party.filter(
    m => (m.id && m.id.toLowerCase().includes(query)) || (m.name && m.name.toLowerCase().includes(query))
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new Error(`队友名称 "${who}" 存在歧义，匹配到: ${partial.map(m => m.name).join(', ')}`);
  }
  throw new Error(`未找到匹配的队伍成员: "${who}" (当前队伍: ${state.party.map(m => m.name).join(', ')})`);
}

function getMemberConditions(state, member) {
  if (member === state.party[0] || member === state.character) {
    return state.status.conditions;
  }
  if (!Array.isArray(member.conditions)) {
    member.conditions = [];
  }
  return member.conditions;
}

function syncHpConditionsForMember(state, member, logs = []) {
  const hp = member.hp;
  const conditions = getMemberConditions(state, member);
  if (!member.deathSaves) {
    member.deathSaves = { successes: 0, failures: 0 };
  }

  // Auto update Bloodied (浴血) condition
  const bloodiedIndex = conditions.indexOf('浴血');
  if (hp.current > 0 && hp.current <= Math.floor(hp.max / 2)) {
    if (bloodiedIndex === -1) {
      conditions.push('浴血');
      logs.push('生命值跌破半数，进入【浴血】状态');
    }
  } else if (bloodiedIndex !== -1) {
    conditions.splice(bloodiedIndex, 1);
    logs.push('生命恢复半数以上，脱离【浴血】状态');
  }

  // Unconscious check & Death Save reset on heal
  const unconsciousIdx = conditions.indexOf('昏迷');
  if (hp.current === 0) {
    if (conditions.includes('死亡')) {
      if (unconsciousIdx !== -1) conditions.splice(unconsciousIdx, 1);
      const stableIdx = conditions.indexOf('稳定');
      if (stableIdx !== -1) conditions.splice(stableIdx, 1);
    } else if (unconsciousIdx === -1) {
      conditions.push('昏迷');
      logs.push('生命值归零，陷入【昏迷】并需进行死亡豁免');
    }
    if (member.concentration) {
      logs.push(`陷入昏迷/死亡，维持的【${member.concentration}】专注自动中断`);
      member.concentration = null;
    }
  } else if (hp.current > 0) {
    if (unconsciousIdx !== -1) {
      conditions.splice(unconsciousIdx, 1);
      logs.push('恢复生命，脱离【昏迷】状态');
    }
    const sIdx = conditions.indexOf('稳定');
    if (sIdx !== -1) {
      conditions.splice(sIdx, 1);
    }
    member.deathSaves = { successes: 0, failures: 0 };
  }
}

function buildCharacterFromPresetOrOptions(presetKey, options = {}, isPrimary = true) {
  let preset = null;
  if (presetKey) {
    const presets = loadPresets();
    const keyLower = String(presetKey).trim().toLowerCase();
    preset = presets[keyLower] || Object.values(presets).find(
      p => p.id.toLowerCase() === keyLower || p.name.toLowerCase().includes(keyLower)
    );
    if (!preset) {
      throw new Error(`未找到预设角色 "${presetKey}" (可选: ${Object.keys(presets).join(', ')})`);
    }
  }

  const level = parseIntStrict(
    (isPrimary ? options.level : undefined) ?? preset?.level ?? '1',
    'level',
    { min: 0, max: 20 }
  );
  const isLevel0 = level === 0;
  const conMod = (isPrimary && options.con !== undefined)
    ? parseIntStrict(options.con, 'con', { min: -5, max: 10 })
    : 0;
  const defaultLevel0Hp = Math.max(4, 4 + conMod);

  const maxHp = parseIntStrict(
    (isPrimary ? (options.hp ?? options.maxHp) : undefined) ?? preset?.hp ?? preset?.maxHp ?? (isLevel0 ? String(defaultLevel0Hp) : '12'),
    'hp',
    { min: 1, max: 9999 }
  );
  const ac = parseIntStrict(
    (isPrimary ? options.ac : undefined) ?? preset?.ac ?? (isLevel0 ? '10' : '16'),
    'ac',
    { min: 1, max: 99 }
  );
  const charClass = (isPrimary ? options.class : undefined) || preset?.class || (isLevel0 ? '平民' : '战士');
  const hitDie = isLevel0 && (!isPrimary || options.hitDie === undefined)
    ? 'd8'
    : inferHitDie(charClass, (isPrimary ? options.hitDie : undefined) ?? preset?.hitDie);
  const hdCount = Math.max(1, level);
  const speed = (isPrimary && options.speed !== undefined)
    ? inferSpeed(options)
    : (preset?.speed ?? inferSpeed(options));
  const slotsConfig = (isPrimary && options.slots)
    ? parseSlots(options.slots)
    : (preset?.spellSlots ? parseSlots(preset.spellSlots) : { 1: { max: 0, current: 0 } });

  const resources = {};
  if (preset?.resources) {
    for (const [k, v] of Object.entries(preset.resources)) {
      resources[k] = { current: v.current, max: v.max, recovery: v.recovery || 'long:all' };
    }
  } else if (!isLevel0 && (String(charClass).toLowerCase().includes('战士') || String(charClass).toLowerCase().includes('fighter'))) {
    resources['回气'] = { current: 2, max: 2, recovery: 'short:1' };
  }

  const charName = (isPrimary ? options.name : undefined) || preset?.name || '冒险者';
  const charId = preset?.id || charName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '') || 'hero';

  return {
    character: {
      id: charId,
      name: charName,
      class: charClass,
      species: (isPrimary ? options.species : undefined) || preset?.species || '人类',
      level,
      ac,
      speed,
      initiative: (isPrimary && options.init !== undefined)
        ? parseIntStrict(options.init, 'init', { min: -20, max: 99 })
        : null,
      hp: {
        current: maxHp,
        max: maxHp,
        temp: 0
      },
      hitDice: {
        total: hdCount,
        max: hdCount,
        current: hdCount,
        die: hitDie
      },
      deathSaves: {
        successes: 0,
        failures: 0
      },
      heroicInspiration: Boolean(preset?.heroicInspiration),
      concentration: null,
      spellSlots: slotsConfig,
      resources,
      conditions: []
    },
    preset
  };
}

function normalizePresetItems(preset) {
  if (!preset) return null;
  const rawList = preset.items || preset.inventory;
  if (!Array.isArray(rawList)) return null;
  return rawList.map(item => {
    if (typeof item === 'object' && item !== null) {
      return { name: String(item.name), count: Number(item.count) || 1 };
    }
    const str = String(item).trim();
    const m = str.match(/^(.+?)\s*[x×]\s*(\d+)$/i);
    if (m) {
      return { name: m[1].trim(), count: parseInt(m[2], 10) };
    }
    return { name: str, count: 1 };
  });
}

export function defaultState(campaignName, options = {}) {
  const presetKeys = options.preset
    ? String(options.preset).split(',').map(s => s.trim()).filter(Boolean)
    : [null];

  const party = [];
  let primaryPreset = null;
  for (let i = 0; i < presetKeys.length; i++) {
    const { character, preset } = buildCharacterFromPresetOrOptions(presetKeys[i], options, i === 0);
    if (i === 0) primaryPreset = preset;
    party.push(character);
  }

  const primaryChar = party[0];
  const gold = parseIntStrict(
    options.gold ?? primaryPreset?.gold ?? '15',
    'gold',
    { min: 0, max: 100000000 }
  );
  const presetItems = normalizePresetItems(primaryPreset);
  const items = options.items
    ? structuredClone(options.items)
    : (presetItems || [
        { name: '治疗药水', count: 1 },
        { name: '火把', count: 2 },
        { name: '口粮(天)', count: 5 }
      ]);

  const initialConditions = [];
  primaryChar.conditions = initialConditions;

  const isDMode = String(options.mode || '').toUpperCase() === 'D';
  const copper = isDMode
    ? (options.copper !== undefined
        ? parseIntStrict(options.copper, 'copper', { min: 0, max: 1000000000 })
        : coinsToCopper({ gp: gold }))
    : undefined;

  return {
    ...(isDMode
      ? {
          meta: {
            mode: 'D',
            worldId: JIANHUO_WORLD_ID,
            schemaVersion: WORLD_SCHEMA_VERSION
          }
        }
      : {}),
    campaign: campaignName,
    character: primaryChar,
    party,
    inventory: isDMode
      ? { copper, items }
      : { gold, items },
    status: {
      conditions: initialConditions,
      location: options.location || '初始冒险营地',
      quest: options.quest || '探索未知区域',
      round: 0,
      inCombat: false,
      turnIndex: 0,
      activeTurn: null,
      activeTurnId: null,
      encounter: {
        active: false,
        mobs: []
      }
    },
    notes: {
      npc: [],
      location: [],
      clue: [],
      quest: [],
      fact: []
    },
    log: [
      {
        timestamp: new Date().toISOString(),
        action: '战役初始化',
        detail: `队伍【${party.map(p => p.name).join('、')}】启程`
      }
    ],
    updatedAt: new Date().toISOString()
  };
}

export function getState(campaignName) {
  const filePath = getSessionPath(campaignName);
  const sessionDir = path.dirname(filePath);
  if (fs.existsSync(path.join(sessionDir, 'pending-op.json'))) {
    recoverPendingOp(sessionDir);
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const state = JSON.parse(raw);
    ensurePartyStructure(state);
    return state;
  } catch (err) {
    throw new Error(`Failed to read session state for "${campaignName}": ${err.message}`);
  }
}

export function saveState(campaignName, state) {
  ensurePartyStructure(state);
  const filePath = getSessionPath(campaignName);
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  if (Array.isArray(state.log) && state.log.length > MAX_LOG_ENTRIES) {
    state.log = state.log.slice(-MAX_LOG_ENTRIES);
  }
  if (state.meta?.mode === 'D' && state.inventory && 'gold' in state.inventory) {
    delete state.inventory.gold;
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

export function addPartyMember(campaignName, options = {}) {
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }
  clearEphemeralDeltas(state);

  const presetKeys = options.preset
    ? String(options.preset).split(',').map(s => s.trim()).filter(Boolean)
    : [null];

  const addedNames = [];
  for (const key of presetKeys) {
    const { character } = buildCharacterFromPresetOrOptions(key, options, key === null);
    if (state.party.some(m => m.name === character.name || (m.id && m.id === character.id))) {
      throw new Error(`队伍中已存在成员 "${character.name}"`);
    }
    state.party.push(character);
    addedNames.push(character.name);
  }

  appendLog(state, '加入队友', `【${addedNames.join('、')}】加入冒险小队`);
  return saveState(campaignName, state);
}

function decrementTimedConditions(conditions, logs = [], ownerLabel = '') {
  const next = [];
  const prefix = ownerLabel ? `【${ownerLabel}】` : '';
  for (const cond of conditions) {
    const m = String(cond).match(/^(.+?):(\d+)$/);
    if (m) {
      const baseName = m[1];
      const remaining = parseInt(m[2], 10) - 1;
      if (remaining > 0) {
        next.push(`${baseName}:${remaining}`);
        logs.push(`${prefix}状态【${baseName}】剩余 ${remaining} 轮`);
      } else {
        logs.push(`${prefix}状态【${baseName}】持续时间结束，已自动解除`);
      }
    } else {
      next.push(cond);
    }
  }
  conditions.splice(0, conditions.length, ...next);
}

export function updateState(campaignName, updates = {}) {
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }

  clearEphemeralDeltas(state);
  const member = resolvePartyMember(state, updates.who);
  const conditions = getMemberConditions(state, member);
  const logs = [];
  const whoPrefix = state.party.length > 1 ? `【${member.name}】` : '';

  // Revive flag
  if (updates.revive) {
    const deadIdx = conditions.indexOf('死亡');
    if (deadIdx !== -1) {
      conditions.splice(deadIdx, 1);
      member.deathSaves = { successes: 0, failures: 0 };
      if (member.hp.current === 0 && updates.hp === undefined) {
        member.hp.current = 1;
        member.hp.lastDelta = '+1 复活苏醒';
      }
      syncHpConditionsForMember(state, member, logs);
      logs.push(`${whoPrefix}已复活脱离【死亡】状态`);
    }
  }

  // 0. Max HP (Process before HP so clamping and bloodied checks stay consistent)
  if (updates.maxHp !== undefined) {
    const val = parseIntStrict(updates.maxHp, 'maxHp', { min: 1, max: 9999 });
    member.hp.max = val;
    if (member.hp.current > val) {
      member.hp.current = val;
    }
    logs.push(`${whoPrefix}最大生命上限调整为 ${member.hp.max} (当前HP: ${member.hp.current}/${member.hp.max})`);
    if (updates.hp === undefined) {
      syncHpConditionsForMember(state, member, logs);
    }
  }

  // 1. HP Updates (with Temp HP absorption, Massive Damage instant death, Dead healing lock & Concentration check)
  if (updates.hp !== undefined) {
    const hpStr = String(updates.hp).trim();
    const hp = member.hp;
    const prevHp = hp.current;
    const reasonSuffix = updates.reason ? ` ${updates.reason}` : '';

    if (hpStr.startsWith('+') || hpStr.startsWith('-')) {
      const delta = parseIntStrict(hpStr, 'hp', { min: -99999, max: 99999 });
      if (delta < 0) {
        const damage = Math.abs(delta);
        let unabsorbed = damage;
        if (hp.temp > 0) {
          if (hp.temp >= damage) {
            hp.temp -= damage;
            unabsorbed = 0;
            hp.lastDelta = `-0 (临时HP抵扣${damage}${reasonSuffix})`;
            logs.push(`${whoPrefix}临时生命抵扣 ${damage} 点伤害 (剩余临时HP: ${hp.temp})`);
          } else {
            unabsorbed = damage - hp.temp;
            logs.push(`${whoPrefix}临时生命耗尽 (抵扣 ${hp.temp})，扣除实际生命 ${unabsorbed} 点`);
            hp.temp = 0;
            hp.current = Math.max(0, hp.current - unabsorbed);
            hp.lastDelta = `-${prevHp - hp.current}${reasonSuffix}`;
          }
        } else {
          hp.current = Math.max(0, hp.current - damage);
          hp.lastDelta = `-${prevHp - hp.current}${reasonSuffix}`;
          logs.push(`${whoPrefix}受到 ${damage} 点伤害 (当前HP: ${hp.current}/${hp.max})`);
        }

        // Check Massive Damage Instant Death (when dropping from >0 HP and remaining overflow >= maxHp)
        const overflowDamage = prevHp > 0 ? Math.max(0, unabsorbed - prevHp) : unabsorbed;
        if (hp.current === 0 && overflowDamage >= hp.max) {
          member.deathSaves.failures = 3;
          if (!conditions.includes('死亡')) {
            conditions.push('死亡');
          }
          const sIdx = conditions.indexOf('稳定');
          if (sIdx !== -1) conditions.splice(sIdx, 1);
          logs.push(`${whoPrefix}承受巨额溢伤 (${overflowDamage} >= HP上限 ${hp.max})，角色当场【死亡】！`);
        } else if (prevHp === 0 && unabsorbed > 0) {
          // 0 HP taking damage removes Stable and triggers Death Save failure(s)
          const sIdx = conditions.indexOf('稳定');
          if (sIdx !== -1) {
            conditions.splice(sIdx, 1);
            logs.push(`${whoPrefix}在稳定状态下受击，脱离【稳定】状态`);
          }
          const failAdded = updates.crit ? 2 : 1;
          member.deathSaves.failures = Math.min(3, member.deathSaves.failures + failAdded);
          logs.push(`${whoPrefix}0 HP 状态下受击，死亡豁免失败 +${failAdded} (累计失败: ${member.deathSaves.failures}/3)`);
          if (member.deathSaves.failures >= 3) {
            member.deathSaves.failures = 3;
            if (!conditions.includes('死亡')) {
              conditions.push('死亡');
            }
            logs.push(`${whoPrefix}死亡豁免累计 3 次失败，角色【死亡】！`);
          }
        }

        // Concentration check if still conscious and concentrating (includes damage absorbed by Temp HP)
        if (damage > 0 && hp.current > 0 && member.concentration) {
          const concDc = Math.min(30, Math.max(10, Math.floor(damage / 2)));
          member.concentrationCheckDc = concDc;
          logs.push(`${whoPrefix}⚠️ 专注检定提示: 需进行 DC ${concDc} 体质豁免以维持【${member.concentration}】`);
        }
      } else {
        // Healing: Dead characters cannot be healed without --revive
        if (conditions.includes('死亡') && !updates.revive) {
          throw new Error(`角色【${member.name}】已死亡，普通治疗无法生效（需先使用复活法术或传入 --revive）`);
        }
        hp.current = Math.min(hp.max, hp.current + delta);
        const healed = hp.current - prevHp;
        hp.lastDelta = `+${healed}${reasonSuffix}`;
        logs.push(`${whoPrefix}恢复 ${healed} 点生命 (当前HP: ${hp.current}/${hp.max})`);
      }
    } else {
      const targetHp = parseIntStrict(hpStr, 'hp', { min: 0, max: 99999 });
      if (targetHp > 0 && conditions.includes('死亡') && !updates.revive) {
        throw new Error(`角色【${member.name}】已死亡，普通治疗无法生效（需先使用复活法术或传入 --revive）`);
      }
      hp.current = Math.max(0, Math.min(hp.max, targetHp));
      const diff = hp.current - prevHp;
      if (diff !== 0) {
        hp.lastDelta = `${diff > 0 ? '+' : ''}${diff}${reasonSuffix}`;
      } else {
        delete hp.lastDelta;
      }
      logs.push(`${whoPrefix}设置当前生命为 ${hp.current}/${hp.max}`);
    }

    syncHpConditionsForMember(state, member, logs);
  }

  // 2. Temp HP
  if (updates.tempHp !== undefined) {
    const val = parseIntStrict(updates.tempHp, 'tempHp', { min: 0, max: 9999 });
    if (val === 0) {
      member.hp.temp = 0;
    } else {
      member.hp.temp = Math.max(member.hp.temp || 0, val);
    }
    logs.push(`${whoPrefix}临时生命设置为 ${member.hp.temp}`);
  }

  // 3. AC, Speed & Initiative
  if (updates.ac !== undefined) {
    member.ac = parseIntStrict(updates.ac, 'ac', { min: 1, max: 99 });
    logs.push(`${whoPrefix}防御等级(AC)调整为 ${member.ac}`);
  }

  if (updates.speed !== undefined) {
    member.speed = parseIntStrict(updates.speed, 'speed', { min: 0, max: 300 });
    logs.push(`${whoPrefix}移动速度调整为 ${member.speed}`);
  }

  if (updates.init !== undefined) {
    member.initiative = parseIntStrict(updates.init, 'init', { min: -20, max: 99 });
    logs.push(`${whoPrefix}先攻值设定为 ${member.initiative}`);
  }

  // 4. Death Saves manual tracking
  if (updates.deathSave !== undefined) {
    if (conditions.includes('死亡')) {
      throw new Error(`角色【${member.name}】已死亡，无法执行死亡豁免（需先使用 --revive 复活）`);
    }
    if (member.hp.current > 0) {
      throw new Error(`角色【${member.name}】当前生命值大于 0 (HP ${member.hp.current}/${member.hp.max})，无需进行死亡豁免`);
    }
    const ds = String(updates.deathSave).trim().toLowerCase();
    const saves = member.deathSaves;
    if (ds === 'success') {
      saves.successes = Math.min(3, saves.successes + 1);
      logs.push(`${whoPrefix}死亡豁免成功 (${saves.successes}/3)`);
      if (saves.successes >= 3) {
        saves.successes = 0;
        saves.failures = 0;
        if (!conditions.includes('稳定')) {
          conditions.push('稳定');
        }
        logs.push(`${whoPrefix}累计 3 次死亡豁免成功，伤势【稳定】！`);
      }
    } else if (ds === 'fail' || ds === 'failure') {
      saves.failures = Math.min(3, saves.failures + 1);
      logs.push(`${whoPrefix}死亡豁免失败 (${saves.failures}/3)`);
      if (saves.failures >= 3 && !conditions.includes('死亡')) {
        conditions.push('死亡');
        syncHpConditionsForMember(state, member, logs);
        logs.push(`${whoPrefix}累计 3 次死亡豁免失败，角色【死亡】！`);
      }
    } else if (ds === 'crit-fail' || ds === 'nat1') {
      saves.failures = Math.min(3, saves.failures + 2);
      logs.push(`${whoPrefix}死亡豁免自然 1 大失败！失败 +2 (${saves.failures}/3)`);
      if (saves.failures >= 3 && !conditions.includes('死亡')) {
        conditions.push('死亡');
        syncHpConditionsForMember(state, member, logs);
        logs.push(`${whoPrefix}累计 3 次死亡豁免失败，角色【死亡】！`);
      }
    } else if (ds === 'crit-success' || ds === 'nat20') {
      member.hp.current = 1;
      member.hp.lastDelta = '+1 死亡豁免自然20苏醒';
      syncHpConditionsForMember(state, member, logs);
      logs.push(`${whoPrefix}死亡豁免自然 20 奇迹苏醒！恢复 1 点生命值`);
    } else if (ds === 'reset') {
      saves.successes = 0;
      saves.failures = 0;
      logs.push(`${whoPrefix}重置死亡豁免计数`);
    } else {
      throw new Error(`未知的死亡豁免指令: "${updates.deathSave}" (支持: success, fail, crit-success, crit-fail, reset)`);
    }
  }

  // 5. Heroic Inspiration & Concentration
  if (updates.inspiration !== undefined) {
    const insp = updates.inspiration === true || updates.inspiration === 'true' || updates.inspiration === 1 || updates.inspiration === '1';
    member.heroicInspiration = insp;
    logs.push(`${whoPrefix}英雄激励状态: ${insp ? '已拥有 [●]' : '已消耗 [○]'}`);
  }

  if (updates.concentrate !== undefined) {
    const spell = String(updates.concentrate || '').trim();
    if (!spell || spell.toLowerCase() === 'none' || spell.toLowerCase() === 'off') {
      member.concentration = null;
      logs.push(`${whoPrefix}解除法术专注`);
    } else {
      const prevConc = member.concentration;
      member.concentration = spell;
      logs.push(`${whoPrefix}开始专注维持【${spell}】${prevConc && prevConc !== spell ? ` (原【${prevConc}】专注中断)` : ''}`);
    }
  }

  if (updates.breakConcentration) {
    if (member.concentration) {
      logs.push(`${whoPrefix}中断【${member.concentration}】的法术专注`);
      member.concentration = null;
    }
  }

  // 6. Spell Slots & Class Resources
  if (updates.slots !== undefined) {
    member.spellSlots = parseSlots(updates.slots);
    logs.push(`${whoPrefix}法术位配置已更新`);
  }

  if (updates.slotLevel !== undefined && updates.slotChange !== undefined) {
    const lvl = parseIntStrict(updates.slotLevel, 'slotLevel', { min: 1, max: 9 });
    const changeStr = String(updates.slotChange).trim();
    const slot = member.spellSlots[lvl];
    if (!slot || slot.max <= 0) {
      throw new Error(`角色没有可用的 ${lvl} 环法术位`);
    }
    const prevSlot = slot.current;
    if (changeStr.startsWith('+') || changeStr.startsWith('-')) {
      const delta = parseIntStrict(changeStr, 'slotChange', { min: -99, max: 99 });
      if (delta < 0 && slot.current + delta < 0) {
        throw new Error(`${lvl} 环法术位剩余不足 (当前: ${slot.current}/${slot.max})`);
      }
      slot.current = Math.max(0, Math.min(slot.max, slot.current + delta));
    } else {
      const target = parseIntStrict(changeStr, 'slotChange', { min: 0, max: 99 });
      slot.current = Math.max(0, Math.min(slot.max, target));
    }
    const slotDiff = slot.current - prevSlot;
    if (slotDiff !== 0) {
      slot.lastDelta = `${slotDiff > 0 ? '+' : ''}${slotDiff}`;
    }
    logs.push(`${whoPrefix}${lvl}环法术位更新: ${slot.current}/${slot.max}`);
  }

  if (updates.setResource !== undefined) {
    const specs = Array.isArray(updates.setResource) ? updates.setResource : [updates.setResource];
    for (const spec of specs) {
      const { name, resource } = parseResourceSpec(spec);
      member.resources[name] = resource;
      logs.push(`${whoPrefix}配置职业资源【${name}】: ${resource.current}/${resource.max} (${resource.recovery})`);
    }
  }

  if (updates.useResource !== undefined) {
    const raw = String(updates.useResource).trim();
    let resName = raw;
    let delta = updates.resourceDelta !== undefined
      ? parseIntStrict(updates.resourceDelta, 'resourceDelta', { min: -999, max: 999 })
      : -1;
    if (raw.includes(':')) {
      const parts = raw.split(':');
      resName = parts[0].trim();
      delta = parseIntStrict(parts[1], 'resourceDelta', { min: -999, max: 999 });
    }
    const res = member.resources?.[resName];
    if (!res) {
      throw new Error(`角色【${member.name}】未配置职业资源 "${resName}"`);
    }
    if (delta < 0 && res.current + delta < 0) {
      throw new Error(`职业资源【${resName}】剩余次数不足 (当前: ${res.current}/${res.max})`);
    }
    const prev = res.current;
    res.current = Math.max(0, Math.min(res.max, res.current + delta));
    const diff = res.current - prev;
    if (diff !== 0) {
      res.lastDelta = `${diff > 0 ? '+' : ''}${diff}`;
    }
    logs.push(`${whoPrefix}职业资源【${resName}】变动: ${res.current}/${res.max}`);
  }

  // 7. Gold / Copper
  if (state.meta?.mode === 'D') {
    if (typeof state.inventory.copper !== 'number') {
      state.inventory.copper = 0;
    }
    delete state.inventory.gold;

    if (updates.gold !== undefined) {
      const goldStr = String(updates.gold).trim();
      if (goldStr.startsWith('+') || goldStr.startsWith('-')) {
        const deltaGp = parseIntStrict(goldStr, 'gold', { min: -100000000, max: 100000000 });
        const deltaCp = deltaGp * 100;
        state.inventory.copper = Math.max(0, state.inventory.copper + deltaCp);
        logs.push(`钱袋变动 ${deltaGp > 0 ? '+' + deltaGp : deltaGp}gp (${deltaCp > 0 ? '+' + deltaCp : deltaCp}cp，现余: ${formatCopper(state.inventory.copper)})`);
      } else {
        const valGp = parseIntStrict(goldStr, 'gold', { min: 0, max: 100000000 });
        state.inventory.copper = valGp * 100;
        logs.push(`钱袋设置为 ${formatCopper(state.inventory.copper)}`);
      }
    }

    if (updates.copper !== undefined) {
      const cpStr = String(updates.copper).trim();
      if (cpStr.startsWith('+') || cpStr.startsWith('-')) {
        const deltaCp = parseIntStrict(cpStr, 'copper', { min: -1000000000, max: 1000000000 });
        state.inventory.copper = Math.max(0, state.inventory.copper + deltaCp);
        logs.push(`钱袋变动 ${deltaCp > 0 ? '+' + deltaCp : deltaCp}cp (现余: ${formatCopper(state.inventory.copper)})`);
      } else {
        const valCp = parseIntStrict(cpStr, 'copper', { min: 0, max: 1000000000 });
        state.inventory.copper = valCp;
        logs.push(`钱袋设置为 ${formatCopper(state.inventory.copper)}`);
      }
    }
  } else if (updates.gold !== undefined) {
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

  // 9. Conditions (supports comma-separated list and timed conditions like 中毒:2)
  if (updates.addCondition) {
    const conds = String(updates.addCondition).split(',').map(s => s.trim()).filter(Boolean);
    for (const cond of conds) {
      const baseName = cond.split(':')[0];
      const existingIdx = conditions.findIndex(c => c === cond || c.split(':')[0] === baseName);
      if (existingIdx !== -1) {
        conditions[existingIdx] = cond;
      } else {
        conditions.push(cond);
      }
      logs.push(`${whoPrefix}附加状态: 【${cond}】`);
    }
  }

  if (updates.removeCondition) {
    const conds = String(updates.removeCondition).split(',').map(s => s.trim()).filter(Boolean);
    for (const cond of conds) {
      const idx = conditions.findIndex(c => c === cond || c.split(':')[0] === cond);
      if (idx !== -1) {
        const removed = conditions[idx];
        conditions.splice(idx, 1);
        logs.push(`${whoPrefix}移除状态: 【${removed}】`);
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
    const prevRound = state.status.round || 0;
    const roundStr = String(updates.round).trim();
    if (roundStr.startsWith('+') || roundStr.startsWith('-')) {
      const delta = parseIntStrict(roundStr, 'round', { min: -9999, max: 9999 });
      state.status.round = Math.max(0, state.status.round + delta);
    } else {
      const val = parseIntStrict(roundStr, 'round', { min: 0, max: 9999 });
      state.status.round = val;
    }
    state.status.inCombat = state.status.round > 0;
    if (!state.status.inCombat) {
      state.status.turnIndex = 0;
      state.status.activeTurn = null;
      state.status.activeTurnId = null;
    }
    logs.push(`战斗轮次: 第 ${state.status.round} 轮`);
  }

  if (logs.length > 0) {
    appendLog(state, '状态变更', logs.join('; '));
  }

  return saveState(campaignName, state);
}

function mutateStateForRest(state, restType = 'short', options = {}) {
  clearEphemeralDeltas(state);
  const targetMembers = options.who ? [resolvePartyMember(state, options.who)] : state.party;

  // Reject rest if explicitly targeted member (or primary solo member) is dead
  for (const m of targetMembers) {
    const conds = getMemberConditions(state, m);
    if (conds.includes('死亡') && (options.who || state.party.length === 1)) {
      throw new Error(`角色【${m.name}】已死亡，无法通过休整恢复生命（需先复活 --revive）`);
    }
  }

  if (restType === 'long') {
    const details = [];
    for (const char of targetMembers) {
      const conds = getMemberConditions(state, char);
      if (conds.includes('死亡')) continue;

      const healed = char.hp.max - char.hp.current;
      char.hp.current = char.hp.max;
      char.hp.temp = 0;
      char.deathSaves = { successes: 0, failures: 0 };
      char.concentration = null;
      if (healed > 0) {
        char.hp.lastDelta = `+${healed} 长休恢复`;
      } else {
        delete char.hp.lastDelta;
      }

      const diceRecover = char.hitDice.total - char.hitDice.current;
      char.hitDice.current = char.hitDice.total;

      for (const lvl of Object.keys(char.spellSlots || {})) {
        char.spellSlots[lvl].current = char.spellSlots[lvl].max;
        delete char.spellSlots[lvl].lastDelta;
      }

      for (const res of Object.values(char.resources || {})) {
        res.current = res.max;
        delete res.lastDelta;
      }

      const nextConditions = [];
      for (const c of conds) {
        if (['浴血', '昏迷', '稳定', '力竭', '力竭 1', '力竭1'].includes(c)) {
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
      conds.splice(0, conds.length, ...nextConditions);
      details.push(`${char.name}: HP ${char.hp.max}/${char.hp.max}, 生命骰 +${diceRecover} (${char.hitDice.current}/${char.hitDice.total})`);
    }

    state.status.round = 0;
    state.status.inCombat = false;
    state.status.turnIndex = 0;
    state.status.activeTurn = null;
    state.status.activeTurnId = null;

    appendLog(
      state,
      '长休完成',
      `生命值完全恢复，恢复全部法术位与职业资源，重获全部生命骰 (${details.join('; ')})`
    );
  } else {
    // Short rest: Optional Hit Dice spending + reset short-rest resources
    const primaryTarget = resolvePartyMember(state, options.who);
    let hdDetail = '';
    const diceToSpend = options.dice ?? options.hitDice;
    if (diceToSpend !== undefined) {
      if (getMemberConditions(state, primaryTarget).includes('死亡')) {
        throw new Error(`角色【${primaryTarget.name}】已死亡，无法通过休整恢复生命（需先复活 --revive）`);
      }
      const spend = parseIntStrict(diceToSpend, 'dice', { min: 1, max: 20 });
      if (spend > primaryTarget.hitDice.current) {
        throw new Error(`可用生命骰不足 (当前剩余: ${primaryTarget.hitDice.current}/${primaryTarget.hitDice.total})`);
      }
      const conMod = options.con !== undefined ? parseIntStrict(options.con, 'con', { min: -5, max: 10 }) : 0;
      const sides = parseInt(String(primaryTarget.hitDice.die || 'd10').replace(/^d/i, ''), 10) || 10;

      let totalRolled = 0;
      const rolls = [];
      if (options.heal !== undefined) {
        totalRolled = parseIntStrict(options.heal, 'heal', { min: 0, max: 9999 });
      } else {
        const rng = createRng(options.rng);
        for (let i = 0; i < spend; i++) {
          const u = rng();
          const clamped = u >= 1 ? 0.999999999 : (u < 0 ? 0 : u);
          const r = Math.floor(clamped * sides) + 1;
          const gained = Math.max(1, r + conMod);
          rolls.push(r);
          totalRolled += gained;
        }
      }

      primaryTarget.hitDice.current -= spend;
      const prevHp = primaryTarget.hp.current;
      primaryTarget.hp.current = Math.min(primaryTarget.hp.max, primaryTarget.hp.current + totalRolled);
      const actualHealed = primaryTarget.hp.current - prevHp;
      primaryTarget.hp.lastDelta = `+${actualHealed} 短休生命骰`;
      syncHpConditionsForMember(state, primaryTarget, []);
      hdDetail = `，【${primaryTarget.name}】消耗 ${spend} 枚生命骰(${primaryTarget.hitDice.die}${rolls.length ? ': [' + rolls.join(',') + ']' : ''})恢复 ${actualHealed} 点生命 (HP ${primaryTarget.hp.current}/${primaryTarget.hp.max})`;
    }

    // Recover short-rest resources across target members
    const recoveredResources = [];
    for (const m of targetMembers) {
      if (getMemberConditions(state, m).includes('死亡')) continue;
      for (const [resName, res] of Object.entries(m.resources || {})) {
        const rec = String(res.recovery || '').toLowerCase();
        if (rec === 'short' || rec === 'short:all') {
          if (res.current < res.max) {
            res.current = res.max;
            recoveredResources.push(`${m.name}-${resName}(${res.current}/${res.max})`);
          }
        } else if (rec.startsWith('short:')) {
          const amt = parseInt(rec.split(':')[1], 10);
          if (!Number.isNaN(amt) && amt > 0 && res.current < res.max) {
            res.current = Math.min(res.max, res.current + amt);
            recoveredResources.push(`${m.name}-${resName}(${res.current}/${res.max})`);
          }
        }
      }
    }

    const resDetail = recoveredResources.length > 0 ? `，恢复短休特性: ${recoveredResources.join(', ')}` : '';
    state.status.round = 0;
    state.status.inCombat = false;
    state.status.turnIndex = 0;
    state.status.activeTurn = null;
    state.status.activeTurnId = null;
    appendLog(
      state,
      '短休完成',
      `休整 1 小时，重置短休可用特性与战斗轮次${hdDetail}${resDetail}`
    );
  }

  state.updatedAt = new Date().toISOString();
  return state;
}

export function applyRest(campaignName, restType = 'short', options = {}) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);

  // D 模式沙盒战役：显式识别 meta.mode === "D"，走阶段 0 双文件原子事务联动推进世界时间
  if (state.meta?.mode === 'D') {
    const sessionDir = path.dirname(getSessionPath(campaignName));
    const duration = restType === 'long' ? '8h' : '1h';
    const opId = options.opId || `rest-${restType}-${Date.now()}-${process.pid}`;

    const txRes = executeDualFileTx({
      sessionDir,
      opId,
      action: `rest:${restType}`,
      mutate: (curState, curWorld) => {
        ensurePartyStructure(curState);
        const nextState = mutateStateForRest(curState, restType, options);
        const timeRes = advanceWorldTimeWithTracks(curWorld, duration);
        return {
          nextState,
          nextWorld: timeRes.world,
          result: timeRes
        };
      },
      _simulateCrashAfterStateWrite: Boolean(options._simulateCrashAfterStateWrite),
      _simulateCrashBeforeUnlink: Boolean(options._simulateCrashBeforeUnlink)
    });

    ensurePartyStructure(txRes.state);
    return txRes.state;
  }

  // 非 D 模式（A/B/C 经典模式）：完全保持原有单文件行为不变
  mutateStateForRest(state, restType, options);
  return saveState(campaignName, state);
}

export function addEncounterMob(campaignName, options = {}) {
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }
  clearEphemeralDeltas(state);
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
  clearEphemeralDeltas(state);
  if (!state.status.encounter || !state.status.encounter.mobs || !state.status.encounter.mobs.length) {
    throw new Error(`当前战役 "${campaignName}" 无进行中的遭遇战敌方`);
  }

  const targetStr = String(target || '').trim().toLowerCase();
  if (!targetStr) {
    throw new Error('请指定受击目标名称或编号');
  }

  const val = parseIntStrict(damageOrHeal, 'damage', { min: -99999, max: 99999 });
  const mobs = state.status.encounter.mobs;

  // 1. Exact ID match
  let mob = mobs.find(m => m.id.toLowerCase() === targetStr && m.hp > 0) ||
            mobs.find(m => m.id.toLowerCase() === targetStr);

  // 2. Exact base name match (prefers first alive mob of that exact base name)
  if (!mob) {
    mob = mobs.find(m => m.name.toLowerCase() === targetStr && m.hp > 0) ||
          mobs.find(m => m.name.toLowerCase() === targetStr);
  }

  // 3. Partial substring match: check ambiguity across distinct alive mobs
  if (!mob) {
    const aliveSubstringMatches = mobs.filter(
      m => m.hp > 0 && (m.id.toLowerCase().includes(targetStr) || m.name.toLowerCase().includes(targetStr))
    );
    const distinctBaseNames = new Set(aliveSubstringMatches.map(m => m.name.toLowerCase()));
    if (distinctBaseNames.size > 1) {
      throw new Error(
        `目标 "${target}" 存在歧义，匹配到多个不同种类的存活目标: ${aliveSubstringMatches.map(m => m.id).join(', ')}。请指定明确编号！`
      );
    }
    mob = aliveSubstringMatches[0] ||
          mobs.find(m => m.id.toLowerCase().includes(targetStr) || m.name.toLowerCase().includes(targetStr));
  }

  if (!mob) {
    throw new Error(`未找到匹配的敌方目标: "${target}"`);
  }

  let logDetail = '';
  const prevHp = mob.hp;

  if (val >= 0) {
    mob.hp = Math.max(0, mob.hp - val);
    const actualLoss = prevHp - mob.hp;
    mob.lastDelta = `-${actualLoss}`;
    logDetail = `【${mob.id}】受到 ${val} 点伤害 (当前HP: ${mob.hp}/${mob.maxHp})`;
  } else {
    const heal = Math.abs(val);
    mob.hp = Math.min(mob.maxHp, mob.hp + heal);
    const actualHeal = mob.hp - prevHp;
    mob.lastDelta = `+${actualHeal}`;
    logDetail = `【${mob.id}】恢复 ${heal} 点生命 (当前HP: ${mob.hp}/${mob.maxHp})`;
  }

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
  clearEphemeralDeltas(state);

  if (state.status.encounter) {
    state.status.encounter.mobs = [];
    state.status.encounter.active = false;
  }
  state.status.round = 0;
  state.status.inCombat = false;
  state.status.turnIndex = 0;
  state.status.activeTurn = null;
  state.status.activeTurnId = null;

  appendLog(state, '遭遇战结束', '战场已清理，重置战斗轮次与敌方态势');

  return saveState(campaignName, state);
}

export function advanceTurn(campaignName) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);
  clearEphemeralDeltas(state);

  const allCombatants = [];
  let seq = 0;
  for (const m of state.party) {
    const conds = getMemberConditions(state, m);
    allCombatants.push({
      type: 'party',
      id: m.id || m.name,
      name: m.name,
      initiative: m.initiative ?? 10,
      alive: !conds.includes('死亡'),
      seq: seq++,
      ref: m,
      conditions: conds
    });
  }
  if (state.status.encounter?.mobs) {
    for (const mob of state.status.encounter.mobs) {
      allCombatants.push({
        type: 'mob',
        id: mob.id,
        name: mob.id,
        initiative: mob.initiative ?? 10,
        alive: mob.hp > 0,
        seq: seq++,
        ref: mob,
        conditions: mob.conditions
      });
    }
  }

  allCombatants.sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative;
    if (a.type !== b.type) return a.type === 'party' ? -1 : 1;
    return a.seq - b.seq;
  });

  const aliveCombatants = allCombatants.filter(c => c.alive);
  if (aliveCombatants.length === 0) {
    throw new Error('战场无存活参战单位，无法推进先攻回合');
  }

  const logs = [];
  const isFirstTurn = !state.status.inCombat || !state.status.round || !state.status.activeTurnId;
  let active = null;

  if (isFirstTurn) {
    const unsetMembers = state.party.filter(
      m => !getMemberConditions(state, m).includes('死亡') && (m.initiative === null || m.initiative === undefined)
    );
    if (unsetMembers.length > 0) {
      const warnMsg = `⚠️ 未设先攻警告: 队员【${unsetMembers.map(m => m.name).join('、')}】未设先攻值 (--init)，暂按默认 10 参战`;
      logs.push(warnMsg);
      state.status.initWarning = warnMsg;
    } else {
      delete state.status.initWarning;
    }
    state.status.inCombat = true;
    if (!state.status.round || state.status.round < 1) {
      state.status.round = 1;
    }
    active = aliveCombatants[0];
  } else {
    delete state.status.initWarning;
    const prevPos = allCombatants.findIndex(c => c.id === state.status.activeTurnId);
    if (prevPos !== -1) {
      for (let i = prevPos + 1; i < allCombatants.length; i++) {
        if (allCombatants[i].alive) {
          active = allCombatants[i];
          break;
        }
      }
      if (!active) {
        state.status.round += 1;
        logs.push(`进入第 ${state.status.round} 轮`);
        active = aliveCombatants[0];
      }
    } else {
      const prevInit = state.status.activeTurnInit ?? Infinity;
      active = aliveCombatants.find(c => c.initiative < prevInit) || null;
      if (!active) {
        state.status.round += 1;
        logs.push(`进入第 ${state.status.round} 轮`);
        active = aliveCombatants[0];
      }
    }
  }

  state.status.activeTurnId = active.id;
  state.status.activeTurnInit = active.initiative;
  state.status.activeTurn = active.name;
  state.status.turnIndex = aliveCombatants.findIndex(c => c.id === active.id);
  decrementTimedConditions(active.conditions, logs, active.name);
  logs.unshift(`轮到【${active.name}】行动 (先攻 ${active.initiative}，第 ${state.status.round} 轮)`);

  appendLog(state, '回合推进', logs.join('; '));
  return saveState(campaignName, state);
}

export function manageNotes(campaignName, options = {}) {
  const state = getState(campaignName);
  if (!state) throw new Error(`未找到战役 "${campaignName}"`);

  const cat = String(options.cat || 'fact').trim().toLowerCase();
  if (!NOTE_CATEGORIES.includes(cat)) {
    throw new Error(`无效的笔记分类: "${cat}" (支持: ${NOTE_CATEGORIES.join(', ')})`);
  }

  if (options.add) {
    const text = String(options.add).trim();
    if (text && !state.notes[cat].includes(text)) {
      state.notes[cat].push(text);
      appendLog(state, '记录战役笔记', `[${cat}] ${text}`);
      saveState(campaignName, state);
    }
  } else if (options.remove) {
    const text = String(options.remove).trim();
    const idx = state.notes[cat].findIndex(item => item === text || item.includes(text));
    if (idx !== -1) {
      const removed = state.notes[cat].splice(idx, 1)[0];
      appendLog(state, '移除战役笔记', `[${cat}] ${removed}`);
      saveState(campaignName, state);
    }
  }

  return state;
}

export function promoteCharacter(campaignName, options = {}) {
  const state = getState(campaignName);
  if (!state) {
    throw new Error(`未找到战役 "${campaignName}"。请先运行 init 初始化。`);
  }
  clearEphemeralDeltas(state);
  const member = resolvePartyMember(state, options.who);
  if (member.level !== 0) {
    throw new Error(`promote 命令仅支持从 0 级晋升到 1 级（0→1，当前等级: Lv.${member.level}）`);
  }

  const newClass = options.class || (member.class && member.class !== '平民' ? member.class : '战士');
  const rawDie = options.hitDie ? String(options.hitDie).trim().toLowerCase() : null;
  const hitDie = (rawDie && /^d\d+$/.test(rawDie) ? rawDie : null) || inferHitDie(newClass);
  const hitDieMax = parseInt(hitDie.slice(1), 10) || 10;
  const conMod = options.con !== undefined
    ? parseIntStrict(options.con, 'con', { min: -5, max: 10 })
    : (typeof member.conMod === 'number' ? member.conMod : 2);
  const maxHp = options.hp !== undefined
    ? parseIntStrict(options.hp, 'hp', { min: 1, max: 9999 })
    : Math.max(1, hitDieMax + conMod);

  member.level = 1;
  member.class = newClass;
  member.conMod = conMod;
  const prevHp = member.hp.current;
  member.hp.max = maxHp;
  member.hp.current = maxHp;
  member.hp.lastDelta = `+${Math.max(0, maxHp - prevHp)} 晋升Lv1`;
  member.hitDice = {
    total: 1,
    current: 1,
    remaining: 1,
    die: hitDie
  };

  if (options.ac !== undefined) {
    member.ac = parseIntStrict(options.ac, 'ac', { min: 1, max: 99 });
  } else if (member.ac <= 10) {
    member.ac = 14;
  }

  if (options.speed !== undefined) {
    member.speed = parseIntStrict(options.speed, 'speed', { min: 0, max: 300 });
  }

  if (options.slots !== undefined) {
    member.spellSlots = parseSlots(options.slots);
  }

  if (!member.resources || typeof member.resources !== 'object') {
    member.resources = {};
  }
  if (newClass === '战士' && !member.resources['回气']) {
    member.resources['回气'] = { current: 2, max: 2, recovery: 'short', recoverAmount: 1 };
  } else if (newClass === '圣武士' && !member.resources['圣疗']) {
    member.resources['圣疗'] = { current: 5, max: 5, recovery: 'long', recoverAmount: 5 };
  } else if (newClass === '野蛮人' && !member.resources['狂暴']) {
    member.resources['狂暴'] = { current: 2, max: 2, recovery: 'short', recoverAmount: 1 };
  } else if (newClass === '吟游诗人' && !member.resources['吟游诗人激励']) {
    member.resources['吟游诗人激励'] = { current: 3, max: 3, recovery: 'long', recoverAmount: 3 };
  }

  if (options.setResource !== undefined) {
    const specs = Array.isArray(options.setResource) ? options.setResource : [options.setResource];
    for (const spec of specs) {
      const { name, resource } = parseResourceSpec(spec);
      member.resources[name] = resource;
    }
  }

  const logs = [];
  syncHpConditionsForMember(state, member, logs);
  appendLog(state, '序章晋升', `【${member.name}】从 Lv0 晋升为 Lv1 ${member.class} (HP ${member.hp.current}/${member.hp.max}, AC ${member.ac}, 生命骰 1${hitDie})`);
  return saveState(campaignName, state);
}

export function calculateEncounterDifficulty({ partyLevels = [1], monsterCrs = [] } = {}) {
  if (!Array.isArray(partyLevels) || partyLevels.length === 0) {
    throw new Error('partyLevels 必须是非空等级数组');
  }
  const budgets = { low: 0, moderate: 0, high: 0 };
  for (const rawLvl of partyLevels) {
    const lvl = parseIntStrict(rawLvl, '角色等级', { min: 0, max: 20 });
    const row = XP_BUDGET_BY_LEVEL[lvl];
    budgets.low += row.low;
    budgets.moderate += row.moderate;
    budgets.high += row.high;
  }

  let totalMonsterXp = 0;
  const parsedCrs = [];
  for (const rawCr of monsterCrs) {
    const key = String(rawCr).trim();
    if (!(key in CR_XP_MAP)) {
      throw new Error(`未知的怪物挑战等级 (CR): "${rawCr}"`);
    }
    totalMonsterXp += CR_XP_MAP[key];
    parsedCrs.push(key);
  }

  let difficulty = '简单 (Low)';
  if (totalMonsterXp > budgets.high) {
    difficulty = '致命 (Deadly)';
  } else if (totalMonsterXp > budgets.moderate) {
    difficulty = '困难 (High)';
  } else if (totalMonsterXp > budgets.low) {
    difficulty = '中等 (Moderate)';
  }

  const warnings = [];
  if (partyLevels.length === 1 && parsedCrs.length >= 3) {
    warnings.push('⚠️ 单人行动经济警告：1 名 PC 同时面对 3 名以上敌人极易被集火击倒，强烈建议加入随从 (Sidekick) 或分波次接敌！');
  } else if (parsedCrs.length >= partyLevels.length * 2 && parsedCrs.length >= 4) {
    warnings.push('⚠️ 敌众我寡警告：敌方单位数量达到小队人数的 2 倍以上，注意敌方先攻集火风险。');
  }

  return {
    partySize: partyLevels.length,
    partyLevels: partyLevels.map(Number),
    monsterCount: parsedCrs.length,
    monsterCrs: parsedCrs,
    totalMonsterXp,
    thresholds: budgets,
    difficulty,
    warnings
  };
}

function getVeilHpLabel(hp, maxHp) {
  if (hp <= 0) return '阵亡';
  if (hp >= maxHp) return '完好';
  if (hp > Math.floor(maxHp / 2)) return '轻伤';
  if (hp > Math.floor(maxHp / 4)) return '浴血';
  return '濒死';
}

function formatMemberResourcesCompact(char) {
  const parts = [];
  if (char.spellSlots) {
    for (const [lvl, s] of Object.entries(char.spellSlots)) {
      if (s && s.max > 0) {
        parts.push(`${lvl}环:${s.current}/${s.max}${s.lastDelta ? `(${s.lastDelta})` : ''}`);
      }
    }
  }
  if (char.resources) {
    for (const [name, r] of Object.entries(char.resources)) {
      if (r && r.max > 0) {
        parts.push(`${name}:${r.current}/${r.max}${r.lastDelta ? `(${r.lastDelta})` : ''}`);
      }
    }
  }
  return parts.length > 0 ? ` | ⚡${parts.join(' ')}` : '';
}

function formatSingleMemberLine(state, char) {
  const hp = char.hp;
  const conditions = getMemberConditions(state, char);
  const deltaStr = hp.lastDelta ? ` (${hp.lastDelta})` : '';
  const tempStr = hp.temp > 0 ? ` (+${hp.temp}临时)` : '';
  const isBloodied = hp.current <= Math.floor(hp.max / 2) && hp.current > 0;
  const bloodied = isBloodied ? ' [浴血]' : '';
  const inspStr = char.heroicInspiration ? ' [激励●]' : '';
  const concStr = char.concentration ? ` [专注:${char.concentration}${char.concentrationCheckDc ? ` ⚠️DC${char.concentrationCheckDc}` : ''}]` : '';
  const ds = char.deathSaves || { successes: 0, failures: 0 };
  const dsStr = (hp.current === 0 || ds.successes > 0 || ds.failures > 0)
    ? ` | 💀死亡豁免: 成${ds.successes}/败${ds.failures}`
    : '';
  const resStr = formatMemberResourcesCompact(char);
  const displayConditions = conditions.filter(c => !(isBloodied && c === '浴血'));
  const conds = displayConditions.length > 0 ? ` [状态: ${displayConditions.join(', ')}]` : '';

  return `[🩸${char.name}(Lv${char.level} ${char.class}) HP: ${hp.current}/${hp.max}${deltaStr}${tempStr}${bloodied} | 🛡️AC: ${char.ac}${inspStr}${concStr}${resStr}${dsStr}${conds}]`;
}

export function generateHud(state, mode = 'line', hudOptions = {}) {
  ensurePartyStructure(state);
  const veil = Boolean(hudOptions.veil);
  const char = state.character;

  let mobsLine = '';
  if (state.status.encounter && state.status.encounter.mobs && state.status.encounter.mobs.length > 0) {
    const mobList = state.status.encounter.mobs.map(m => {
      const condStr = m.conditions.length > 0 ? ` [${m.conditions.join(',')}]` : '';
      if (veil) {
        return `${m.id}(${getVeilHpLabel(m.hp, m.maxHp)}${condStr})`;
      }
      const deltaStr = m.lastDelta ? `(${m.lastDelta})` : '';
      return `${m.id}(${m.hp}/${m.maxHp}${deltaStr}${condStr})`;
    }).join(', ');
    mobsLine = `\n👾 敌方态势: [${mobList}]`;
  }

  const wealthLabel = state.meta?.mode === 'D' && typeof state.inventory?.copper === 'number'
    ? formatCopper(state.inventory.copper)
    : `${state.inventory.gold}gp`;

  if (mode === 'line') {
    const partySegments = state.party.map(m => formatSingleMemberLine(state, m)).join(' ');
    return `-----------------------------------------------------------------------------------------
📊 队伍状态: ${partySegments} | 🎒剩余金币: ${wealthLabel} | 📍${state.status.location}${mobsLine}
-----------------------------------------------------------------------------------------`;
  }

  // Combat Dashboard mode
  const hp = char.hp;
  const deltaStr = hp.lastDelta ? ` (${hp.lastDelta})` : '';
  const tempStr = hp.temp > 0 ? ` (+${hp.temp}临时)` : '';
  const isBloodied = hp.current <= Math.floor(hp.max / 2) && hp.current > 0;
  const bloodied = isBloodied ? ' [浴血]' : '';
  const concStr = char.concentration ? ` | 🎯专注: 【${char.concentration}】${char.concentrationCheckDc ? `(⚠️需检定 DC ${char.concentrationCheckDc})` : ''}` : '';
  const ds = char.deathSaves || { successes: 0, failures: 0 };
  const dsStr = (hp.current === 0 || ds.successes > 0 || ds.failures > 0)
    ? ` | 💀 死亡豁免: 成${ds.successes}/败${ds.failures}`
    : '';
  const displayConditions = state.status.conditions.filter(c => !(isBloodied && c === '浴血'));
  const conds = displayConditions.length > 0 ? ` [状态: ${displayConditions.join(', ')}]` : '';

  const slotsAndResParts = [];
  for (const [lvl, s] of Object.entries(char.spellSlots || {})) {
    if (s.max > 0) {
      slotsAndResParts.push(`${lvl}环: [${'●'.repeat(s.current)}${'○'.repeat(s.max - s.current)}]${s.lastDelta ? ` (${s.lastDelta})` : ''}`);
    }
  }
  for (const [resName, r] of Object.entries(char.resources || {})) {
    if (r.max > 0) {
      slotsAndResParts.push(`${resName}: [${'●'.repeat(r.current)}${'○'.repeat(r.max - r.current)}]${r.lastDelta ? ` (${r.lastDelta})` : ''}`);
    }
  }

  let companionsLine = '';
  if (state.party.length > 1) {
    const others = state.party.slice(1).map(m => formatSingleMemberLine(state, m)).join('\n  ');
    companionsLine = `\n[同行队友]:\n  ${others}`;
  }

  let mobsDashboard = '';
  if (state.status.encounter && state.status.encounter.mobs && state.status.encounter.mobs.length > 0) {
    const lines = state.status.encounter.mobs.map(m => {
      const condStr = m.conditions.length > 0 ? ` [${m.conditions.join(', ')}]` : '';
      const initStr = m.initiative !== null ? ` | 先攻 ${m.initiative}` : '';
      if (veil) {
        return `  • ${m.id}: 🩸 状态【${getVeilHpLabel(m.hp, m.maxHp)}】${initStr}${condStr}`;
      }
      const deltaStrM = m.lastDelta ? ` (${m.lastDelta})` : '';
      return `  • ${m.id}: 🩸 HP ${m.hp}/${m.maxHp}${deltaStrM} | 🛡️ AC ${m.ac}${initStr}${condStr}`;
    }).join('\n');
    mobsDashboard = `\n[敌方战斗目标]:\n${lines}`;
  }

  const activeTurnLabel = state.status.activeTurn || `${char.name} (${char.class} Lv${char.level})`;

  return `====================================== 角色行动仪表盘 ======================================
[当前先攻者]: ${activeTurnLabel} | 战斗第 ${state.status.round || 1} 轮
[生命状态]: 🩸 HP: ${hp.current}/${hp.max}${deltaStr}${tempStr}${bloodied} | 🛡️ 基础 AC: ${char.ac}${concStr}${dsStr}${conds}
[法术与职业资源]: ${slotsAndResParts.join(' | ') || '无常驻充能资源'}
[金币与物资]: 💰 ${wealthLabel} | 🎒 ${state.inventory.items.map(i => `${i.name}x${i.count}`).join(', ')}
[当前位置与目标]: 📍 ${state.status.location} | 🎯 ${state.status.quest}${companionsLine}${mobsDashboard}
==========================================================================================`;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}⚔️ D&D 战役状态持久化管理器 (Session State Manager)${colors.reset}

${colors.yellow}指令:${colors.reset}
  init <campaign> [options]       初始化新战役状态文件 (支持 --preset valen,bran)
  add-member <campaign> [options] 向小队添加预设或自定义队友/随从 (--preset bran)
  show <campaign> [options]       显示战役当前状态 (支持 --hud, --json, --veil)
  update <campaign> [options]     实时更新生命、法术位、职业资源、专注、金币、物品与状态
  rest <campaign> <--short|--long> [--dice <N>] [--con <mod>] 执行短休或长休恢复
  next <campaign>                 推进战斗先攻指针，自动递增轮次并递减带轮次状态 (如 中毒:2)
  mob-add <campaign> [options]    遭遇战加入敌方怪物 (--name <名> --hp <血> --ac <甲> --count <数> --init <先攻>)
  mob-hit <campaign> [options]    扣减或恢复敌方生命 (--target <目标名/编号> --damage <伤害值>)
  mob-clear <campaign>            遭遇战结束，清理战场所有怪物与轮次
  note <campaign> [options]       管理战役结构化笔记 (--cat npc|location|clue|quest|fact --add/--remove/--list)
  encounter-calc [options]        遭遇战 XP 预算与难度计算器 (--party 1,1 --crs 1/4,1/4)

${colors.yellow}初始化与小队选项 (init / add-member):${colors.reset}
  --preset <id[,id2]>   从 presets.json 加载预设角色 (如: valen, lyra, alistair, vondal, theron, cassandra, bran)
  --name <name>         角色名 (默认: 冒险者)
  --class <class>       职业 (默认: 战士，自动推导对应生命骰 d6~d12)
  --level <level>       等级 (默认: 1)
  --hp <maxHp>          最大生命值 (默认: 12)
  --ac <ac>             防御等级 (默认: 16)
  --speed <ft>          移动速度 (默认: 30，木精灵/歌利亚自动 35)
  --hit-die <dN>        显式指定生命骰 (如: d8, d10, d12)
  --slots <1:2,2:1>     初始法术位 (环阶:数量)
  --gold <gp>           初始金币 (默认: 15)
  --mode <D>            可选：指定 D 模式沙盒战役 (写入 meta.mode="D" 与 inventory.copper)
  --force               若战役已存在则强制覆盖

${colors.yellow}更新选项 (update):${colors.reset}
  --who <name/id>       指定要更新的小队成员名称或 ID (默认为主控角色)
  --hp <+/-N | N>       增减或设定当前 HP (含临时HP抵扣、巨额溢伤即死、0HP受击豁免失败、已死亡禁疗锁)
  --revive              配合 --hp 将已死亡角色复活
  --reason <text>       HP 变动原因注记 (如: "狼爪")
  --temp-hp <N>         设定临时生命值 (不叠加取高值，传 0 清零)
  --max-hp <N>          调整最大生命上限
  --ac <N>              调整防御等级 AC
  --speed <N>           调整移动速度
  --init <N>            设定角色先攻值
  --death-save <type>   记录死亡豁免 (success | fail | crit-success | crit-fail | reset)
  --inspiration <1|0>   增减英雄激励
  --concentrate <spell> 开始专注维持某法术 (受击时自动计算 DC=max(10, floor(dmg/2)) 豁免提示)
  --break-concentration 中断当前法术专注
  --slot <level> <+/-N> 消耗或恢复对应环阶法术位
  --slots <1:2,2:1>     更新角色法术位配置
  --set-resource <spec> 配置职业资源 (如: "引导神力:2/2:short:1")
  --use-resource <name> [+/-N] 消耗或恢复职业资源 (默认 -1，如: --use-resource 回气)
  --gold <+/-N | N>     增减或设定金币数量
  --add-item <name>     增加背包物品
  --remove-item <name>  移除或消耗背包物品
  --add-condition <c>   附加异常状态 (支持带持续轮数，如: 中毒:2, 恐慌:1)
  --remove-condition <c>解除异常状态
  --location <text>     更新当前地图与位置
  --quest <text>        更新当前主线/剧情目标
  --round <+/-N | N>    更新战斗轮次计数
`);
}

export function parseCliArgs(args) {
  const expanded = [];
  for (const rawArg of args) {
    if (rawArg.startsWith('--') && rawArg.includes('=')) {
      const eqIdx = rawArg.indexOf('=');
      expanded.push(rawArg.slice(0, eqIdx), rawArg.slice(eqIdx + 1));
    } else {
      expanded.push(rawArg);
    }
  }

  const command = expanded[0];
  let campaign = null;
  let startIdx = 1;
  if (expanded[1] && !expanded[1].startsWith('-')) {
    campaign = expanded[1];
    startIdx = 2;
  }

  const options = {};
  const requireVal = (idx, flagName) => {
    if (idx + 1 >= expanded.length) {
      throw new Error(`参数 ${flagName} 缺少对应的值`);
    }
    return expanded[idx + 1];
  };

  for (let i = startIdx; i < expanded.length; i++) {
    const arg = expanded[i];
    if (arg === '--hud') options.hud = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--veil') options.veil = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--short') options.short = true;
    else if (arg === '--long') options.long = true;
    else if (arg === '--crit') options.crit = true;
    else if (arg === '--revive') options.revive = true;
    else if (arg === '--break-concentration') options.breakConcentration = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--mode') options.mode = requireVal(i++, '--mode');
    else if (arg === '--copper') options.copper = requireVal(i++, '--copper');
    else if (arg === '--op-id') options.opId = requireVal(i++, '--op-id');
    else if (arg === '--preset') options.preset = requireVal(i++, '--preset');
    else if (arg === '--who') options.who = requireVal(i++, '--who');
    else if (arg === '--name') options.name = requireVal(i++, '--name');
    else if (arg === '--class') options.class = requireVal(i++, '--class');
    else if (arg === '--race' || arg === '--species') options.species = requireVal(i++, arg);
    else if (arg === '--level') options.level = requireVal(i++, '--level');
    else if (arg === '--hp') options.hp = requireVal(i++, '--hp');
    else if (arg === '--reason') options.reason = requireVal(i++, '--reason');
    else if (arg === '--temp-hp') options.tempHp = requireVal(i++, '--temp-hp');
    else if (arg === '--max-hp') options.maxHp = requireVal(i++, '--max-hp');
    else if (arg === '--ac') options.ac = requireVal(i++, '--ac');
    else if (arg === '--speed') options.speed = requireVal(i++, '--speed');
    else if (arg === '--hit-die') options.hitDie = requireVal(i++, '--hit-die');
    else if (arg === '--death-save') options.deathSave = requireVal(i++, '--death-save');
    else if (arg === '--dice' || arg === '--hit-dice') options.dice = requireVal(i++, arg);
    else if (arg === '--con') options.con = requireVal(i++, '--con');
    else if (arg === '--heal') options.heal = requireVal(i++, '--heal');
    else if (arg === '--inspiration') options.inspiration = requireVal(i++, '--inspiration');
    else if (arg === '--concentrate') options.concentrate = requireVal(i++, '--concentrate');
    else if (arg === '--slot') {
      options.slotLevel = requireVal(i++, '--slot');
      options.slotChange = requireVal(i++, '--slot <level>');
    } else if (arg === '--slots') options.slots = requireVal(i++, '--slots');
    else if (arg === '--set-resource') {
      const val = requireVal(i++, '--set-resource');
      if (!options.setResource) options.setResource = [];
      options.setResource.push(val);
    } else if (arg === '--use-resource') {
      options.useResource = requireVal(i++, '--use-resource');
      if (i + 1 < expanded.length && /^[+-]?\d+$/.test(expanded[i + 1])) {
        options.resourceDelta = expanded[++i];
      }
    } else if (arg === '--gold') options.gold = requireVal(i++, '--gold');
    else if (arg === '--add-item') options.addItem = requireVal(i++, '--add-item');
    else if (arg === '--remove-item') options.removeItem = requireVal(i++, '--remove-item');
    else if (arg === '--add-condition') options.addCondition = requireVal(i++, '--add-condition');
    else if (arg === '--remove-condition') options.removeCondition = requireVal(i++, '--remove-condition');
    else if (arg === '--location') options.location = requireVal(i++, '--location');
    else if (arg === '--quest') options.quest = requireVal(i++, '--quest');
    else if (arg === '--round') options.round = requireVal(i++, '--round');
    else if (arg === '--target') options.target = requireVal(i++, '--target');
    else if (arg === '--damage') options.damage = requireVal(i++, '--damage');
    else if (arg === '--count') options.count = requireVal(i++, '--count');
    else if (arg === '--init') options.init = requireVal(i++, '--init');
    else if (arg === '--cat') options.cat = requireVal(i++, '--cat');
    else if (arg === '--add') options.add = requireVal(i++, '--add');
    else if (arg === '--remove') options.remove = requireVal(i++, '--remove');
    else if (arg === '--party') options.party = requireVal(i++, '--party');
    else if (arg === '--crs') options.crs = requireVal(i++, '--crs');
    else {
      throw new Error(`未知的命令行选项或参数: "${arg}"`);
    }
  }

  return { command, campaign, options };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (err) {
    console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
    process.exit(1);
  }

  const { command, campaign, options } = parsed;

  try {
    if (command === 'encounter-calc') {
      let partyLevels = [1];
      if (options.party) {
        partyLevels = String(options.party).split(',').map(s => s.trim()).filter(Boolean).map(Number);
      } else if (campaign) {
        const st = getState(campaign);
        if (st && Array.isArray(st.party)) {
          partyLevels = st.party.map(p => p.level || 1);
        }
      }
      const monsterCrs = options.crs
        ? String(options.crs).split(',').map(s => s.trim()).filter(Boolean)
        : [];
      const res = calculateEncounterDifficulty({ partyLevels, monsterCrs });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`⚖️ 遭遇战难度评估: 【${res.difficulty}】`);
        console.log(`  小队规模: ${res.partySize} 人 (等级: ${res.partyLevels.join(', ')}) | 预算阈值: 简单 ${res.thresholds.low} / 中等 ${res.thresholds.moderate} / 困难 ${res.thresholds.high} XP`);
        console.log(`  敌方阵容: ${res.monsterCount} 只 (CR: ${res.monsterCrs.join(', ')}) | 怪物总 XP: ${res.totalMonsterXp} XP`);
        for (const w of res.warnings) {
          console.log(`  ${w}`);
        }
      }
      return;
    }

    if (!campaign) {
      console.error(`${colors.red}错误: 请指定战役名称 (例如: goblin-cave)${colors.reset}`);
      process.exit(1);
    }

    if (command === 'init') {
      const state = initSession(campaign, options);
      const sessionPath = getSessionPath(campaign);
      console.log(`${colors.green}✓ 战役 "${campaign}" 状态初始化成功！${colors.reset}`);
      console.log(`${colors.dim}存档路径: ${sessionPath}${colors.reset}`);
      if (isSessionOnSystemDrive(sessionPath)) {
        console.log(`${colors.dim}[提示] 当前存档位于系统盘，重装系统可能丢失进度；可设置环境变量 DND_SESSIONS_DIR 将存档迁移至非系统盘（详见 README.md“便携部署”）。${colors.reset}`);
      }
      console.log('');
      console.log(generateHud(state, 'line', { veil: options.veil }));
    } else if (command === 'add-member') {
      const state = addPartyMember(campaign, options);
      console.log(`${colors.green}✓ 新队友已加入战役 "${campaign}"！${colors.reset}\n`);
      console.log(generateHud(state, 'line', { veil: options.veil }));
    } else if (command === 'show') {
      const state = getState(campaign);
      if (!state) {
        console.error(`${colors.red}未找到战役 "${campaign}"。请先运行: node scripts/state.js init ${campaign}${colors.reset}`);
        process.exit(1);
      }
      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
      } else if (options.hud) {
        console.log(generateHud(state, state.status.inCombat ? 'combat' : 'line', { veil: options.veil }));
      } else {
        console.log(generateHud(state, 'combat', { veil: options.veil }));
      }
    } else if (command === 'update') {
      const state = updateState(campaign, options);
      console.log(`${colors.green}✓ 战役 "${campaign}" 状态已更新！${colors.reset}\n`);
      console.log(generateHud(state, state.status.inCombat ? 'combat' : 'line', { veil: options.veil }));
    } else if (command === 'rest') {
      const restType = options.long ? 'long' : 'short';
      const state = applyRest(campaign, restType, options);
      console.log(`${colors.green}✓ 战役 "${campaign}" 完成${restType === 'long' ? '长休' : '短休'}！${colors.reset}\n`);
      console.log(generateHud(state, 'line', { veil: options.veil }));
    } else if (command === 'next') {
      const state = advanceTurn(campaign);
      if (state.status.initWarning) {
        console.log(`${colors.yellow}${state.status.initWarning}${colors.reset}`);
      }
      console.log(`${colors.green}✓ 先攻回合已推进 -> 当前行动者: 【${state.status.activeTurn}】(第 ${state.status.round} 轮)${colors.reset}\n`);
      console.log(generateHud(state, 'combat', { veil: options.veil }));
    } else if (command === 'mob-add') {
      const state = addEncounterMob(campaign, options);
      console.log(`${colors.green}✓ 遭遇战怪物已加入 "${campaign}"！${colors.reset}\n`);
      console.log(generateHud(state, 'combat', { veil: options.veil }));
    } else if (command === 'mob-hit') {
      const target = options.target || options.name;
      const dmg = options.damage !== undefined ? options.damage : (options.hp !== undefined ? options.hp : 0);
      if (!target) {
        console.error(`${colors.red}错误: 请通过 --target 指定受击目标 (例如: --target "地精武者-1")${colors.reset}`);
        process.exit(1);
      }
      const state = damageEncounterMob(campaign, target, dmg);
      console.log(`${colors.green}✓ 目标 "${target}" 结算完成！${colors.reset}\n`);
      console.log(generateHud(state, 'combat', { veil: options.veil }));
    } else if (command === 'mob-clear') {
      const state = clearEncounter(campaign);
      console.log(`${colors.green}✓ 战役 "${campaign}" 遭遇战已清空，退出战斗轮！${colors.reset}\n`);
      console.log(generateHud(state, 'line', { veil: options.veil }));
    } else if (command === 'note') {
      const state = manageNotes(campaign, options);
      if (options.json) {
        console.log(JSON.stringify(state.notes, null, 2));
      } else {
        console.log(`📓 战役 "${campaign}" 笔记簿:`);
        const cats = options.cat ? [options.cat.toLowerCase()] : NOTE_CATEGORIES;
        for (const c of cats) {
          const items = state.notes[c] || [];
          console.log(`  [${c.toUpperCase()}] (${items.length}): ${items.length ? items.join(' | ') : '暂无记录'}`);
        }
      }
    } else if (command === 'promote') {
      const state = promoteCharacter(campaign, options);
      console.log(`${colors.green}✓ 角色已成功从 Lv0 晋升为 Lv1 ${state.character.class}！${colors.reset}\n`);
      console.log(generateHud(state, 'line', { veil: options.veil }));
    } else {
      console.error(`${colors.red}未知指令: "${command}"。请使用 init, add-member, show, update, rest, next, mob-add, mob-hit, mob-clear, note, promote, 或 encounter-calc。${colors.reset}`);
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
