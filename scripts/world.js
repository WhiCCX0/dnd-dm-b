#!/usr/bin/env node

/**
 * 剑火纪元沙盒（D 模式）最小世界工具 (Phase 2)
 * 首版 9 命令: init / status / time / clock / ledger / canon / npc / rumor / oracle
 * 底层严格复用 scripts/world-contract.js，零 npm 依赖，严禁反向调用 scripts/state.js。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_SCHEMA_VERSION,
  JIANHUO_WORLD_ID,
  CADENCE_HOURS,
  TIER_LEVELS,
  LEDGER_TYPES,
  LEDGER_STATUSES,
  DEBT_KINDS,
  CANON_STATUSES,
  CANON_SOURCES,
  VISIBILITY_LEVELS,
  CLOCK_KINDS,
  CLOCK_STATUSES,
  INTENSITY_LEVELS,
  validateCalendarObj,
  getDayPeriod,
  formatTimestamp,
  parseTimestamp,
  toTotalHours,
  fromTotalHours,
  parseDurationHours,
  computeInitialNextTick,
  createSeededRng,
  rollD6WithRng,
  computeClockDeltaFromD6,
  validateWorldDoc,
  filterPlayerVisible,
  updateNpcRecord,
  checkCanonConflict,
  appendCanonEntry,
  recoverPendingOp
} from './world-contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_TRACKS_PATH = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'tracks.json');
const DEFAULT_TABLES_PATH = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'tables.json');

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bright: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  red: useColor ? '\x1b[31m' : ''
};

/** Remove GM-only records and NPC secrets from player-facing result payloads. */
export function projectPlayerResult(value, { gm = false } = {}) {
  if (gm) return value;
  const visit = (item) => {
    if (Array.isArray(item)) {
      return item.filter(entry => !entry || entry.visibility !== 'secret').map(visit);
    }
    if (!item || typeof item !== 'object') return item;
    if (item.visibility === 'secret') return undefined;
    const projected = {};
    for (const [key, nested] of Object.entries(item)) {
      if (key === 'secret') continue;
      const safe = visit(nested);
      if (safe !== undefined) projected[key] = safe;
    }
    return projected;
  };
  return visit(value);
}

const TABLE_ALIASES = Object.freeze({
  rumors: 'rumor',
  npcs: 'npc',
  events: 'event',
  encounters: 'event',
  omens: 'omen',
  oracle: 'omen'
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getDefaultUserSessionsDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'dnd-dm-b', 'sessions');
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'dnd-dm-b', 'sessions');
}

export function getWorldSessionDir(campaignName) {
  if (!campaignName || typeof campaignName !== 'string' || !campaignName.trim()) {
    throw new Error('战役名称不能为空');
  }
  const safeName = campaignName.trim().replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_');
  if (!safeName || /^_+$/.test(safeName)) {
    throw new Error(`无效的战役名称: "${campaignName}"`);
  }

  const explicitEnvDir = process.env.DND_SESSIONS_DIR || process.env.SESSIONS_DIR;
  if (explicitEnvDir) {
    return path.join(explicitEnvDir, safeName);
  }

  const userDir = getDefaultUserSessionsDir();
  const userCampaignDir = path.join(userDir, safeName);
  const legacyCampaignDir = path.join(path.resolve(ROOT_DIR, 'sessions'), safeName);

  if (fs.existsSync(legacyCampaignDir) && !fs.existsSync(userCampaignDir)) {
    return legacyCampaignDir;
  }
  return userCampaignDir;
}

export function getWorldPath(campaignName) {
  return path.join(getWorldSessionDir(campaignName), 'world.json');
}

export function loadTracksDoc(tracksFile = DEFAULT_TRACKS_PATH) {
  if (!fs.existsSync(tracksFile)) {
    return { tracks: [], linkages: [] };
  }
  return JSON.parse(fs.readFileSync(tracksFile, 'utf8'));
}

export function loadTablesDoc(tablesFile = DEFAULT_TABLES_PATH) {
  if (!fs.existsSync(tablesFile)) {
    throw new Error(`未找到随机表文件: ${tablesFile}`);
  }
  return JSON.parse(fs.readFileSync(tablesFile, 'utf8'));
}

export function resolveTableGroup(tablesDoc, rawKey = 'omen') {
  const container = tablesDoc?.tables && typeof tablesDoc.tables === 'object' ? tablesDoc.tables : tablesDoc;
  if (!container || typeof container !== 'object') {
    throw new Error('tables.json 格式非法：缺少 tables 对象');
  }
  const key = String(rawKey || 'omen').trim();
  const resolvedKey = container[key] ? key : (TABLE_ALIASES[key.toLowerCase()] || key);
  const group = container[resolvedKey];
  if (!group) {
    const available = Object.keys(container).join(', ');
    throw new Error(`未找到随机表 "${rawKey}"（当前可用表: ${available}）`);
  }
  const entries = Array.isArray(group) ? group : group.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`随机表 "${resolvedKey}" 为空或缺少 entries 数组`);
  }
  return {
    tableKey: resolvedKey,
    name: group.name || resolvedKey,
    description: group.description || '',
    entries
  };
}

/**
 * 复用 world-contract.js 的 rollD6WithRng 实现无模偏差均匀抽样 [0, count - 1]
 */
export function drawIndexWithRng(rng, count) {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`抽样池大小必须为正整数，实际: ${count}`);
  }
  if (count === 1) {
    return { index: 0, nextRng: { seed: rng.seed >>> 0, state: rng.state >>> 0 } };
  }
  let digits = 1;
  let limit = 6;
  while (limit < count) {
    digits += 1;
    limit *= 6;
  }
  const maxUnbiased = Math.floor(limit / count) * count;
  let curRng = rng;
  while (true) {
    let val = 0;
    for (let i = 0; i < digits; i++) {
      const { roll, nextRng } = rollD6WithRng(curRng);
      curRng = nextRng;
      val = val * 6 + (roll - 1);
    }
    if (val < maxUnbiased) {
      return { index: val % count, nextRng: curRng };
    }
  }
}

export function getWorld(campaignName) {
  const sessionDir = getWorldSessionDir(campaignName);
  if (fs.existsSync(path.join(sessionDir, 'pending-op.json'))) {
    recoverPendingOp(sessionDir);
  }
  const worldPath = path.join(sessionDir, 'world.json');
  if (!fs.existsSync(worldPath)) {
    return null;
  }
  const raw = fs.readFileSync(worldPath, 'utf8');
  const worldDoc = JSON.parse(raw);
  if (!Array.isArray(worldDoc.eventHistory)) worldDoc.eventHistory = [];
  validateWorldDoc(worldDoc);
  return worldDoc;
}

export function saveWorld(campaignName, worldDoc) {
  const sessionDir = getWorldSessionDir(campaignName);
  ensureDir(sessionDir);
  if (fs.existsSync(path.join(sessionDir, 'pending-op.json'))) {
    recoverPendingOp(sessionDir);
  }
  validateWorldDoc(worldDoc);
  const worldPath = path.join(sessionDir, 'world.json');
  const bakPath = `${worldPath}.bak`;
  const payload = JSON.stringify(worldDoc, null, 2) + '\n';
  const tmpPath = `${worldPath}.${process.pid}.${Date.now()}.tmp`;

  if (fs.existsSync(worldPath)) {
    try {
      fs.copyFileSync(worldPath, bakPath);
    } catch (_) {
      // Ignore copy backup error
    }
  }
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, worldPath);
  return worldDoc;
}

