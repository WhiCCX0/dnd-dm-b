import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WORLD_SCHEMA_VERSION,
  JIANHUO_WORLD_ID,
  PERIOD_NAMES,
  CADENCE_HOURS,
  TIER_LEVELS,
  LEDGER_TYPES,
  CANON_STATUSES,
  VISIBILITY_LEVELS,
  parseTimestamp,
  formatTimestamp,
  toTotalHours,
  fromTotalHours,
  getDayPeriod,
  parseDurationHours,
  computeInitialNextTick,
  createSeededRng,
  advanceWorldTime,
  copperToCoins,
  coinsToCopper,
  formatCopper,
  validateDModeStateDoc,
  validateWorldDoc,
  filterPlayerVisible,
  updateNpcRecord,
  checkCanonConflict,
  appendCanonEntry,
  executeDualFileTx,
  recoverPendingOp
} from '../scripts/world-contract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('phase0 (SCHEMA.md) - 先决契约文档存在且覆盖全部 7 节契约与两项已定决策', () => {
  const schemaPath = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'SCHEMA.md');
  assert.ok(fs.existsSync(schemaPath), 'worlds/jianhuo/SCHEMA.md 必须存在');
  const content = fs.readFileSync(schemaPath, 'utf8');

  for (const requiredPhrase of [
    'schemaVersion: 1',
    'mode": "D"',
    'worldId": "jianhuo"',
    'pending-op.json',
    'inventory.copper',
    '已确认',
    '1 gp = 10 sp = 100 cp',
    'day',
    'tenday',
    'month',
    'season',
    'year',
    'validFrom',
    'validTo',
    '定论',
    '传说',
    '候选真相',
    'worlds/jianhuo/secret/gm-dossier.md',
    '只防 AI 误读剧透'
  ]) {
    assert.ok(content.includes(requiredPhrase), `SCHEMA.md 缺少关键契约条款: ${requiredPhrase}`);
  }
});

