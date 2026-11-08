import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const WORLD_SCHEMA_VERSION = 1;
export const JIANHUO_WORLD_ID = 'jianhuo';

export const PERIOD_NAMES = Object.freeze(['深夜', '黎明', '上午', '下午', '黄昏', '夜']);
export const CADENCE_HOURS = Object.freeze({
  day: 24,
  tenday: 240,
  month: 720,
  season: 2160,
  year: 8640
});
export const MAX_ADVANCE_HOURS = 8640; // 首版单次推进上限：1 年（360 天）

export const TIER_LEVELS = Object.freeze(['凡俗', '文明', '超凡', '异界', '诸界']);
export const LEDGER_TYPES = Object.freeze(['机会', '线索', '承诺', '债', '仇怨', '秘密', '余波']);
export const LEDGER_STATUSES = Object.freeze(['未动', '推进中', '搁置', '了结']);
export const DEBT_KINDS = Object.freeze(['契约', '人情', '神恩']);
export const CANON_STATUSES = Object.freeze(['定论', '传说', '候选真相']);
export const CANON_SOURCES = Object.freeze(['设定切片', '玩家行动', '生成', '玩家提出']);
export const VISIBILITY_LEVELS = Object.freeze(['public', 'rumor', 'secret']);
export const CLOCK_KINDS = Object.freeze(['threat', 'track', 'faction', 'npc']);
export const CLOCK_STATUSES = Object.freeze(['active', 'completed', 'paused', 'cancelled']);
export const INTENSITY_LEVELS = Object.freeze(['slow', 'standard', 'fast']);

export const STATE_FORBIDDEN_KEYS = Object.freeze([
  'calendar',
  'clocks',
  'canon',
  'ledger',
  'rumors',
  'factions',
  'rng'
]);

export const WORLD_FORBIDDEN_KEYS = Object.freeze([
  'party',
  'combat',
  'mobs',
  'inventory',
  'spellSlots',
  'resources'
]);

const MAX_COMPLETED_OP_IDS = 128;
const TERMINAL_VALUES = new Set(['灭亡', '已灭亡', '毁灭', '已毁灭', '死亡', '已死亡', '覆灭', '崩塌']);

function assertNonNegativeSafeInt(val, label) {
  if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 0) {
    throw new Error(`${label} 必须为非负整数，实际收到: ${String(val)}`);
  }
}

// ============================================================================
// 一、货币记账契约（D 模式底层统一按整数铜币 cp 记账，1 gp = 10 sp = 100 cp）
// ============================================================================

export function coinsToCopper({ gp = 0, sp = 0, cp = 0 } = {}) {
  assertNonNegativeSafeInt(gp, 'gp');
  assertNonNegativeSafeInt(sp, 'sp');
  assertNonNegativeSafeInt(cp, 'cp');
  const total = gp * 100 + sp * 10 + cp;
  assertNonNegativeSafeInt(total, 'copper');
  return total;
}

export function copperToCoins(copper) {
  assertNonNegativeSafeInt(copper, 'copper');
  const gp = Math.floor(copper / 100);
  const rem = copper % 100;
  const sp = Math.floor(rem / 10);
  const cp = rem % 10;
  return { gp, sp, cp };
}

export function formatCopper(copper) {
  const { gp, sp, cp } = copperToCoins(copper);
  const parts = [];
  if (gp > 0) parts.push(`${gp}gp`);
  if (sp > 0) parts.push(`${sp}sp`);
  if (cp > 0 || parts.length === 0) parts.push(`${cp}cp`);
  return parts.join(' ');
}

// ============================================================================
// 二、历法、可复现随机源与时钟边界结算契约
// ============================================================================

export function validateCalendarObj(cal) {
  if (!cal || typeof cal !== 'object') {
    throw new Error('calendar 必须为对象');
  }
  if (typeof cal.era !== 'string' || !cal.era.trim()) {
    throw new Error('calendar.era 必须为非空纪元字符串');
  }
  if (!Number.isSafeInteger(cal.year) || cal.year < 1) {
    throw new Error(`calendar.year 必须为 >= 1 的整数，实际: ${cal.year}`);
  }
  if (!Number.isSafeInteger(cal.month) || cal.month < 1 || cal.month > 12) {
    throw new Error(`calendar.month 必须在 1..12 之间，实际: ${cal.month}`);
  }
  if (!Number.isSafeInteger(cal.day) || cal.day < 1 || cal.day > 30) {
    throw new Error(`calendar.day 必须在 1..30 之间，实际: ${cal.day}`);
  }
  if (!Number.isSafeInteger(cal.hour) || cal.hour < 0 || cal.hour > 23) {
    throw new Error(`calendar.hour 必须在 0..23 之间，实际: ${cal.hour}`);
  }
  return true;
}