function getStageLabel(clock, tracksDoc) {
  if (clock.kind !== 'track') return null;
  const def = tracksDoc?.tracks?.find(t => t.id === clock.id || t.name === clock.name);
  const stages = clock.stages || def?.stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const idx = Math.max(0, Math.min(stages.length - 1, clock.current));
  return stages[idx];
}

/**
 * 检查并触发 tracks.json 中写死的跨线联动（不额外消耗 RNG，保证拆分推进严格等价）
 */
export function applyTrackLinkagesForStep(worldDoc, fromClockId, beforeVal, afterVal, tickAt, tracksDoc = loadTracksDoc()) {
  const linkages = Array.isArray(tracksDoc?.linkages) ? tracksDoc.linkages : [];
  const linkageEvents = [];

  for (const rule of linkages) {
    if (rule.fromClockId !== fromClockId) continue;
    if (beforeVal < rule.atStage && afterVal >= rule.atStage) {
      const targetClk = worldDoc.clocks.find(c => c.id === rule.targetClockId);
      if (!targetClk || targetClk.status === 'cancelled' || targetClk.current >= targetClk.max) {
        continue;
      }
      const targetBefore = targetClk.current;
      const delta = Number.isSafeInteger(rule.delta) ? rule.delta : 1;
      targetClk.current = Math.max(0, Math.min(targetClk.max, targetClk.current + delta));
      if (targetClk.status === 'paused' && targetClk.current < targetClk.max) {
        targetClk.status = 'active';
        const refCal = tickAt && typeof tickAt === 'string' && tickAt.includes('-M')
          ? fromTotalHours(toTotalHours(tickAt), worldDoc.calendar.era)
          : worldDoc.calendar;
        targetClk.nextTick = computeInitialNextTick(refCal, targetClk.cadence);
      }
      const completed = targetClk.current >= targetClk.max;
      if (completed) {
        targetClk.status = 'completed';
      }
      const sourceClock = worldDoc.clocks.find(clock => clock.id === fromClockId);
      const sourceVisibility = sourceClock?.visibility || 'public';
      const targetVisibility = targetClk.visibility || 'public';
      const visibility = VISIBILITY_LEVELS[
        Math.max(VISIBILITY_LEVELS.indexOf(sourceVisibility), VISIBILITY_LEVELS.indexOf(targetVisibility))
      ] || 'secret';
      linkageEvents.push({
        type: 'track_linkage',
        linkageId: rule.id,
        fromClockId,
        atStage: rule.atStage,
        clockId: targetClk.id,
        clockName: targetClk.name,
        kind: targetClk.kind,
        cadence: targetClk.cadence,
        tickAt,
        roll: null,
        delta: targetClk.current - targetBefore,
        before: targetBefore,
        after: targetClk.current,
        max: targetClk.max,
        completed,
        summary: rule.summary,
        visibility
      });
    }
  }

  return linkageEvents;
}

/**
 * 复用 world-contract.js 的时钟边界规则推进时间，并同步执行演化八线写死联动与账本逾期扫描
 */
export function advanceWorldTimeWithTracks(worldDoc, durationSpec, tracksDoc = loadTracksDoc()) {
  validateWorldDoc(worldDoc);
  const deltaHours = parseDurationHours(durationSpec);
  const nextWorld = structuredClone(worldDoc);

  const era = nextWorld.calendar.era;
  const startHours = toTotalHours(nextWorld.calendar);
  const targetHours = startHours + deltaHours;
  const intensity = nextWorld.meta?.worldParams?.intensity || 'standard';
  const events = [];
  const linkageEvents = [];

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
      id: `evt:${tickTimestamp}:${clk.id}`,
      type: 'clock_tick',
      recordedAt: tickTimestamp,
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

    if (clk.kind === 'track' && clk.current > before) {
      const triggered = applyTrackLinkagesForStep(nextWorld, clk.id, before, clk.current, tickTimestamp, tracksDoc);
      for (const [linkIndex, le] of triggered.entries()) {
        const recorded = {
          ...le,
          id: `evt:${tickTimestamp}:link:${fromClockId}:${le.linkageId || 'link'}:${linkIndex + 1}`,
          recordedAt: tickTimestamp
        };
        linkageEvents.push(recorded);
        events.push(recorded);
      }
    }
  }

  nextWorld.calendar = fromTotalHours(targetHours, era);

  const overdueLedger = nextWorld.ledger.filter(
    item => item.status !== '了结' && item.dueAt && toTotalHours(item.dueAt) <= targetHours
  );
  nextWorld.eventHistory = [
    ...(nextWorld.eventHistory || []),
    ...events
  ].slice(-500);

  return {
    world: nextWorld,
    deltaHours,
    events,
    linkageEvents,
    overdueLedger
  };
}

// ============================================================================
// 1. init 命令（不写死开局地点/势力；开局生成 3 个患级局部问题；演化八线仅启动 3-4 条）
// ============================================================================

function parseCsvList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(s => String(s).trim()).filter(Boolean);
  return String(raw).split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
}

function nextSequentialId(records, prefix) {
  const existing = new Set(records.map(record => record.id));
  let sequence = records.length + 1;
  while (existing.has(`${prefix}${sequence}`)) sequence += 1;
  return `${prefix}${sequence}`;
}

function resolveActiveTrackIds(tracksDoc, options = {}) {
  const allTracks = Array.isArray(tracksDoc?.tracks) ? tracksDoc.tracks : [];
  const customActive = parseCsvList(options.activeTracks);
  if (options.activeTracks !== undefined) {
    const uniqueActive = [...new Set(customActive)];
    if (uniqueActive.length < 3 || uniqueActive.length > 4) {
      throw new Error('--active-tracks 必须指定 3 至 4 条不同的演化线');
    }
    const knownTracks = new Set(allTracks.flatMap(track => [track.id, track.name]));
    const unknown = uniqueActive.filter(track => !knownTracks.has(track));
    if (unknown.length) {
      throw new Error(`--active-tracks 包含未知演化线: ${unknown.join(', ')}`);
    }
    return new Set(uniqueActive);
  }

  const regionTracks = tracksDoc?.regionTracks || {};
  const searchTarget = `${options.region || ''} ${options.location || options.locationId || ''}`.trim();
  if (searchTarget) {
    for (const [key, trackList] of Object.entries(regionTracks)) {
      if (key !== 'default' && searchTarget.includes(key) && Array.isArray(trackList)) {
        return new Set(trackList.slice(0, 4));
      }
    }
    // 自定义区域：根据字符串哈希稳定选取 3 条相关演化线
    if (allTracks.length >= 4) {
      let hash = 0;
      for (let i = 0; i < searchTarget.length; i++) {
        hash = (hash * 31 + searchTarget.charCodeAt(i)) >>> 0;
      }
      const picked = new Set();
      for (let offset = 0; picked.size < 3 && offset < allTracks.length * 2; offset++) {
        const trk = allTracks[(hash + offset * 3) % allTracks.length];
        picked.add(trk.id);
      }
      return picked;
    }
  }

  const fallback = Array.isArray(regionTracks.default)
    ? regionTracks.default
    : ['track:war', 'track:trade', 'track:migration'];
  return new Set(fallback.slice(0, 4));
}