test('phase0 (数据结构与单一权威) - D 模式元数据、铜币无损换算、跨文件越界拦截、NPC 死亡保护与 secret 过滤', () => {
  assert.equal(WORLD_SCHEMA_VERSION, 1);
  assert.equal(JIANHUO_WORLD_ID, 'jianhuo');
  assert.deepEqual(PERIOD_NAMES, ['深夜', '黎明', '上午', '下午', '黄昏', '夜']);
  assert.deepEqual(TIER_LEVELS, ['凡俗', '文明', '超凡', '异界', '诸界']);
  assert.deepEqual(LEDGER_TYPES, ['机会', '线索', '承诺', '债', '仇怨', '秘密', '余波']);
  assert.deepEqual(CANON_STATUSES, ['定论', '传说', '候选真相']);
  assert.deepEqual(VISIBILITY_LEVELS, ['public', 'rumor', 'secret']);

  // 铜币整数记账契约
  assert.equal(coinsToCopper({ gp: 1, sp: 3, cp: 5 }), 135);
  assert.deepEqual(copperToCoins(135), { gp: 1, sp: 3, cp: 5 });
  assert.equal(formatCopper(135), '1gp 3sp 5cp');
  assert.equal(formatCopper(0), '0cp');
  assert.throws(() => coinsToCopper({ gp: -1, sp: 0, cp: 0 }), /非负整数/);
  assert.throws(() => copperToCoins(-5), /非负整数/);
  assert.throws(() => copperToCoins(1.5), /非负整数/);

  // 合法 D 模式 state.json 与越界字段拦截
  const validState = {
    meta: { mode: 'D', worldId: 'jianhuo', schemaVersion: 1 },
    party: [{ id: 'hero-1', name: '艾伦', level: 1, hp: 10, maxHp: 10 }],
    inventory: { copper: 250, items: [] },
    combat: { active: false, round: 0 }
  };
  assert.equal(validateDModeStateDoc(validState).valid, true);

  assert.throws(
    () => validateDModeStateDoc({ ...validState, clocks: [] }),
    /越界字段.*clocks/
  );
  assert.throws(
    () => validateDModeStateDoc({ ...validState, inventory: { copper: -1, items: [] } }),
    /copper/
  );
  assert.throws(
    () => validateDModeStateDoc({ ...validState, inventory: { copper: 250, gold: 2, items: [] } }),
    /gold/
  );

  // 合法 world.json 与越界字段拦截
  const validWorld = {
    meta: {
      mode: 'D',
      worldId: 'jianhuo',
      schemaVersion: 1,
      worldParams: { danger: 'standard', intensity: 'standard', magicLevel: 'standard', style: 'grounded' },
      completedOpIds: []
    },
    calendar: { era: '剑火纪', year: 142, month: 1, day: 1, hour: 8 },
    rng: createSeededRng(20261107),
    locations: [{ id: 'loc:greyhaven', name: '灰港', tier: '凡俗', visibility: 'public' }],
    factions: [{ id: 'fac:dock_guild', name: '船坞行会', attitude: 0, visibility: 'public' }],
    npcs: [
      {
        id: 'npc:old_ben',
        name: '老本恩',
        voice: '沙哑简短',
        desire: '还清船税',
        fear: '私盐败露',
        secret: '替走私客藏过账册',
        attitude: 1,
        locationId: 'loc:greyhaven',
        alive: true,
        visibility: 'public'
      },
      {
        id: 'npc:shadow_envoy',
        name: '黑烛密使',
        voice: '阴冷轻声',
        desire: '回收裂隙残片',
        fear: '身份曝光',
        secret: '直属白烛内庭',
        attitude: -2,
        locationId: 'loc:greyhaven',
        alive: true,
        visibility: 'secret'
      }
    ],
    clocks: [
      {
        id: 'clk:tax',
        name: '港务税吏封船',
        kind: 'threat',
        cadence: 'day',
        current: 1,
        max: 4,
        status: 'active',
        nextTick: 'Y0142-M01-D02T04',
        visibility: 'public'
      },
      {
        id: 'clk:secret_ritual',
        name: '地下祭坛苏醒',
        kind: 'threat',
        cadence: 'tenday',
        current: 2,
        max: 6,
        status: 'active',
        nextTick: 'Y0142-M01-D11T04',
        visibility: 'secret'
      }
    ],
    ledger: [
      {
        id: 'led:001',
        type: '债',
        debtKind: '契约',
        summary: '欠船坞行会 50sp 修船款',
        source: '开局代价',
        relatedNpcIds: ['npc:old_ben'],
        relatedFactionIds: ['fac:dock_guild'],
        trigger: { time: 'Y0142-M01-D11T04', locationId: 'loc:greyhaven', event: null },
        dueAt: 'Y0142-M01-D11T04',
        overdueConsequence: '扣押小艇并加收滞纳金',
        status: '未动',
        visibility: 'public'
      },
      {
        id: 'led:002',
        type: '秘密',
        summary: '港务官暗中向深渊走私魔晶',
        source: '设定内档',
        relatedNpcIds: [],
        relatedFactionIds: [],
        trigger: { time: null, locationId: 'loc:greyhaven', event: '查抄税库' },
        dueAt: null,
        overdueConsequence: '走私网转移据点',
        status: '推进中',
        visibility: 'secret'
      }
    ],
    canon: [],
    rumors: [
      { id: 'rum:1', text: '北境冬线今年南移了半里', credibility: '可靠', tier: '凡俗', visibility: 'rumor' },
      { id: 'rum:2', text: '白烛密使已潜入灰港', credibility: '亲见', tier: '超凡', visibility: 'secret' }
    ]
  };
  assert.equal(validateWorldDoc(validWorld).valid, true);
  assert.throws(() => validateWorldDoc({
    ...validWorld,
    rumors: [...validWorld.rumors, { ...validWorld.rumors[0] }]
  }), /rumors 出现重复 ID/);
  assert.throws(() => validateWorldDoc({
    ...validWorld,
    clocks: [{ ...validWorld.clocks[0], id: ' ' }]
  }), /clocks\[0\]\.id 必须为非空字符串/);
  assert.throws(() => validateWorldDoc({
    ...validWorld,
    rng: { seed: 0x100000000, state: 1 }
  }), /无符号 32 位整数/);
  assert.throws(() => validateWorldDoc({
    ...validWorld,
    meta: { ...validWorld.meta, completedOpIds: ['same-op', 'same-op'] }
  }), /completedOpIds 必须是最多/);
  assert.throws(() => validateWorldDoc({ ...validWorld, party: [] }), /越界字段.*party/);

  // 玩家视图默认剔除全部 secret 记录与 NPC secret 字段；GM 视图完整保留
  const playerView = filterPlayerVisible(validWorld, { gm: false });
  assert.equal(playerView.npcs.length, 1);
  assert.equal(playerView.npcs[0].id, 'npc:old_ben');
  assert.equal('secret' in playerView.npcs[0], false, '玩家视图不得暴露公开 NPC 的 secret 字段');
  assert.equal(playerView.clocks.length, 1);
  assert.equal(playerView.ledger.length, 1);
  assert.equal(playerView.rumors.length, 1);

  const gmView = filterPlayerVisible(validWorld, { gm: true });
  assert.equal(gmView.npcs.length, 2);
  assert.equal(gmView.npcs[0].secret, '替走私客藏过账册');
  assert.equal(gmView.clocks.length, 2);
  assert.equal(gmView.ledger.length, 2);

  // 死亡 NPC 保护：一旦死亡，普通更新不能改回存活
  const deadNpc = updateNpcRecord(validWorld.npcs[0], { alive: false });
  assert.equal(deadNpc.alive, false);
  assert.throws(
    () => updateNpcRecord(deadNpc, { alive: true }),
    /死亡.*复活/
  );
  const legallyRevived = updateNpcRecord(deadNpc, { alive: true }, { allowLegalRevival: true });
  assert.equal(legallyRevived.alive, true);
});