export function getDayPeriod(hour) {
  if (!Number.isSafeInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`hour 必须在 0..23 之间，实际: ${hour}`);
  }
  return PERIOD_NAMES[Math.floor(hour / 4)];
}

export function formatTimestamp(cal) {
  const obj = typeof cal === 'string' ? parseTimestamp(cal) : cal;
  if (!Number.isSafeInteger(obj?.year) || obj.year < 1) {
    throw new Error(`无效时间戳年份: ${JSON.stringify(cal)}`);
  }
  if (!Number.isSafeInteger(obj.month) || obj.month < 1 || obj.month > 12) {
    throw new Error(`无效时间戳月份: ${JSON.stringify(cal)}`);
  }
  if (!Number.isSafeInteger(obj.day) || obj.day < 1 || obj.day > 30) {
    throw new Error(`无效时间戳日期: ${JSON.stringify(cal)}`);
  }
  if (!Number.isSafeInteger(obj.hour) || obj.hour < 0 || obj.hour > 23) {
    throw new Error(`无效时间戳小时: ${JSON.stringify(cal)}`);
  }
  const y = String(obj.year).padStart(4, '0');
  const m = String(obj.month).padStart(2, '0');
  const d = String(obj.day).padStart(2, '0');
  const h = String(obj.hour).padStart(2, '0');
  return `Y${y}-M${m}-D${d}T${h}`;
}

export function parseTimestamp(tsStr, era = '剑火纪') {
  if (typeof tsStr !== 'string') {
    throw new Error(`时间戳必须为字符串，实际: ${typeof tsStr}`);
  }
  const match = tsStr.trim().match(/^Y(\d{4,})-M(\d{2})-D(\d{2})T(\d{2})$/);
  if (!match) {
    throw new Error(`时间戳格式非法（应为 Y0142-M01-D01T08）: ${tsStr}`);
  }
  const cal = {
    era,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4])
  };
  validateCalendarObj(cal);
  return cal;
}

export function toTotalHours(calOrStr) {
  const cal = typeof calOrStr === 'string' ? parseTimestamp(calOrStr) : calOrStr;
  validateCalendarObj({ era: cal?.era || '剑火纪', ...cal });
  return (((cal.year - 1) * 360) + ((cal.month - 1) * 30) + (cal.day - 1)) * 24 + cal.hour;
}

export function fromTotalHours(totalHours, era = '剑火纪') {
  assertNonNegativeSafeInt(totalHours, 'totalHours');
  const hour = totalHours % 24;
  const totalDays = Math.floor(totalHours / 24);
  const day = (totalDays % 30) + 1;
  const totalMonths = Math.floor(totalDays / 30);
  const month = (totalMonths % 12) + 1;
  const year = Math.floor(totalMonths / 12) + 1;
  return { era, year, month, day, hour };
}

export function parseDurationHours(spec) {
  if (typeof spec === 'number') {
    if (!Number.isSafeInteger(spec) || spec <= 0) {
      throw new Error(`推进时长必须为大于 0 的正整数小时，实际: ${spec}`);
    }
    if (spec > MAX_ADVANCE_HOURS) {
      throw new Error(`首版 --advance 单次推进上限为 1 年 (8640h)，实际请求: ${spec}h`);
    }
    return spec;
  }
  if (typeof spec !== 'string' || !spec.trim()) {
    throw new Error('推进时长不能为空');
  }
  const match = spec.trim().match(/^([+-]?\d+)\s*(h|hr|hour|hours|时|小时|d|day|days|天|日|tenday|旬|m|mon|month|months|月|s|season|seasons|季|y|yr|year|years|年)$/i);
  if (!match) {
    throw new Error(`无法解析推进时长 "${spec}"（支持示例: 1h, 8h, 1d, 1tenday, 1m, 1season, 1y）`);
  }
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`推进时长数值必须为大于 0 的正整数，实际: ${match[1]}`);
  }
  const unit = match[2].toLowerCase();
  let unitHours;
  if (['h', 'hr', 'hour', 'hours', '时', '小时'].includes(unit)) unitHours = 1;
  else if (['d', 'day', 'days', '天', '日'].includes(unit)) unitHours = 24;
  else if (['tenday', '旬'].includes(unit)) unitHours = 240;
  else if (['m', 'mon', 'month', 'months', '月'].includes(unit)) unitHours = 720;
  else if (['s', 'season', 'seasons', '季'].includes(unit)) unitHours = 2160;
  else unitHours = 8640;

  const hours = amount * unitHours;
  if (hours > MAX_ADVANCE_HOURS) {
    throw new Error(`首版 --advance 单次推进上限为 1 年 (360d / 8640h)，实际请求: ${spec} (${hours}h)`);
  }
  return hours;
}