function buildStarterTroubles(regionName, locName, customTroubles = []) {
  const areaLabel = locName || regionName || '当地聚落';
  const parsedCustom = parseCsvList(customTroubles);
  const defaults = [
    {
      title: `${areaLabel}税卡与粮秣催缴`,
      summary: `${areaLabel}近期加征过境与炉火捐，底层商贩与农户暗流汹涌`,
      consequence: `${areaLabel}爆发抗税哗变或强行封锁集市`
    },
    {
      title: `${areaLabel}外围商道异动`,
      summary: `${areaLabel}通往邻境的旧道夜间频现不明斥候与失踪案`,
      consequence: `${areaLabel}物资断绝、巡逻队遭伏击`
    },
    {
      title: `${areaLabel}行会与地头暗斗`,
      summary: `${areaLabel}地方实力派为争夺码头/工坊管辖权互相安插眼线`,
      consequence: `${areaLabel}爆发街头火并或戒严宵禁`
    }
  ];

  return [0, 1, 2].map(idx => {
    const customText = parsedCustom[idx];
    if (customText) {
      return {
        title: customText,
        summary: `${areaLabel}局部隐患：${customText}`,
        consequence: `${customText}恶化失控，波及${areaLabel}`
      };
    }
    return defaults[idx];
  });
}

export function defaultWorldDoc(options = {}) {
  const calendar = {
    era: options.era ? String(options.era).trim() : '剑火纪',
    year: options.year !== undefined ? Number(options.year) : 142,
    month: options.month !== undefined ? Number(options.month) : 1,
    day: options.day !== undefined ? Number(options.day) : 1,
    hour: options.hour !== undefined ? Number(options.hour) : 8
  };
  validateCalendarObj(calendar);

  const seed = options.seed !== undefined ? Number(options.seed) : 20261107;
  const intensity = options.intensity || 'standard';
  if (!INTENSITY_LEVELS.includes(intensity)) {
    throw new Error(`未知时代烈度 intensity: ${intensity} (支持: ${INTENSITY_LEVELS.join(', ')})`);
  }

  const clocks = [];
  if (!options.noTracks) {
    const tracksDoc = loadTracksDoc(options.tracksFile);
    const activeTrackIds = resolveActiveTrackIds(tracksDoc, options);
    for (const trk of tracksDoc.tracks || []) {
      const isActive = activeTrackIds.has(trk.id) || activeTrackIds.has(trk.name);
      clocks.push({
        id: trk.id,
        name: trk.name,
        kind: 'track',
        cadence: trk.cadence || 'month',
        current: 0,
        max: trk.max || (Array.isArray(trk.stages) ? trk.stages.length - 1 : 4),
        status: isActive ? 'active' : 'paused',
        nextTick: computeInitialNextTick(calendar, trk.cadence || 'month'),
        visibility: trk.visibility || 'public'
      });
    }
  }

  const locations = [];
  const rawLocations = options.locations || options.location || options.locationId;
  const regionName = options.region ? String(options.region).trim() : undefined;
  if (!options.empty && rawLocations) {
    const locList = parseCsvList(rawLocations);
    const defaultTier = options.tier && TIER_LEVELS.includes(options.tier) ? options.tier : '凡俗';
    locList.forEach((locRaw, idx) => {
      const isIdFormat = locRaw.startsWith('loc:');
      const locEntry = {
        id: isIdFormat ? locRaw : `loc:start_${idx + 1}`,
        name: locRaw,
        tier: defaultTier,
        visibility: 'public'
      };
      if (regionName) locEntry.region = regionName;
      locations.push(locEntry);
    });
  }

  const factions = [];
  if (!options.empty && options.factions) {
    const facList = parseCsvList(options.factions);
    facList.forEach((facRaw, idx) => {
      const isIdFormat = facRaw.startsWith('fac:');
      factions.push({
        id: isIdFormat ? facRaw : `fac:start_${idx + 1}`,
        name: facRaw,
        attitude: 0,
        visibility: 'public'
      });
    });
  }

  const ledger = [];
  const canon = [];
  if (options.region) {
    canon.push({
      id: 'canon:start_region',
      entityId: locations[0]?.id || 'region:start',
      predicate: '所属区域',
      value: String(options.region).trim(),
      status: '定论',
      source: '玩家提出',
      validFrom: formatTimestamp(calendar),
      validTo: null,
      visibility: 'public'
    });
  }

  const hasStarterContext = Boolean(options.region || rawLocations || options.troubles);
  if (!options.empty && !options.noTroubles && hasStarterContext) {
    const troubles = buildStarterTroubles(
      options.region ? String(options.region).trim() : '',
      locations[0]?.name || '',
      options.troubles
    );
    troubles.forEach((tr, idx) => {
      const num = idx + 1;
      clocks.push({
        id: `clk:trouble_${num}`,
        name: `【患】${tr.title}`,
        kind: 'threat',
        cadence: 'tenday',
        current: 0,
        max: 4,
        status: 'active',
        nextTick: computeInitialNextTick(calendar, 'tenday'),
        visibility: 'public'
      });
      ledger.push({
        id: `led:trouble_${num}`,
        type: '余波',
        summary: `【患】${tr.summary}`,
        source: '开局地区患级问题',
        status: '未动',
        dueAt: computeInitialNextTick(calendar, 'month'),
        overdueConsequence: tr.consequence,
        npcIds: [],
        factionIds: factions.slice(0, 1).map(f => f.id),
        visibility: 'public'
      });
    });
  }

  if (!options.empty && options.cost) {
    const costText = String(options.cost).trim();
    ledger.push({
      id: 'led:start_cost',
      type: '债',
      debtKind: '契约',
      summary: `【★代价】${costText}`,
      source: '开局身份代价(★)',
      status: '未动',
      dueAt: computeInitialNextTick(calendar, 'month'),
      overdueConsequence: `身份代价反噬：${costText}`,
      npcIds: [],
      factionIds: factions.slice(0, 1).map(f => f.id),
      visibility: 'public'
    });
  }

  if (!options.empty && options.limit) {
    const limitText = String(options.limit).trim();
    clocks.push({
      id: 'clk:start_limit',
      name: `【◆限制】${limitText}`,
      kind: 'threat',
      cadence: 'tenday',
      current: 0,
      max: 4,
      status: 'active',
      nextTick: computeInitialNextTick(calendar, 'tenday'),
      visibility: 'public'
    });
    ledger.push({
      id: 'led:start_limit',
      type: '承诺',
      summary: `【◆限制】${limitText}`,
      source: '开局戒律与限制(◆)',
      status: '未动',
      dueAt: null,
      overdueConsequence: `违背限制引发追责：${limitText}`,
      npcIds: [],
      factionIds: factions.slice(0, 1).map(f => f.id),
      visibility: 'public'
    });
  }

  const worldDoc = {
    meta: {
      mode: 'D',
      worldId: JIANHUO_WORLD_ID,
      schemaVersion: WORLD_SCHEMA_VERSION,
      ...(regionName ? { region: regionName } : {}),
      worldParams: {
        danger: options.danger || 'standard',
        intensity,
        magicLevel: options.magicLevel || 'standard',
        style: options.style || 'grounded'
      },
      completedOpIds: []
    },
    calendar,
    rng: createSeededRng(seed),
    locations,
    factions,
    npcs: [],
    clocks,
    ledger,
    canon,
    rumors: [],
    eventHistory: []
  };

  validateWorldDoc(worldDoc);
  return worldDoc;
}

export function initWorld(campaignName, options = {}) {
  const existing = getWorld(campaignName);
  if (existing && !options.force) {
    throw new Error(`战役 "${campaignName}" 的 world.json 已存在。使用 --force 覆盖。`);
  }
  const worldDoc = defaultWorldDoc(options);
  return saveWorld(campaignName, worldDoc);
}