test('phase0 (时间与时钟结算) - 历法双射、拆分推进严格等价 (1d === 3x8h, 30d === 3x10d)、同种子可复现、烈度差异与 1 年上限', () => {
  assert.equal(CADENCE_HOURS.day, 24);
  assert.equal(CADENCE_HOURS.tenday, 240);
  assert.equal(CADENCE_HOURS.month, 720);
  assert.equal(CADENCE_HOURS.season, 2160);
  assert.equal(CADENCE_HOURS.year, 8640);

  // 历法与时间戳双射校验
  const ts = { era: '剑火纪', year: 142, month: 12, day: 30, hour: 23 };
  const formatted = formatTimestamp(ts);
  assert.equal(formatted, 'Y0142-M12-D30T23');
  assert.equal(getDayPeriod(23), '夜');
  assert.equal(getDayPeriod(2), '深夜');
  assert.equal(getDayPeriod(4), '黎明');
  assert.equal(getDayPeriod(9), '上午');
  assert.equal(getDayPeriod(14), '下午');
  assert.equal(getDayPeriod(18), '黄昏');

  const nextHour = fromTotalHours(toTotalHours(ts) + 1, '剑火纪');
  assert.deepEqual(nextHour, { era: '剑火纪', year: 143, month: 1, day: 1, hour: 0 });
  assert.deepEqual(parseTimestamp('Y0143-M01-D01T00', '剑火纪'), nextHour);

  // 时长解析与 1 年硬上限
  assert.equal(parseDurationHours('1h'), 1);
  assert.equal(parseDurationHours('8h'), 8);
  assert.equal(parseDurationHours('1d'), 24);
  assert.equal(parseDurationHours('1tenday'), 240);
  assert.equal(parseDurationHours('1m'), 720);
  assert.equal(parseDurationHours('1y'), 8640);
  assert.throws(() => parseDurationHours('0h'), /正整数|大于 0/);
  assert.throws(() => parseDurationHours('361d'), /上限.*1 年/);

  const makeTestWorld = (seed = 424242, intensity = 'standard') => {
    const startCal = { era: '剑火纪', year: 142, month: 1, day: 1, hour: 8 };
    return {
      meta: {
        mode: 'D',
        worldId: 'jianhuo',
        schemaVersion: 1,
        worldParams: { danger: 'standard', intensity, magicLevel: 'standard', style: 'grounded' },
        completedOpIds: []
      },
      calendar: startCal,
      rng: createSeededRng(seed),
      locations: [],
      factions: [],
      npcs: [],
      clocks: [
        {
          id: 'clk:daily_hunt',
          name: '追兵搜山',
          kind: 'threat',
          cadence: 'day',
          current: 0,
          max: 100,
          status: 'active',
          nextTick: computeInitialNextTick(startCal, 'day'),
          visibility: 'public'
        },
        {
          id: 'clk:tenday_grain',
          name: '浮空塔缺粮',
          kind: 'track',
          cadence: 'tenday',
          current: 0,
          max: 100,
          status: 'active',
          nextTick: computeInitialNextTick(startCal, 'tenday'),
          visibility: 'public'
        },
        {
          id: 'clk:month_trade',
          name: '商路改道',
          kind: 'faction',
          cadence: 'month',
          current: 0,
          max: 100,
          status: 'active',
          nextTick: computeInitialNextTick(startCal, 'month'),
          visibility: 'public'
        }
      ],
      ledger: [],
      canon: [],
      rumors: []
    };
  };

  // 1) 短休推进 1 小时只走日历，不额外掷骰
  const wShort = makeTestWorld(99);
  const initialRngState = wShort.rng.state;
  const shortRes = advanceWorldTime(wShort, '1h');
  assert.equal(shortRes.events.length, 0);
  assert.equal(shortRes.world.calendar.hour, 9);
  assert.equal(shortRes.world.rng.state, initialRngState, '未跨过 nextTick 时不得消耗随机数');

  // 2) 拆分等价：一次推进 1d === 连续三次推进 8h === 连续二十四次推进 1h
  const wOneDay = advanceWorldTime(makeTestWorld(2026), '1d');
  let wThreeEightHours = makeTestWorld(2026);
  const splitEvents = [];
  for (let i = 0; i < 3; i++) {
    const step = advanceWorldTime(wThreeEightHours, '8h');
    wThreeEightHours = step.world;
    splitEvents.push(...step.events);
  }
  assert.deepEqual(wThreeEightHours.calendar, wOneDay.world.calendar);
  assert.equal(wThreeEightHours.rng.state, wOneDay.world.rng.state);
  assert.deepEqual(wThreeEightHours.clocks, wOneDay.world.clocks);
  assert.deepEqual(splitEvents, wOneDay.events);

  // 3) 30 天长跨度可复现与拆分等价：一次 30d === 三次 10d === 三十次 1d
  const w30Once = advanceWorldTime(makeTestWorld(77777), '30d');
  const w30Repeat = advanceWorldTime(makeTestWorld(77777), '30d');
  assert.deepEqual(w30Once, w30Repeat, '同种子推进 30 天结果必须 100% 可复现');

  let w30ByDay = makeTestWorld(77777);
  const dayEvents = [];
  for (let d = 0; d < 30; d++) {
    const step = advanceWorldTime(w30ByDay, '1d');
    w30ByDay = step.world;
    dayEvents.push(...step.events);
  }
  assert.deepEqual(w30ByDay.calendar, w30Once.world.calendar);
  assert.equal(w30ByDay.rng.state, w30Once.world.rng.state);
  assert.deepEqual(w30ByDay.clocks, w30Once.world.clocks);
  assert.deepEqual(dayEvents, w30Once.events);

  // 4) 慢 / 标准 / 快 三种烈度在 30 天推进中速度有严格单调差异
  const slowEnd = advanceWorldTime(makeTestWorld(123456, 'slow'), '30d').world.clocks[0].current;
  const stdEnd = advanceWorldTime(makeTestWorld(123456, 'standard'), '30d').world.clocks[0].current;
  const fastEnd = advanceWorldTime(makeTestWorld(123456, 'fast'), '30d').world.clocks[0].current;
  assert.ok(slowEnd < stdEnd && stdEnd < fastEnd, `慢(${slowEnd}) < 标准(${stdEnd}) < 快(${fastEnd}) 推进格数须严格递增`);
});