export function computeInitialNextTick(calOrStr, cadence) {
  if (!Object.prototype.hasOwnProperty.call(CADENCE_HOURS, cadence)) {
    throw new Error(`未知时钟周期 cadence: ${cadence}`);
  }
  const cal = typeof calOrStr === 'string' ? parseTimestamp(calOrStr) : calOrStr;
  validateCalendarObj(cal);
  const curHours = toTotalHours(cal);
  const stepHours = CADENCE_HOURS[cadence];

  let anchorCal;
  if (cadence === 'day') {
    anchorCal = { era: cal.era, year: cal.year, month: cal.month, day: cal.day, hour: 4 };
  } else if (cadence === 'tenday') {
    const boundaryDay = Math.floor((cal.day - 1) / 10) * 10 + 1;
    anchorCal = { era: cal.era, year: cal.year, month: cal.month, day: boundaryDay, hour: 4 };
  } else if (cadence === 'month') {
    anchorCal = { era: cal.era, year: cal.year, month: cal.month, day: 1, hour: 4 };
  } else if (cadence === 'season') {
    const boundaryMonth = Math.floor((cal.month - 1) / 3) * 3 + 1;
    anchorCal = { era: cal.era, year: cal.year, month: boundaryMonth, day: 1, hour: 4 };
  } else {
    anchorCal = { era: cal.era, year: cal.year, month: 1, day: 1, hour: 4 };
  }

  let nextHours = toTotalHours(anchorCal);
  while (nextHours <= curHours) {
    nextHours += stepHours;
  }
  return formatTimestamp(fromTotalHours(nextHours, cal.era));
}

export function createSeededRng(seed = 1) {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new Error(`RNG seed 必须为有限数字，实际: ${String(seed)}`);
  }
  const u32 = seed >>> 0;
  return { seed: u32, state: u32 };
}

export function rollD6WithRng(rng) {
  if (!rng || typeof rng !== 'object' || !Number.isSafeInteger(rng.state) || rng.state < 0 || rng.state > 0xFFFFFFFF) {
    throw new Error('world.rng.state 必须为 32 位无符号整数');
  }
  let state = rng.state >>> 0;
  // 无模偏差拒绝采样（Mulberry32 步进；4294967292 = 6 * 715827882）
  while (true) {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u32 = (t ^ (t >>> 14)) >>> 0;
    if (u32 < 4294967292) {
      const roll = (u32 % 6) + 1;
      return { roll, nextRng: { seed: rng.seed >>> 0, state } };
    }
  }
}

export function computeClockDeltaFromD6(roll, intensity = 'standard') {
  if (!INTENSITY_LEVELS.includes(intensity)) {
    throw new Error(`未知时代烈度 intensity: ${intensity}`);
  }
  if (intensity === 'slow') {
    if (roll <= 4) return 0;
    return roll === 5 ? 1 : 2;
  }
  if (intensity === 'fast') {
    if (roll <= 2) return 0;
    return roll <= 4 ? 1 : 2;
  }
  // standard: 1-3 -> 0, 4-5 -> +1, 6 -> +2
  if (roll <= 3) return 0;
  return roll <= 5 ? 1 : 2;
}