// ============================================================================
// 2. status 命令（输出严格 <= 15 行，玩家视图零 secret 泄露）
// ============================================================================

function summarizeList(items, formatter, limit = 3) {
  if (!Array.isArray(items) || items.length === 0) return '暂无';
  const shown = items.slice(0, limit).map(formatter).join(' | ');
  return items.length > limit ? `${shown} (+${items.length - limit}项)` : shown;
}

export function formatWorldStatus(worldDoc, { gm = false, campaign = '' } = {}) {
  validateWorldDoc(worldDoc);
  const view = filterPlayerVisible(worldDoc, { gm });
  const tracksDoc = loadTracksDoc();

  const cal = view.calendar;
  const ts = formatTimestamp(cal);
  const period = getDayPeriod(cal.hour);
  const intensity = view.meta?.worldParams?.intensity || 'standard';
  const modeTag = gm ? 'GM内档视图' : '玩家公开视图';
  const campTag = campaign ? ` | 战役: ${campaign}` : '';

  const nonTrackClocks = view.clocks.filter(c => c.kind !== 'track' && c.status === 'active');
  const trackClocks = view.clocks.filter(c => c.kind === 'track');
  const activeTracks = trackClocks.filter(c => c.status === 'active');
  const pausedTracks = trackClocks.filter(c => c.status === 'paused');
  const activeLedger = view.ledger.filter(l => l.status !== '了结');
  const aliveNpcs = view.npcs.filter(n => n.alive);
  const deadNpcs = view.npcs.filter(n => !n.alive);

  const lines = [
    `🌍 剑火纪元世界态势 [${modeTag}]${campTag}`,
    `📅 历法: ${cal.era} ${cal.year}年${cal.month}月${cal.day}日 ${String(cal.hour).padStart(2, '0')}:00 (${period}) [${ts}] | 烈度: ${intensity}`,
    `📍 地点(${view.locations.length}): ${summarizeList(view.locations, l => `${l.name}[${l.tier}]`, 3)}`,
    `🏛️ 势力(${view.factions.length}): ${summarizeList(view.factions, f => `${f.name}(态度:${f.attitude >= 0 ? '+' + f.attitude : f.attitude})`, 3)}`,
    `⏱️ 局势时钟(${nonTrackClocks.length}活跃): ${summarizeList(nonTrackClocks, c => `${c.name} ${c.current}/${c.max}(${c.cadence})`, 3)}`,
    `⚙️ 演化八线(${activeTracks.length}启动/${pausedTracks.length}待启动): ${summarizeList(activeTracks, c => `${c.name}[${getStageLabel(c, tracksDoc) || `${c.current}/${c.max}`}]`, 4)}`,
    `📒 账本(${activeLedger.length}未结/共${view.ledger.length}): ${summarizeList(activeLedger, l => `[${l.type}]${l.summary}`, 2)}`,
    `👤 人物(${aliveNpcs.length}存活/${deadNpcs.length}已故): ${summarizeList(view.npcs, n => `${n.name}(${n.alive ? '存' : '亡'},态度:${n.attitude})`, 3)}`,
    `📜 世界定论与事实(canon: ${view.canon.length}) | 街巷传闻(rumors: ${view.rumors.length})`
  ];

  if (gm) {
    const secClocks = worldDoc.clocks.filter(c => c.visibility === 'secret');
    const secLedger = worldDoc.ledger.filter(l => l.visibility === 'secret');
    const secNpcs = worldDoc.npcs.filter(n => n.visibility === 'secret');
    const npcSecrets = worldDoc.npcs.filter(n => n.secret).map(n => `${n.name}:${n.secret}`);
    lines.push(
      `🔒 [GM密档] 隐藏时钟:${summarizeList(secClocks, c => c.name, 2)} | 密账:${summarizeList(secLedger, l => l.summary, 1)} | 密探:${summarizeList(secNpcs, n => n.name, 2)} | 底牌:${summarizeList(npcSecrets, s => s, 2)}`
    );
  }

  return lines.join('\n');
}

// ============================================================================
// 3. time 命令
// ============================================================================