test('phase0 (双文件事务与中断恢复) - pending-op.json 原子提交、两类中断点恢复与 opId 幂等不重复执行', () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-p0-tx-'));
  try {
    const statePath = path.join(sessionDir, 'state.json');
    const worldPath = path.join(sessionDir, 'world.json');
    const pendingPath = path.join(sessionDir, 'pending-op.json');

    const initState = {
      meta: { mode: 'D', worldId: 'jianhuo', schemaVersion: 1 },
      party: [{ id: 'p1', name: '瓦伦', level: 1, hp: 5, maxHp: 12 }],
      inventory: { copper: 100, items: [] },
      combat: { active: false, round: 0 }
    };
    const initWorld = {
      meta: {
        mode: 'D',
        worldId: 'jianhuo',
        schemaVersion: 1,
        worldParams: { danger: 'standard', intensity: 'standard', magicLevel: 'standard', style: 'grounded' },
        completedOpIds: []
      },
      calendar: { era: '剑火纪', year: 142, month: 1, day: 1, hour: 22 },
      rng: createSeededRng(888),
      locations: [],
      factions: [],
      npcs: [],
      clocks: [
        {
          id: 'clk:night_watch',
          name: '宵禁巡逻逼近',
          kind: 'threat',
          cadence: 'day',
          current: 1,
          max: 6,
          status: 'active',
          nextTick: 'Y0142-M01-D02T04',
          visibility: 'public'
        }
      ],
      ledger: [],
      canon: [],
      rumors: []
    };

    fs.writeFileSync(statePath, JSON.stringify(initState, null, 2) + '\n', 'utf8');
    fs.writeFileSync(worldPath, JSON.stringify(initWorld, null, 2) + '\n', 'utf8');
    // 故意放入陈旧 .bak（验证回滚不会误回退到更老一轮的古董 .bak！）
    fs.writeFileSync(`${statePath}.bak`, JSON.stringify({ stale: true }), 'utf8');
    fs.writeFileSync(`${worldPath}.bak`, JSON.stringify({ stale: true }), 'utf8');

    // 中断点 A：state.json 已写入新版，但在写 world.json 前崩溃
    assert.throws(() => {
      executeDualFileTx({
        sessionDir,
        opId: 'op-crash-midway',
        action: 'rest:long',
        mutate: (s, w) => {
          const nextS = structuredClone(s);
          nextS.party[0].hp = 12;
          const nextW = advanceWorldTime(w, '8h').world;
          return { nextState: nextS, nextWorld: nextW };
        },
        _simulateCrashAfterStateWrite: true
      });
    }, /SIMULATED_CRASH_AFTER_STATE_WRITE/);

    assert.ok(fs.existsSync(pendingPath), '中断后 pending-op.json 应仍留在磁盘上');
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).party[0].hp, 12, '中断瞬间 state.json 已是半写新版');
    assert.equal(JSON.parse(fs.readFileSync(worldPath, 'utf8')).calendar.hour, 22, '中断瞬间 world.json 仍是旧版');

    // 启动恢复：必须回滚两边至本次写前状态（HP=5, hour=22），绝不能误用陈旧 { stale: true }！
    const recA = recoverPendingOp(sessionDir);
    assert.equal(recA.recovered, true);
    assert.equal(recA.outcome, 'rolled_back');
    assert.ok(recA.message.includes('回滚'), '恢复报告必须包含明确回滚说明');
    assert.equal(fs.existsSync(pendingPath), false, '恢复完成后必须清理 pending-op.json');
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).party[0].hp, 5);
    assert.equal(JSON.parse(fs.readFileSync(worldPath, 'utf8')).calendar.hour, 22);

    // 中断点 B：state.json 与 world.json 均已写入新版，但在删除 pending-op.json 前崩溃
    assert.throws(() => {
      executeDualFileTx({
        sessionDir,
        opId: 'op-crash-before-unlink',
        action: 'rest:long',
        mutate: (s, w) => {
          const nextS = structuredClone(s);
          nextS.party[0].hp = 12;
          const nextW = advanceWorldTime(w, '8h').world;
          return { nextState: nextS, nextWorld: nextW };
        },
        _simulateCrashBeforeUnlink: true
      });
    }, /SIMULATED_CRASH_BEFORE_UNLINK/);

    assert.ok(fs.existsSync(pendingPath));
    const recB = recoverPendingOp(sessionDir);
    assert.equal(recB.recovered, true);
    assert.equal(recB.outcome, 'committed_clean');
    assert.equal(fs.existsSync(pendingPath), false);
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).party[0].hp, 12);
    assert.equal(JSON.parse(fs.readFileSync(worldPath, 'utf8')).calendar.day, 2);
    assert.equal(JSON.parse(fs.readFileSync(worldPath, 'utf8')).calendar.hour, 6);

    // 幂等校验：重复提交已完成的 op-crash-before-unlink，绝不二次推进时间或报错破坏状态
    const dupRes = executeDualFileTx({
      sessionDir,
      opId: 'op-crash-before-unlink',
      action: 'rest:long',
      mutate: (s, w) => {
        const nextS = structuredClone(s);
        nextS.inventory.copper += 999;
        const nextW = advanceWorldTime(w, '8h').world;
        return { nextState: nextS, nextWorld: nextW };
      }
    });
    assert.equal(dupRes.skipped, true);
    assert.equal(dupRes.reason, 'duplicate_op_id');
    assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).inventory.copper, 100);
    assert.equal(JSON.parse(fs.readFileSync(worldPath, 'utf8')).calendar.hour, 6);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('phase0 (canon 冲突检测) - 重叠时间段双定论硬拒绝、王朝更替无缝衔接、传说共存与疑似冲突提示', () => {
  let canonList = [];

  // 1) 写入旧王朝统治定论（无失效期）
  canonList = appendCanonEntry(canonList, {
    id: 'canon-001',
    entityId: 'kingdom:oren',
    predicate: '统治者',
    value: '亨利克三世',
    validFrom: 'Y0120-M01-D01T00',
    validTo: null,
    status: '定论',
    source: '设定切片',
    visibility: 'public'
  }).canon;

  // 2) 同一实体+同一谓词在重叠时间段直接写入不同定论 -> 必须硬拒绝！
  const conflictCheck = checkCanonConflict(canonList, {
    id: 'canon-002',
    entityId: 'kingdom:oren',
    predicate: '统治者',
    value: '篡位者马库斯',
    validFrom: 'Y0142-M05-D10T12',
    validTo: null,
    status: '定论',
    source: '玩家行动',
    visibility: 'public'
  });
  assert.equal(conflictCheck.conflict, true, '重叠时间段出现两个不同定论必须判定冲突');
  assert.throws(
    () => appendCanonEntry(canonList, {
      id: 'canon-002',
      entityId: 'kingdom:oren',
      predicate: '统治者',
      value: '篡位者马库斯',
      validFrom: 'Y0142-M05-D10T12',
      validTo: null,
      status: '定论',
      source: '玩家行动',
      visibility: 'public'
    }),
    /canon 定论冲突/
  );

  // 3) 给旧定论补填 validTo 后，在同一时间点无缝写入新统治者定论 -> 左闭右开区间不重叠，合法通过！
  canonList = canonList.map(c => c.id === 'canon-001' ? { ...c, validTo: 'Y0142-M05-D10T12' } : c);
  const successionRes = appendCanonEntry(canonList, {
    id: 'canon-002',
    entityId: 'kingdom:oren',
    predicate: '统治者',
    value: '篡位者马库斯',
    validFrom: 'Y0142-M05-D10T12',
    validTo: null,
    status: '定论',
    source: '玩家行动',
    visibility: 'public'
  });
  canonList = successionRes.canon;
  assert.equal(canonList.length, 2);

  // 4) 同一时间段写入“传说”或“候选真相”与现有“定论”不同 -> 允许共存，但返回 suspectedConflicts 提示 GM
  const rumorRes = appendCanonEntry(canonList, {
    id: 'canon-003',
    entityId: 'kingdom:oren',
    predicate: '统治者',
    value: '先王遗孤仍在秘境监国',
    validFrom: 'Y0142-M05-D10T12',
    validTo: null,
    status: '传说',
    source: '生成',
    visibility: 'rumor'
  });
  assert.equal(rumorRes.canon.length, 3);
  assert.ok(rumorRes.suspectedConflicts.length >= 1, '传说与同区间定论异值时应返回疑似冲突供 GM 判断');

  // 5) 实体已被定论标记为“已毁灭”后，又在后续时间添加新属性定论 -> 放行但返回疑似冲突告警
  let ruinCanon = appendCanonEntry([], {
    id: 'canon-010',
    entityId: 'loc:sky_spire',
    predicate: '存亡',
    value: '已毁灭',
    validFrom: 'Y0140-M01-D01T00',
    validTo: null,
    status: '定论',
    source: '设定切片',
    visibility: 'public'
  }).canon;

  const afterRuin = appendCanonEntry(ruinCanon, {
    id: 'canon-011',
    entityId: 'loc:sky_spire',
    predicate: '城主',
    value: '奥术导师维拉',
    validFrom: 'Y0142-M01-D01T00',
    validTo: null,
    status: '定论',
    source: '玩家提出',
    visibility: 'public'
  });
  assert.ok(afterRuin.suspectedConflicts.length >= 1, '已毁灭实体新增定论时应提示疑似冲突');
});