export function advanceWorldTime(worldDoc, durationSpec) {
  validateWorldDoc(worldDoc);
  const deltaHours = parseDurationHours(durationSpec);
  const nextWorld = structuredClone(worldDoc);

  const era = nextWorld.calendar.era;
  const startHours = toTotalHours(nextWorld.calendar);
  const targetHours = startHours + deltaHours;
  const intensity = nextWorld.meta?.worldParams?.intensity || 'standard';
  const events = [];

  while (true) {
    let chosenIdx = -1;
    let chosenTickHours = Infinity;

    for (let i = 0; i < nextWorld.clocks.length; i++) {
      const clk = nextWorld.clocks[i];
      if (clk.status !== 'active' || clk.current >= clk.max) continue;
      const tickHours = toTotalHours(clk.nextTick);
      if (tickHours <= targetHours) {
        if (
          tickHours < chosenTickHours ||
          (tickHours === chosenTickHours && String(clk.id) < String(nextWorld.clocks[chosenIdx].id))
        ) {
          chosenIdx = i;
          chosenTickHours = tickHours;
        }
      }
    }

    if (chosenIdx === -1) break;

    const clk = nextWorld.clocks[chosenIdx];
    const stepHours = CADENCE_HOURS[clk.cadence];
    const tickTimestamp = formatTimestamp(fromTotalHours(chosenTickHours, era));
    const { roll, nextRng } = rollD6WithRng(nextWorld.rng);
    nextWorld.rng = nextRng;

    const delta = computeClockDeltaFromD6(roll, intensity);
    const before = clk.current;
    clk.current = Math.min(clk.max, clk.current + delta);
    clk.nextTick = formatTimestamp(fromTotalHours(chosenTickHours + stepHours, era));
    const completed = clk.current >= clk.max;
    if (completed) {
      clk.status = 'completed';
    }

    events.push({
      clockId: clk.id,
      clockName: clk.name,
      kind: clk.kind,
      cadence: clk.cadence,
      tickAt: tickTimestamp,
      roll,
      delta,
      before,
      after: clk.current,
      max: clk.max,
      completed,
      visibility: clk.visibility
    });
  }

  nextWorld.calendar = fromTotalHours(targetHours, era);
  return { world: nextWorld, deltaHours, events };
}

// ============================================================================
// 三、数据结构、单一权威、玩家视图过滤与死亡 NPC 保护契约
// ============================================================================

export function validateDModeStateDoc(stateDoc) {
  if (!stateDoc || typeof stateDoc !== 'object') {
    throw new Error('state.json 必须为 JSON 对象');
  }
  for (const forbidden of STATE_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stateDoc, forbidden)) {
      throw new Error(`state.json 出现越界字段 "${forbidden}"（该域归属 world.json 唯一管辖）`);
    }
  }
  const meta = stateDoc.meta;
  if (!meta || meta.mode !== 'D' || meta.worldId !== JIANHUO_WORLD_ID || meta.schemaVersion !== WORLD_SCHEMA_VERSION) {
    throw new Error('D 模式 state.json.meta 必须显式包含 { mode: "D", worldId: "jianhuo", schemaVersion: 1 }');
  }
  if (!Array.isArray(stateDoc.party)) {
    throw new Error('state.json.party 必须为数组');
  }
  if (!stateDoc.inventory || typeof stateDoc.inventory !== 'object') {
    throw new Error('state.json.inventory 必须为对象');
  }
  if (Object.prototype.hasOwnProperty.call(stateDoc.inventory, 'gold')) {
    throw new Error('D 模式 state.json.inventory 严禁同时存储 gold 字段，只允许使用 copper 统一铜币记账');
  }
  assertNonNegativeSafeInt(stateDoc.inventory.copper, 'state.json.inventory.copper');
  if (!Array.isArray(stateDoc.inventory.items)) {
    throw new Error('state.json.inventory.items 必须为数组');
  }
  return { valid: true };
}

function validateVisibility(vis, label) {
  if (!VISIBILITY_LEVELS.includes(vis)) {
    throw new Error(`${label} visibility 非法: ${String(vis)}`);
  }
}

export function validateCanonEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('canon 记录必须为对象');
  }
  for (const strKey of ['id', 'entityId', 'predicate']) {
    if (typeof entry[strKey] !== 'string' || !entry[strKey].trim()) {
      throw new Error(`canon.${strKey} 必须为非空字符串`);
    }
  }
  const valType = typeof entry.value;
  if (!['string', 'number', 'boolean'].includes(valType) || (valType === 'string' && !entry.value.trim())) {
    throw new Error(`canon.value 必须为非空字符串、数值或布尔值`);
  }
  const fromH = entry.validFrom === null ? -Infinity : toTotalHours(entry.validFrom);
  const toH = entry.validTo === null ? Infinity : toTotalHours(entry.validTo);
  if (fromH >= toH) {
    throw new Error(`canon 时间区间非法：validFrom (${entry.validFrom}) 必须早于 validTo (${entry.validTo})`);
  }
  if (!CANON_STATUSES.includes(entry.status)) {
    throw new Error(`canon.status 非法: ${String(entry.status)}`);
  }
  if (!CANON_SOURCES.includes(entry.source)) {
    throw new Error(`canon.source 非法: ${String(entry.source)}`);
  }
  validateVisibility(entry.visibility, 'canon');
  return true;
}