export function runWorldTime(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。请先运行 world.js init。`);
  }

  if (!options.advance) {
    const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
    return {
      advanced: false,
      calendar: view.calendar,
      timestamp: formatTimestamp(view.calendar),
      period: getDayPeriod(view.calendar.hour),
      world: view,
      events: [],
      linkageEvents: [],
      overdueLedger: []
    };
  }

  const res = advanceWorldTimeWithTracks(world, options.advance);
  saveWorld(campaignName, res.world);

  const gm = Boolean(options.gm);
  const visibleWorld = filterPlayerVisible(res.world, { gm });
  const visibleEvents = gm ? res.events : res.events.filter(e => e.visibility !== 'secret');
  const visibleOverdue = gm ? res.overdueLedger : res.overdueLedger.filter(l => l.visibility !== 'secret');

  return {
    advanced: true,
    deltaHours: res.deltaHours,
    calendar: visibleWorld.calendar,
    timestamp: formatTimestamp(visibleWorld.calendar),
    period: getDayPeriod(visibleWorld.calendar.hour),
    world: visibleWorld,
    events: visibleEvents,
    linkageEvents: gm ? res.linkageEvents : res.linkageEvents.filter(e => e.visibility !== 'secret'),
    overdueLedger: visibleOverdue
  };
}

// ============================================================================
// 4. clock 命令（暂停恢复为 active 时对齐 nextTick 到当前时间之后，避免补掷）
// ============================================================================

export function manageClock(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  const linkageEvents = [];

  if (options.add) {
    const id = options.id ? String(options.id).trim() : `clk:${Date.now()}`;
    if (world.clocks.some(c => c.id === id)) {
      throw new Error(`时钟 ID "${id}" 已存在`);
    }
    const name = String(options.name || id).trim();
    const kind = options.kind || 'threat';
    const cadence = options.cadence || 'day';
    const max = options.max !== undefined ? Number(options.max) : 4;
    const current = options.current !== undefined ? Number(options.current) : 0;
    const status = options.status || (current >= max ? 'completed' : 'active');
    const visibility = options.visibility || 'public';
    const nextTick = options.nextTick || computeInitialNextTick(world.calendar, cadence);

    const newClock = { id, name, kind, cadence, current, max, status, nextTick, visibility };
    world.clocks.push(newClock);
    saveWorld(campaignName, world);
    return { action: 'add', clock: newClock, world, linkageEvents };
  }

  if (options.pause || options.resume || options.cancel || options.advance !== undefined || options.status) {
    const targetId = String(options.id || options.name || '').trim();
    if (!targetId) {
      throw new Error('操作时钟须通过 --id 指定目标时钟 ID');
    }
    const clk = world.clocks.find(c => c.id === targetId || c.name === targetId);
    if (!clk) {
      throw new Error(`未找到时钟 "${targetId}"`);
    }

    const wasPaused = clk.status === 'paused';

    if (options.pause) {
      clk.status = 'paused';
    } else if (options.cancel) {
      clk.status = 'cancelled';
    } else if (options.resume || (options.status === 'active' && wasPaused)) {
      // 关键约束：暂停的时钟恢复为 active 时，必须将 nextTick 对齐到当前时间之后，避免一次补掷多次
      clk.status = clk.current >= clk.max ? 'completed' : 'active';
      if (clk.status === 'active') {
        clk.nextTick = computeInitialNextTick(world.calendar, clk.cadence);
      }
    } else if (options.status) {
      if (!CLOCK_STATUSES.includes(options.status)) {
        throw new Error(`未知时钟状态: ${options.status}`);
      }
      clk.status = options.status;
    }

    if (options.advance !== undefined) {
      const delta = Number(options.advance);
      if (!Number.isSafeInteger(delta)) {
        throw new Error(`时钟推进值必须为整数，实际: ${options.advance}`);
      }
      const before = clk.current;
      clk.current = Math.max(0, Math.min(clk.max, clk.current + delta));
      if (clk.current >= clk.max) {
        clk.status = 'completed';
      }
      if (clk.kind === 'track' && clk.current > before) {
        const triggered = applyTrackLinkagesForStep(
          world,
          clk.id,
          before,
          clk.current,
          formatTimestamp(world.calendar)
        );
        linkageEvents.push(...triggered);
      }
    }

    saveWorld(campaignName, world);
    return { action: 'update', clock: clk, world, linkageEvents };
  }

  const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
  return { action: 'list', clocks: view.clocks, world: view, linkageEvents: [] };
}

// ============================================================================
// 5. ledger 命令
// ============================================================================

export function manageLedger(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  if (options.add) {
    const id = options.id ? String(options.id).trim() : `led:${world.ledger.length + 1}`;
    if (world.ledger.some(l => l.id === id)) {
      throw new Error(`账本 ID "${id}" 已存在`);
    }
    const type = options.type || '机会';
    if (!LEDGER_TYPES.includes(type)) {
      throw new Error(`无效账本类型 "${type}" (支持: ${LEDGER_TYPES.join(', ')})`);
    }
    const summary = String(options.summary || '').trim();
    if (!summary) {
      throw new Error('新增账本记录必须提供 --summary');
    }
    const entry = {
      id,
      type,
      ...(options.debtKind ? { debtKind: options.debtKind } : {}),
      summary,
      source: options.source || '主持记录',
      relatedNpcIds: options.npcIds
        ? String(options.npcIds).split(',').map(s => s.trim()).filter(Boolean)
        : [],
      relatedFactionIds: options.factionIds
        ? String(options.factionIds).split(',').map(s => s.trim()).filter(Boolean)
        : [],
      trigger: {
        time: options.triggerTime || null,
        locationId: options.triggerLocation || null,
        event: options.triggerEvent || null
      },
      dueAt: options.dueAt || null,
      overdueConsequence: options.overdueConsequence || '',
      status: options.status || '未动',
      visibility: options.visibility || 'public'
    };
    world.ledger.push(entry);
    saveWorld(campaignName, world);
    return { action: 'add', entry, world };
  }

  if (options.update) {
    const targetId = String(options.id || '').trim();
    const entry = world.ledger.find(l => l.id === targetId);
    if (!entry) {
      throw new Error(`未找到账本记录 "${targetId}"`);
    }
    if (options.status !== undefined) entry.status = options.status;
    if (options.summary !== undefined) entry.summary = String(options.summary).trim();
    if (options.dueAt !== undefined) entry.dueAt = options.dueAt || null;
    if (options.overdueConsequence !== undefined) entry.overdueConsequence = options.overdueConsequence;
    if (options.visibility !== undefined) entry.visibility = options.visibility;
    saveWorld(campaignName, world);
    return { action: 'update', entry, world };
  }

  const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
  let list = view.ledger;
  if (options.type) list = list.filter(l => l.type === options.type);
  if (options.status) list = list.filter(l => l.status === options.status);
  return { action: 'list', ledger: list, world: view };
}

// ============================================================================
// 6. canon 命令
// ============================================================================

export function manageCanon(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  if (options.retire) {
    const targetId = String(options.id || '').trim();
    const target = world.canon.find(c => c.id === targetId);
    if (!target) {
      throw new Error(`未找到 canon 记录 "${targetId}"`);
    }
    target.validTo = options.validTo || formatTimestamp(world.calendar);
    saveWorld(campaignName, world);
    return { action: 'retire', entry: target, world, suspectedConflicts: [] };
  }

  if (options.check || options.add) {
    const candidate = {
      id: options.id ? String(options.id).trim() : `canon:${world.canon.length + 1}`,
      entityId: String(options.entityId || options.entity || '').trim(),
      predicate: String(options.predicate || '').trim(),
      value: options.value,
      validFrom: options.validFrom !== undefined ? options.validFrom : formatTimestamp(world.calendar),
      validTo: options.validTo !== undefined ? options.validTo : null,
      status: options.status || '定论',
      source: options.source || '玩家行动',
      visibility: options.visibility || 'public'
    };

    if (options.check) {
      const checkRes = checkCanonConflict(world.canon, candidate);
      return { action: 'check', candidate, ...checkRes };
    }

    const appendRes = appendCanonEntry(world.canon, candidate);
    world.canon = appendRes.canon;
    saveWorld(campaignName, world);
    return {
      action: 'add',
      entry: candidate,
      suspectedConflicts: appendRes.suspectedConflicts,
      world
    };
  }

  const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
  let list = view.canon;
  if (options.entityId || options.entity) {
    const ent = options.entityId || options.entity;
    list = list.filter(c => c.entityId === ent);
  }
  if (options.predicate) {
    list = list.filter(c => c.predicate === options.predicate);
  }
  return { action: 'list', canon: list, world: view, suspectedConflicts: [] };
}

// ============================================================================
// 7. npc 命令（支持手动新增、抽表生成、死亡保护与合法复活余波账本）
// ============================================================================

export function manageNpc(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  if (options.generate) {
    const tablesDoc = loadTablesDoc(options.tablesFile);
    const group = resolveTableGroup(tablesDoc, 'npc');
    const { index, nextRng } = drawIndexWithRng(world.rng, group.entries.length);
    world.rng = nextRng;
    const tpl = group.entries[index];

    const id = options.id || `npc:gen_${world.npcs.length + 1}`;
    const npc = {
      id,
      name: options.name || tpl.name,
      voice: options.voice || tpl.voice || '沉稳简短',
      desire: options.desire || tpl.desire || '保全自身生计',
      fear: options.fear || tpl.fear || '旧账败露',
      role: options.role || tpl.role || '居民',
      secret: options.secret || tpl.secret || '暂无深层底牌',
      attitude: options.attitude !== undefined ? Number(options.attitude) : (tpl.defaultAttitude ?? 0),
      locationId: options.locationId || options.location || world.locations[0]?.id || 'loc:greyhaven',
      alive: true,
      visibility: options.visibility || 'public'
    };
    world.npcs.push(npc);
    saveWorld(campaignName, world);

    const visibleWorld = filterPlayerVisible(world, { gm: Boolean(options.gm) });
    const visibleNpc = visibleWorld.npcs.find(n => n.id === npc.id) || null;
    return { action: 'generate', npc: visibleNpc, hidden: !visibleNpc, world: visibleWorld };
  }

  if (options.add) {
    const id = options.id ? String(options.id).trim() : `npc:${world.npcs.length + 1}`;
    if (world.npcs.some(n => n.id === id)) {
      throw new Error(`NPC ID "${id}" 已存在`);
    }
    const npc = {
      id,
      name: String(options.name || id).trim(),
      voice: String(options.voice || '平实温和').trim(),
      desire: String(options.desire || '维持现状').trim(),
      fear: String(options.fear || '卷入争端').trim(),
      role: String(options.role || '居民').trim(),
      secret: String(options.secret || '').trim(),
      attitude: options.attitude !== undefined ? Number(options.attitude) : 0,
      locationId: options.locationId || options.location || world.locations[0]?.id || 'loc:greyhaven',
      alive: options.alive !== undefined ? Boolean(options.alive !== 'false' && options.alive !== false) : true,
      visibility: options.visibility || 'public'
    };
    world.npcs.push(npc);
    saveWorld(campaignName, world);
    return { action: 'add', npc, world };
  }

  if (options.update) {
    const targetKey = String(options.id || options.name || '').trim();
    const idx = world.npcs.findIndex(n => n.id === targetKey || n.name === targetKey);
    if (idx === -1) {
      throw new Error(`未找到 NPC "${targetKey}"`);
    }
    const existing = world.npcs[idx];
    const patch = {};
    if (options.name !== undefined && options.id) patch.name = options.name;
    if (options.voice !== undefined) patch.voice = options.voice;
    if (options.desire !== undefined) patch.desire = options.desire;
    if (options.fear !== undefined) patch.fear = options.fear;
    if (options.role !== undefined) patch.role = options.role;
    if (options.secret !== undefined) patch.secret = options.secret;
    if (options.attitude !== undefined) patch.attitude = Number(options.attitude);
    if (options.locationId !== undefined || options.location !== undefined) {
      patch.locationId = options.locationId ?? options.location;
    }
    if (options.visibility !== undefined) patch.visibility = options.visibility;
    if (options.alive !== undefined) {
      patch.alive = options.alive === true || options.alive === 'true';
    }

    const allowLegalRevival = Boolean(options.revive);
    const wasDead = existing.alive === false;
    const updated = updateNpcRecord(existing, patch, { allowLegalRevival });
    world.npcs[idx] = updated;

    // SCHEMA 5.2：合法复活已故 NPC 时，自动在 world.ledger 留存政治/宗教余波账本
    if (wasDead && updated.alive === true && allowLegalRevival) {
      const reasonText = options.reviveReason || options.spell || 'D&D 2024 合法复活法术';
      world.ledger.push({
        id: `led:revive_${updated.id.replace(/[^a-zA-Z0-9_]/g, '_')}_${world.ledger.length + 1}`,
        type: '余波',
        summary: `已故人物【${updated.name}】经由「${reasonText}」死而复生，引发教会、债主或相关势力的关注与震动`,
        source: 'NPC合法复活事件',
        relatedNpcIds: [updated.id],
        relatedFactionIds: [],
        trigger: {
          time: formatTimestamp(world.calendar),
          locationId: updated.locationId || null,
          event: '人物死而复生'
        },
        dueAt: null,
        overdueConsequence: '圣座审讯官或旧日仇家上门核查复活原委',
        status: '未动',
        visibility: updated.visibility === 'secret' ? 'secret' : 'rumor'
      });
    }

    saveWorld(campaignName, world);
    return { action: 'update', npc: updated, world };
  }

  const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
  return { action: 'list', npcs: view.npcs, world: view };
}

// ============================================================================
// 8. rumor 命令（支持认知层级 tier 上限过滤与可复现抽取）
// ============================================================================

export function manageRumor(campaignName, options = {}) {
  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  if (options.add) {
    const id = options.id ? String(options.id).trim() : `rum:${world.rumors.length + 1}`;
    const tier = options.tier || '凡俗';
    if (!TIER_LEVELS.includes(tier)) {
      throw new Error(`无效传闻认知层级 "${tier}" (支持: ${TIER_LEVELS.join(', ')})`);
    }
    const text = String(options.text || '').trim();
    if (!text) {
      throw new Error('新增传闻须提供 --text');
    }
    const locationId = options.locationId || options.location || null;
    const location = world.locations.find(loc => loc.id === locationId || loc.name === locationId);
    const rumor = {
      id,
      text,
      credibility: options.credibility || '半真半假',
      tier,
      locationId,
      region: options.region || location?.region || world.meta?.region || null,
      visibility: options.visibility || 'rumor'
    };
    world.rumors.push(rumor);
    saveWorld(campaignName, world);
    return { action: 'add', rumor, world };
  }

  if (options.draw) {
    let maxTier = options.maxTier || options.tier || null;
    const locId = options.locationId || options.location;
    const location = locId ? world.locations.find(l => l.id === locId || l.name === locId) : null;
    if (!maxTier && locId) maxTier = location?.tier || '凡俗';
    if (!maxTier) maxTier = '文明';

    const maxTierIdx = TIER_LEVELS.indexOf(maxTier);
    if (maxTierIdx === -1) {
      throw new Error(`未知认知层级 "${maxTier}"`);
    }

    const tablesDoc = loadTablesDoc(options.tablesFile);
    const group = resolveTableGroup(tablesDoc, 'rumor');
    const tierPool = group.entries.filter(e => {
      const idx = TIER_LEVELS.indexOf(e.tier || '凡俗');
      return idx !== -1 && idx <= maxTierIdx;
    });
    const currentRegion = location?.region || world.meta?.region || null;
    const regionalPool = currentRegion
      ? tierPool.filter(entry => entry.region && String(entry.region).trim() === String(currentRegion).trim())
      : [];
    const globalPool = tierPool.filter(entry => !entry.region);
    const eligiblePool = regionalPool.length > 0
      ? regionalPool
      : (globalPool.length > 0 ? globalPool : tierPool);

    if (eligiblePool.length === 0) {
      throw new Error(`当前认知层级上限 [${maxTier}] 下无可用传闻条目`);
    }

    const { index, nextRng } = drawIndexWithRng(world.rng, eligiblePool.length);
    world.rng = nextRng;
    const picked = eligiblePool[index];

    let rumorEntry = world.rumors.find(r => r.id === picked.id);
    if (!rumorEntry) {
      rumorEntry = {
        id: picked.id || `rum:draw_${world.rumors.length + 1}`,
        text: picked.text,
        credibility: picked.credibility || '半真半假',
        tier: picked.tier || '凡俗',
        locationId: locId || null,
        region: picked.region || currentRegion || null,
        visibility: 'rumor'
      };
      world.rumors.push(rumorEntry);
    }

    saveWorld(campaignName, world);
    return { action: 'draw', rumor: rumorEntry, maxTier, world };
  }

  const view = filterPlayerVisible(world, { gm: Boolean(options.gm) });
  let list = view.rumors;
  if (options.tier) {
    list = list.filter(r => r.tier === options.tier);
  }
  const locId = options.locationId || options.location;
  if (locId) {
    const location = world.locations.find(loc => loc.id === locId || loc.name === locId);
    const region = location?.region || world.meta?.region || null;
    list = list.filter(r =>
      r.locationId === locId || r.locationId === location?.id ||
      (region && r.region === region) || (!r.locationId && !r.region)
    );
  }
  return { action: 'list', rumors: list, world: view };
}

// ============================================================================
// 9. oracle 命令（支持开放提问裁决与动态抽取任意 tables.json 表组，新增表零改代码）
// ============================================================================

const ORACLE_ANSWERS_BY_ROLL = Object.freeze({
  1: '否，且节外生枝（局势向不利方向升级）',
  2: '否（当前条件尚不具备）',
  3: '否，但留有转机（需付出额外周折或另寻旁门）',
  4: '是，但附带代价（伴随麻烦、损耗或欠下人情）',
  5: '是（如预期成立）',
  6: '是，且喜出望外（获得额外线索或有利先机）'
});

export function runOracle(campaignName, options = {}) {
  const tablesDoc = loadTablesDoc(options.tablesFile);
  const container = tablesDoc?.tables && typeof tablesDoc.tables === 'object' ? tablesDoc.tables : tablesDoc;

  if (options.listTables) {
    const tables = Object.entries(container).map(([key, val]) => ({
      key,
      name: val.name || key,
      count: Array.isArray(val) ? val.length : (val.entries?.length || 0)
    }));
    return { action: 'list-tables', tables };
  }

  const world = getWorld(campaignName);
  if (!world) {
    throw new Error(`未找到战役 "${campaignName}" 的 world.json。`);
  }

  const tableKey = options.table || 'omen';
  const group = resolveTableGroup(tablesDoc, tableKey);

  let roll = null;
  let answer = null;
  if (options.question || !options.table) {
    const d6Res = rollD6WithRng(world.rng);
    world.rng = d6Res.nextRng;
    const odds = String(options.odds || 'even').toLowerCase();
    let adjusted = d6Res.roll;
    if (odds === 'likely') adjusted = Math.min(6, d6Res.roll + 1);
    else if (odds === 'unlikely') adjusted = Math.max(1, d6Res.roll - 1);
    roll = adjusted;
    answer = ORACLE_ANSWERS_BY_ROLL[adjusted];
  }

  const drawRes = drawIndexWithRng(world.rng, group.entries.length);
  world.rng = drawRes.nextRng;
  const entry = group.entries[drawRes.index];
  const hiddenEntry = entry.visibility === 'secret' && !options.gm;

  saveWorld(campaignName, world);

  return {
    action: 'oracle',
    question: options.question || null,
    odds: options.odds || 'even',
    roll,
    answer,
    tableKey: group.tableKey,
    tableName: group.name,
    entry: hiddenEntry ? null : entry,
    omen: hiddenEntry ? '（隐藏结果）' : (entry.text || entry.sign || entry.title || JSON.stringify(entry)),
    world: filterPlayerVisible(world, { gm: Boolean(options.gm) })
  };
}

// ============================================================================
// CLI 解析与入口
// ============================================================================

export function parseWorldCliArgs(args) {
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
    if (arg === '--gm') options.gm = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--no-tracks') options.noTracks = true;
    else if (arg === '--no-troubles') options.noTroubles = true;
    else if (arg === '--empty') options.empty = true;
    else if (arg === '--add') options.add = true;
    else if (arg === '--update') options.update = true;
    else if (arg === '--list') options.list = true;
    else if (arg === '--pause') options.pause = true;
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--cancel') options.cancel = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--retire') options.retire = true;
    else if (arg === '--generate') options.generate = true;
    else if (arg === '--revive') options.revive = true;
    else if (arg === '--draw') options.draw = true;
    else if (arg === '--list-tables') options.listTables = true;
    else if (arg === '--seed') options.seed = requireVal(i++, '--seed');
    else if (arg === '--era') options.era = requireVal(i++, '--era');
    else if (arg === '--year') options.year = requireVal(i++, '--year');
    else if (arg === '--month') options.month = requireVal(i++, '--month');
    else if (arg === '--day') options.day = requireVal(i++, '--day');
    else if (arg === '--hour') options.hour = requireVal(i++, '--hour');
    else if (arg === '--danger') options.danger = requireVal(i++, '--danger');
    else if (arg === '--intensity') options.intensity = requireVal(i++, '--intensity');
    else if (arg === '--magic-level') options.magicLevel = requireVal(i++, '--magic-level');
    else if (arg === '--style') options.style = requireVal(i++, '--style');
    else if (arg === '--region') options.region = requireVal(i++, '--region');
    else if (arg === '--locations') options.locations = requireVal(i++, '--locations');
    else if (arg === '--factions') options.factions = requireVal(i++, '--factions');
    else if (arg === '--cost') options.cost = requireVal(i++, '--cost');
    else if (arg === '--limit') options.limit = requireVal(i++, '--limit');
    else if (arg === '--active-tracks') options.activeTracks = requireVal(i++, '--active-tracks');
    else if (arg === '--troubles') options.troubles = requireVal(i++, '--troubles');
    else if (arg === '--advance') options.advance = requireVal(i++, '--advance');
    else if (arg === '--id') options.id = requireVal(i++, '--id');
    else if (arg === '--name') options.name = requireVal(i++, '--name');
    else if (arg === '--kind') options.kind = requireVal(i++, '--kind');
    else if (arg === '--cadence') options.cadence = requireVal(i++, '--cadence');
    else if (arg === '--max') options.max = requireVal(i++, '--max');
    else if (arg === '--current') options.current = requireVal(i++, '--current');
    else if (arg === '--status') options.status = requireVal(i++, '--status');
    else if (arg === '--visibility') options.visibility = requireVal(i++, '--visibility');
    else if (arg === '--type') options.type = requireVal(i++, '--type');
    else if (arg === '--debt-kind') options.debtKind = requireVal(i++, '--debt-kind');
    else if (arg === '--summary') options.summary = requireVal(i++, '--summary');
    else if (arg === '--source') options.source = requireVal(i++, '--source');
    else if (arg === '--due-at') options.dueAt = requireVal(i++, '--due-at');
    else if (arg === '--overdue') options.overdueConsequence = requireVal(i++, '--overdue');
    else if (arg === '--npc-ids') options.npcIds = requireVal(i++, '--npc-ids');
    else if (arg === '--faction-ids') options.factionIds = requireVal(i++, '--faction-ids');
    else if (arg === '--entity' || arg === '--entity-id') options.entityId = requireVal(i++, arg);
    else if (arg === '--predicate') options.predicate = requireVal(i++, '--predicate');
    else if (arg === '--value') options.value = requireVal(i++, '--value');
    else if (arg === '--valid-from') options.validFrom = requireVal(i++, '--valid-from');
    else if (arg === '--valid-to') options.validTo = requireVal(i++, '--valid-to');
    else if (arg === '--voice') options.voice = requireVal(i++, '--voice');
    else if (arg === '--desire') options.desire = requireVal(i++, '--desire');
    else if (arg === '--fear') options.fear = requireVal(i++, '--fear');
    else if (arg === '--role') options.role = requireVal(i++, '--role');
    else if (arg === '--secret') options.secret = requireVal(i++, '--secret');
    else if (arg === '--attitude') options.attitude = requireVal(i++, '--attitude');
    else if (arg === '--location' || arg === '--location-id') {
      const val = requireVal(i++, arg);
      options.location = val;
      options.locationId = val;
    }
    else if (arg === '--alive') options.alive = requireVal(i++, '--alive');
    else if (arg === '--revive-reason' || arg === '--spell') options.reviveReason = requireVal(i++, arg);
    else if (arg === '--text') options.text = requireVal(i++, '--text');
    else if (arg === '--credibility') options.credibility = requireVal(i++, '--credibility');
    else if (arg === '--tier') options.tier = requireVal(i++, '--tier');
    else if (arg === '--max-tier') options.maxTier = requireVal(i++, '--max-tier');
    else if (arg === '--table') options.table = requireVal(i++, '--table');
    else if (arg === '--tables-file') options.tablesFile = requireVal(i++, '--tables-file');
    else if (arg === '--question') options.question = requireVal(i++, '--question');
    else if (arg === '--odds') options.odds = requireVal(i++, '--odds');
    else {
      throw new Error(`未知的命令行选项: "${arg}"`);
    }
  }

  return { command, campaign, options };
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}🌍 剑火纪元（D 模式）最小世界工具 (World Manager)${colors.reset}

用法:
  node scripts/world.js init <campaign> [--seed <N>] [--region <区域>] [--location <地点>] [--factions <势力>] [--cost <★代价>] [--limit <◆限制>] [--intensity <slow|standard|fast>] [--force]
  node scripts/world.js status <campaign> [--gm] [--json]
  node scripts/world.js time <campaign> [--advance <1h|8h|1d|1tenday|1m|1season|1y>] [--gm] [--json]
  node scripts/world.js clock <campaign> <--add|--advance <N>|--pause|--resume|--cancel|--list> [--id <id>]
  node scripts/world.js ledger <campaign> <--add|--update|--list> [--id <id>] [--type <类型>] [--summary <文>]
  node scripts/world.js canon <campaign> <--add|--check|--retire|--list> [--entity <id>] [--predicate <p>] [--value <v>]
  node scripts/world.js npc <campaign> <--add|--generate|--update|--list> [--id <id>] [--alive <true|false>] [--revive]
  node scripts/world.js rumor <campaign> <--add|--draw|--list> [--location <locId>] [--tier <层级>]
  node scripts/world.js oracle <campaign> [--question <问题>] [--odds <unlikely|even|likely>] [--table <表名>] [--list-tables]
`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let parsed;
  try {
    parsed = parseWorldCliArgs(args);
  } catch (err) {
    console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
    process.exit(1);
  }

  const { command, campaign, options } = parsed;

  try {
    if (command === 'oracle' && options.listTables) {
      const res = runOracle(campaign, options);
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log('🎲 可用随机表:');
        for (const t of res.tables) {
          console.log(`  - ${t.key}: ${t.name} (${t.count} 项)`);
        }
      }
      return;
    }

    if (!campaign) {
      throw new Error('请指定战役名称 (例如: node scripts/world.js status my-campaign)');
    }

    if (command === 'init') {
      const world = initWorld(campaign, options);
      if (options.json) {
        console.log(JSON.stringify(projectPlayerResult(world, { gm: Boolean(options.gm) }), null, 2));
      } else {
        console.log(formatWorldStatus(world, { gm: Boolean(options.gm), campaign }));
      }
    } else if (command === 'status') {
      const world = getWorld(campaign);
      if (!world) {
        throw new Error(`未找到战役 "${campaign}" 的 world.json。请先运行 init。`);
      }
      if (options.json) {
        console.log(JSON.stringify(filterPlayerVisible(world, { gm: Boolean(options.gm) }), null, 2));
      } else {
        console.log(formatWorldStatus(world, { gm: Boolean(options.gm), campaign }));
      }
    } else if (command === 'time') {
      const res = runWorldTime(campaign, options);
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`📅 当前时间: ${res.calendar.era} ${res.calendar.year}年${res.calendar.month}月${res.calendar.day}日 ${String(res.calendar.hour).padStart(2, '0')}:00 (${res.period}) [${res.timestamp}]`);
        if (res.events.length > 0) {
          console.log(`⏱️ 触发时钟结算 (${res.events.length} 项): ${res.events.map(e => `${e.clockName}(${e.before}->${e.after}/${e.max})`).join(' | ')}`);
        }
        if (res.overdueLedger.length > 0) {
          console.log(`⚠️ 逾期未结账目 (${res.overdueLedger.length} 项): ${res.overdueLedger.map(l => l.summary).join(' | ')}`);
        }
      }
    } else if (command === 'clock') {
      const res = projectPlayerResult(manageClock(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.action === 'list') {
        for (const c of res.clocks) {
          console.log(`⏱️ [${c.id}] ${c.name} (${c.kind}/${c.cadence}): ${c.current}/${c.max} [${c.status}] 下次结算:${c.nextTick}`);
        }
      } else if (res.clock) {
        console.log(`✓ 时钟 [${res.clock.id}] ${res.clock.name}: ${res.clock.current}/${res.clock.max} [${res.clock.status}] (nextTick: ${res.clock.nextTick})`);
      } else {
        console.log('✓ 时钟已更新（该时钟属于 GM 密档）');
      }
    } else if (command === 'ledger') {
      const res = projectPlayerResult(manageLedger(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.action === 'list') {
        for (const l of res.ledger) {
          console.log(`📒 [${l.id}] (${l.type}/${l.status}) ${l.summary}${l.dueAt ? ` [期限:${l.dueAt}]` : ''}`);
        }
      } else if (res.entry) {
        console.log(`✓ 账本 [${res.entry.id}] (${res.entry.type}/${res.entry.status}): ${res.entry.summary}`);
      } else {
        console.log('✓ 账本已更新（该记录属于 GM 密档）');
      }
    } else if (command === 'canon') {
      const res = projectPlayerResult(manageCanon(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.action === 'check') {
        console.log(`🔍 冲突检查: ${res.conflict ? '存在硬冲突' : '无硬冲突'} (疑似冲突: ${res.suspectedConflicts.length})`);
      } else if (res.action === 'list') {
        for (const c of res.canon) {
          console.log(`📜 [${c.id}] ${c.entityId}.${c.predicate} = ${c.value} (${c.status}, ${c.validFrom || '创世'} ~ ${c.validTo || '至今'})`);
        }
      } else if (res.entry) {
        console.log(`✓ 世界事实 [${res.entry.id}] ${res.entry.entityId}.${res.entry.predicate} = ${res.entry.value} (${res.entry.status})`);
        for (const sc of res.suspectedConflicts || []) {
          console.log(`⚠️ 疑似冲突提示: ${sc.reason}`);
        }
      } else {
        console.log('✓ 世界事实已登记（该记录属于 GM 密档）');
      }
    } else if (command === 'npc') {
      const res = projectPlayerResult(manageNpc(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.action === 'list') {
        for (const n of res.npcs) {
          console.log(`👤 [${n.id}] ${n.name} (${n.alive ? '存活' : '已故'}, 态度:${n.attitude}) 诉求:${n.desire}`);
        }
      } else if (res.npc) {
        console.log(`✓ 人物 [${res.npc.id}] ${res.npc.name} (${res.npc.alive ? '存活' : '已故'}, 态度:${res.npc.attitude}) 声线:${res.npc.voice}`);
      } else {
        console.log('✓ 人物已登记（该人物属于 GM 密档）');
      }
    } else if (command === 'rumor') {
      const res = projectPlayerResult(manageRumor(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else if (res.action === 'list') {
        for (const r of res.rumors) {
          console.log(`🗣️ [${r.id}] [${r.tier}/${r.credibility}] ${r.text}`);
        }
      } else if (res.rumor) {
        console.log(`🗣️ [${res.rumor.id}] [${res.rumor.tier}/${res.rumor.credibility}] ${res.rumor.text}`);
      } else {
        console.log('🗣️ 已登记隐藏传闻（GM 密档）');
      }
    } else if (command === 'oracle') {
      const res = projectPlayerResult(runOracle(campaign, options), { gm: Boolean(options.gm) });
      if (options.json) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        if (res.answer) {
          console.log(`🔮 裁决结果 (d6=${res.roll}): ${res.answer}`);
        }
        console.log(`🎲 [${res.tableName}]: ${res.omen}`);
      }
    } else {
      throw new Error(`未知指令 "${command}"。支持: init, status, time, clock, ledger, canon, npc, rumor, oracle`);
    }
  } catch (err) {
    console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'world.js')
);

if (isMain) {
  main();
}