export function validateWorldDoc(worldDoc) {
  if (!worldDoc || typeof worldDoc !== 'object') {
    throw new Error('world.json 必须为 JSON 对象');
  }
  for (const forbidden of WORLD_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(worldDoc, forbidden)) {
      throw new Error(`world.json 出现越界字段 "${forbidden}"（该域归属 state.json 唯一管辖）`);
    }
  }
  const meta = worldDoc.meta;
  if (!meta || meta.mode !== 'D' || meta.worldId !== JIANHUO_WORLD_ID || meta.schemaVersion !== WORLD_SCHEMA_VERSION) {
    throw new Error('world.json.meta 必须显式包含 { mode: "D", worldId: "jianhuo", schemaVersion: 1 }');
  }
  if (!Array.isArray(meta.completedOpIds)) {
    throw new Error('world.json.meta.completedOpIds 必须为数组');
  }
  validateCalendarObj(worldDoc.calendar);
  if (
    !worldDoc.rng ||
    !Number.isSafeInteger(worldDoc.rng.seed) ||
    !Number.isSafeInteger(worldDoc.rng.state)
  ) {
    throw new Error('world.json.rng 必须包含无符号 32 位整数 { seed, state }');
  }

  for (const arrKey of ['locations', 'factions', 'npcs', 'clocks', 'ledger', 'canon', 'rumors']) {
    if (!Array.isArray(worldDoc[arrKey])) {
      throw new Error(`world.json.${arrKey} 必须为数组`);
    }
  }
  if (worldDoc.eventHistory !== undefined && !Array.isArray(worldDoc.eventHistory)) {
    throw new Error('world.json.eventHistory 必须为数组');
  }
  for (const [index, event] of (worldDoc.eventHistory || []).entries()) {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id.trim()) {
      throw new Error(`world.json.eventHistory[${index}] 必须包含非空字符串 id`);
    }
    if (event.recordedAt !== undefined) toTotalHours(event.recordedAt);
    if (event.visibility !== undefined) validateVisibility(event.visibility, `event(${event.id})`);
  }

  for (const loc of worldDoc.locations) {
    if (!TIER_LEVELS.includes(loc.tier)) {
      throw new Error(`location "${loc.id}" 的认知层级 tier 非法: ${loc.tier}`);
    }
    validateVisibility(loc.visibility, `location(${loc.id})`);
  }

  for (const npc of worldDoc.npcs) {
    if (!Number.isSafeInteger(npc.attitude) || npc.attitude < -3 || npc.attitude > 3) {
      throw new Error(`NPC "${npc.id}" 的 attitude 必须在 -3..+3 之间`);
    }
    if (typeof npc.alive !== 'boolean') {
      throw new Error(`NPC "${npc.id}" 的 alive 必须为布尔值`);
    }
    if (npc.role !== undefined && typeof npc.role !== 'string') {
      throw new Error(`NPC "${npc.id}" 的 role 必须为字符串`);
    }
    validateVisibility(npc.visibility, `npc(${npc.id})`);
  }

  for (const clk of worldDoc.clocks) {
    if (!CLOCK_KINDS.includes(clk.kind)) {
      throw new Error(`clock "${clk.id}" 的 kind 非法: ${clk.kind}`);
    }
    if (!Object.prototype.hasOwnProperty.call(CADENCE_HOURS, clk.cadence)) {
      throw new Error(`clock "${clk.id}" 的 cadence 非法: ${clk.cadence}`);
    }
    if (!CLOCK_STATUSES.includes(clk.status)) {
      throw new Error(`clock "${clk.id}" 的 status 非法: ${clk.status}`);
    }
    if (!Number.isSafeInteger(clk.max) || clk.max < 1 || !Number.isSafeInteger(clk.current) || clk.current < 0 || clk.current > clk.max) {
      throw new Error(`clock "${clk.id}" 的进度 ${clk.current}/${clk.max} 非法`);
    }
    toTotalHours(clk.nextTick);
    validateVisibility(clk.visibility, `clock(${clk.id})`);
  }

  for (const item of worldDoc.ledger) {
    if (!LEDGER_TYPES.includes(item.type)) {
      throw new Error(`ledger "${item.id}" 的 type 非法: ${item.type}`);
    }
    if (item.debtKind !== undefined && !DEBT_KINDS.includes(item.debtKind)) {
      throw new Error(`ledger "${item.id}" 的 debtKind 非法: ${item.debtKind}`);
    }
    if (!LEDGER_STATUSES.includes(item.status)) {
      throw new Error(`ledger "${item.id}" 的 status 非法: ${item.status}`);
    }
    if (item.dueAt !== null && item.dueAt !== undefined) {
      toTotalHours(item.dueAt);
    }
    validateVisibility(item.visibility, `ledger(${item.id})`);
  }

  for (const c of worldDoc.canon) {
    validateCanonEntry(c);
  }

  for (const r of worldDoc.rumors) {
    validateVisibility(r.visibility, `rumor(${r.id})`);
  }

  return { valid: true };
}

export function filterPlayerVisible(worldDoc, { gm = false } = {}) {
  const copy = structuredClone(worldDoc);
  if (gm) return copy;

  const isVisible = (item) => item.visibility !== 'secret';
  copy.locations = copy.locations.filter(isVisible);
  copy.factions = copy.factions.filter(isVisible);
  copy.clocks = copy.clocks.filter(isVisible);
  copy.ledger = copy.ledger.filter(isVisible);
  copy.canon = copy.canon.filter(isVisible);
  copy.rumors = copy.rumors.filter(isVisible);
  copy.eventHistory = (copy.eventHistory || []).filter(isVisible);
  copy.npcs = copy.npcs.filter(isVisible).map((npc) => {
    const rest = { ...npc };
    delete rest.secret;
    return rest;
  });
  return copy;
}

export function updateNpcRecord(existingNpc, patch, { allowLegalRevival = false } = {}) {
  if (!existingNpc || typeof existingNpc !== 'object') {
    throw new Error('existingNpc 必须为对象');
  }
  if (existingNpc.alive === false && patch?.alive === true && !allowLegalRevival) {
    throw new Error(`NPC "${existingNpc.name || existingNpc.id}" 已死亡，普通更新不能改回存活（须显式登记 D&D 2024 合法复活事件）`);
  }
  const updated = { ...existingNpc, ...patch, id: existingNpc.id };
  if (!Number.isSafeInteger(updated.attitude) || updated.attitude < -3 || updated.attitude > 3) {
    throw new Error(`NPC attitude 必须在 -3..+3 之间，实际: ${updated.attitude}`);
  }
  validateVisibility(updated.visibility, `npc(${updated.id})`);
  return updated;
}

// ============================================================================
// 四、结构化世界事实（canon）冲突检测契约
// ============================================================================

function intervalsOverlap(aFromStr, aToStr, bFromStr, bToStr) {
  const aStart = aFromStr === null ? -Infinity : toTotalHours(aFromStr);
  const aEnd = aToStr === null ? Infinity : toTotalHours(aToStr);
  const bStart = bFromStr === null ? -Infinity : toTotalHours(bFromStr);
  const bEnd = bToStr === null ? Infinity : toTotalHours(bToStr);
  return aStart < bEnd && bStart < aEnd;
}

export function checkCanonConflict(existingCanon, candidate) {
  validateCanonEntry(candidate);
  const hardConflicts = [];
  const suspectedConflicts = [];

  for (const cur of existingCanon) {
    if (cur.id === candidate.id) {
      hardConflicts.push({
        existingId: cur.id,
        reason: `canon ID "${candidate.id}" 已存在`
      });
      continue;
    }

    if (cur.entityId !== candidate.entityId) continue;

    const overlaps = intervalsOverlap(cur.validFrom, cur.validTo, candidate.validFrom, candidate.validTo);
    if (!overlaps) continue;

    if (cur.predicate === candidate.predicate) {
      const sameValue = cur.value === candidate.value;
      if (!sameValue) {
        if (cur.status === '定论' && candidate.status === '定论') {
          hardConflicts.push({
            existingId: cur.id,
            reason: `实体 "${candidate.entityId}" 的属性 "${candidate.predicate}" 在重叠时间段内已存在定论 "${cur.value}" (#${cur.id})，与新定论 "${candidate.value}" 冲突`
          });
        } else if (cur.status === '定论' || candidate.status === '定论') {
          suspectedConflicts.push({
            existingId: cur.id,
            reason: `实体 "${candidate.entityId}" 的属性 "${candidate.predicate}" 存在定论与传说/候选真相分歧（"${cur.value}" vs "${candidate.value}"），请 GM 留意叙事口径`
          });
        }
      }
    } else if (
      cur.status === '定论' &&
      candidate.status === '定论' &&
      cur.predicate === '存亡' &&
      TERMINAL_VALUES.has(String(cur.value).trim())
    ) {
      suspectedConflicts.push({
        existingId: cur.id,
        reason: `实体 "${candidate.entityId}" 在重叠时间段内已有存亡定论 "${cur.value}" (#${cur.id})，新增属性 "${candidate.predicate}=${candidate.value}" 疑似冲突，请 GM 复核`
      });
    }
  }

  return {
    conflict: hardConflicts.length > 0,
    hardConflicts,
    suspectedConflicts
  };
}

export function appendCanonEntry(existingCanon, candidate) {
  const result = checkCanonConflict(existingCanon, candidate);
  if (result.conflict) {
    throw new Error(`canon 定论冲突拒绝写入: ${result.hardConflicts.map(c => c.reason).join('; ')}`);
  }
  return {
    canon: [...existingCanon, structuredClone(candidate)],
    suspectedConflicts: result.suspectedConflicts
  };
}

// ============================================================================
// 五、双文件跨脚本原子写与中断恢复契约（pending-op.json）
// ============================================================================

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function writeFileAtomic(targetPath, content) {
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

export function recoverPendingOp(sessionDir) {
  const pendingPath = path.join(sessionDir, 'pending-op.json');
  if (!fs.existsSync(pendingPath)) {
    return { recovered: false, outcome: 'none', message: '' };
  }

  const statePath = path.join(sessionDir, 'state.json');
  const worldPath = path.join(sessionDir, 'world.json');
  const stateBakPath = `${statePath}.bak`;
  const worldBakPath = `${worldPath}.bak`;

  const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
  const curStateRaw = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null;
  const curWorldRaw = fs.existsSync(worldPath) ? fs.readFileSync(worldPath, 'utf8') : null;

  const isStatePost = curStateRaw !== null && sha256Text(curStateRaw) === pending.postStateSha256;
  const isWorldPost = curWorldRaw !== null && sha256Text(curWorldRaw) === pending.postWorldSha256;

  // 两个文件都已是目标新版：清理 pending-op.json 即可
  if (isStatePost && isWorldPost) {
    fs.unlinkSync(pendingPath);
    return {
      recovered: true,
      outcome: 'committed_clean',
      opId: pending.opId,
      message: `[恢复报告] 检测到未清理的已完成事务 ${pending.opId} (${pending.action})，state.json 与 world.json 均为最新一致版本，已清理 pending-op.json。`
    };
  }

  // 否则执行双边一致性回滚：优先验证当前文件是否已是写前版本，否则从校验通过的 .bak 恢复
  let rollbackStateRaw = null;
  if (curStateRaw !== null && sha256Text(curStateRaw) === pending.preStateSha256) {
    rollbackStateRaw = curStateRaw;
  } else if (fs.existsSync(stateBakPath)) {
    const bakRaw = fs.readFileSync(stateBakPath, 'utf8');
    if (sha256Text(bakRaw) === pending.preStateSha256) {
      rollbackStateRaw = bakRaw;
    }
  }

  let rollbackWorldRaw = null;
  if (curWorldRaw !== null && sha256Text(curWorldRaw) === pending.preWorldSha256) {
    rollbackWorldRaw = curWorldRaw;
  } else if (fs.existsSync(worldBakPath)) {
    const bakRaw = fs.readFileSync(worldBakPath, 'utf8');
    if (sha256Text(bakRaw) === pending.preWorldSha256) {
      rollbackWorldRaw = bakRaw;
    }
  }

  if (rollbackStateRaw === null || rollbackWorldRaw === null) {
    const failedTargets = [];
    if (rollbackStateRaw === null) failedTargets.push('state.json / state.json.bak');
    if (rollbackWorldRaw === null) failedTargets.push('world.json / world.json.bak');
    throw new Error(
      `无法安全回滚事务 ${pending.opId} (${pending.action || '未知操作'})：${failedTargets.join(' 与 ')} 的 .bak 备份缺失或写前哈希不匹配。\n` +
      `【手动处理办法】:\n` +
      `  1. 打开存档目录: ${sessionDir}\n` +
      `  2. 对照检查 state.json（及 state.json.bak）与 world.json（及 world.json.bak）的内容（如角色 HP 与世界日历 calendar），将两边手动恢复到同一时间点的完整版本；\n` +
      `  3. 确认 state.json 与 world.json 状态一致后，手动删除 ${pendingPath} 即可继续运行指令。`
    );
  }

  writeFileAtomic(statePath, rollbackStateRaw);
  writeFileAtomic(worldPath, rollbackWorldRaw);
  fs.unlinkSync(pendingPath);

  return {
    recovered: true,
    outcome: 'rolled_back',
    opId: pending.opId,
    message: `[恢复报告] 检测到未完成跨文件事务 ${pending.opId} (${pending.action})，已通过 .bak 备份将 state.json 与 world.json 一致回滚至写前状态。`
  };
}

export function executeDualFileTx({
  sessionDir,
  opId,
  action,
  mutate,
  _simulateCrashAfterStateWrite = false,
  _simulateCrashBeforeUnlink = false
}) {
  if (typeof opId !== 'string' || !opId.trim()) {
    throw new Error('跨文件事务必须提供非空唯一 opId');
  }
  if (typeof action !== 'string' || !action.trim()) {
    throw new Error('跨文件事务必须提供非空 action 描述');
  }

  const recovery = recoverPendingOp(sessionDir);

  const statePath = path.join(sessionDir, 'state.json');
  const worldPath = path.join(sessionDir, 'world.json');
  const pendingPath = path.join(sessionDir, 'pending-op.json');

  if (!fs.existsSync(statePath) || !fs.existsSync(worldPath)) {
    throw new Error(`跨文件事务要求 ${sessionDir} 下同时存在 state.json 与 world.json`);
  }

  const preStateRaw = fs.readFileSync(statePath, 'utf8');
  const preWorldRaw = fs.readFileSync(worldPath, 'utf8');
  const curState = JSON.parse(preStateRaw);
  const curWorld = JSON.parse(preWorldRaw);

  validateDModeStateDoc(curState);
  validateWorldDoc(curWorld);

  // 幂等检查：同一 opId 重复提交，不重复执行
  if (curWorld.meta.completedOpIds.includes(opId)) {
    return {
      skipped: true,
      reason: 'duplicate_op_id',
      opId,
      recovery,
      state: curState,
      world: curWorld
    };
  }

  const { nextState, nextWorld, result } = mutate(structuredClone(curState), structuredClone(curWorld));

  const completedIds = [...(nextWorld.meta.completedOpIds || []), opId];
  if (completedIds.length > MAX_COMPLETED_OP_IDS) {
    completedIds.splice(0, completedIds.length - MAX_COMPLETED_OP_IDS);
  }
  nextWorld.meta.completedOpIds = completedIds;

  validateDModeStateDoc(nextState);
  validateWorldDoc(nextWorld);

  const postStateRaw = JSON.stringify(nextState, null, 2) + '\n';
  const postWorldRaw = JSON.stringify(nextWorld, null, 2) + '\n';

  const preStateSha256 = sha256Text(preStateRaw);
  const preWorldSha256 = sha256Text(preWorldRaw);
  const postStateSha256 = sha256Text(postStateRaw);
  const postWorldSha256 = sha256Text(postWorldRaw);

  // 刷新两个文件的 .bak 为精确的本次写前内容，再原子写入 pending-op.json
  writeFileAtomic(`${statePath}.bak`, preStateRaw);
  writeFileAtomic(`${worldPath}.bak`, preWorldRaw);

  const pendingPayload = JSON.stringify(
    {
      opId,
      action,
      createdAt: new Date().toISOString(),
      preStateSha256,
      preWorldSha256,
      postStateSha256,
      postWorldSha256
    },
    null,
    2
  ) + '\n';
  writeFileAtomic(pendingPath, pendingPayload);

  // 依次原子写 state.json -> world.json
  writeFileAtomic(statePath, postStateRaw);
  if (_simulateCrashAfterStateWrite) {
    throw new Error('SIMULATED_CRASH_AFTER_STATE_WRITE');
  }

  writeFileAtomic(worldPath, postWorldRaw);
  if (_simulateCrashBeforeUnlink) {
    throw new Error('SIMULATED_CRASH_BEFORE_UNLINK');
  }

  fs.unlinkSync(pendingPath);

  return {
    skipped: false,
    opId,
    recovery,
    state: nextState,
    world: nextWorld,
    result
  };
}
