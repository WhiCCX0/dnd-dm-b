import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  toTotalHours,
  formatTimestamp,
  recoverPendingOp
} from '../scripts/world-contract.js';

import {
  initWorld,
  getWorld,
  formatWorldStatus,
  runWorldTime,
  manageClock,
  manageLedger,
  manageCanon,
  manageNpc,
  manageRumor,
  runOracle
} from '../scripts/world.js';

import {
  initSession,
  getState,
  updateState,
  applyRest,
  getSessionPath
} from '../scripts/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORLD_SCRIPT = path.join(ROOT_DIR, 'scripts', 'world.js');
const STATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'state.js');
const TRACKS_PATH = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'tracks.json');
const TABLES_PATH = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'tables.json');

const TEMP_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-p2-sessions-'));
process.env.DND_SESSIONS_DIR = TEMP_SESSIONS_DIR;
process.env.SESSIONS_DIR = TEMP_SESSIONS_DIR;

const SECRET_CALAMITY_NAMES = ['冬线南移', '渊喉巨脉', '苍穹脱缰'];

test.after(() => {
  if (fs.existsSync(TEMP_SESSIONS_DIR)) {
    fs.rmSync(TEMP_SESSIONS_DIR, { recursive: true, force: true });
  }
});

function cleanCampaign(name) {
  const dir = path.join(TEMP_SESSIONS_DIR, name);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('phase2 (tracks.json 与 tables.json) - 演化八线刻度完整、少量写死联动、4 组初版随机表且无三大劫剧透词', () => {
  assert.ok(fs.existsSync(TRACKS_PATH), 'worlds/jianhuo/tracks.json 必须存在');
  assert.ok(fs.existsSync(TABLES_PATH), 'worlds/jianhuo/tables.json 必须存在');

  const tracksRaw = fs.readFileSync(TRACKS_PATH, 'utf8');
  const tablesRaw = fs.readFileSync(TABLES_PATH, 'utf8');

  for (const secretTerm of SECRET_CALAMITY_NAMES) {
    assert.equal(
      tracksRaw.includes(secretTerm),
      false,
      `tracks.json 不得包含内档三大劫名称 "${secretTerm}"`
    );
    assert.equal(
      tablesRaw.includes(secretTerm),
      false,
      `tables.json 不得包含内档三大劫名称 "${secretTerm}"`
    );
  }

  const tracksDoc = JSON.parse(tracksRaw);
  assert.equal(tracksDoc.worldId, 'jianhuo');
  assert.ok(Array.isArray(tracksDoc.tracks), 'tracks.json.tracks 必须为数组');
  assert.equal(tracksDoc.tracks.length, 8, '演化八线必须完整包含 8 条演化线');

  const expectedTrackNames = [
    '战争',
    '王位更替',
    '教会分裂',
    '学院新论',
    '魔法技术',
    '魔兽迁徙',
    '魔族动向',
    '商路兴衰'
  ];
  assert.deepEqual(
    tracksDoc.tracks.map(t => t.name),
    expectedTrackNames,
    '演化八线名称必须与卷二设定完全一致'
  );

  for (const trk of tracksDoc.tracks) {
    assert.ok(Array.isArray(trk.stages) && trk.stages.length >= 4, `${trk.name} 阶段刻度不应少于 4 个`);
    assert.equal(trk.max, trk.stages.length - 1, `${trk.name} 的 max 应等于 stages.length - 1`);
  }

  assert.ok(
    Array.isArray(tracksDoc.linkages) && tracksDoc.linkages.length >= 3 && tracksDoc.linkages.length <= 8,
    'tracks.json 应包含少量写死的跨线联动规则'
  );

  const tablesDoc = JSON.parse(tablesRaw);
  assert.equal(tablesDoc.worldId, 'jianhuo');
  assert.ok(tablesDoc.tables && typeof tablesDoc.tables === 'object');
  const tableKeys = Object.keys(tablesDoc.tables);
  assert.equal(tableKeys.length, 4, 'tables.json 初版应包含 4 组剑火风味随机表');
  for (const key of tableKeys) {
    const group = tablesDoc.tables[key];
    assert.ok(Array.isArray(group.entries) && group.entries.length >= 6, `随机表 "${key}" 至少包含 6 条表项`);
  }
});

test('phase2 (world.js init 与 status) - 输出严格控制在 15 行以内，玩家视图零 secret 泄露，GM 视图完整呈现', () => {
  const campaign = 'p2-status-test';
  cleanCampaign(campaign);

  const world = initWorld(campaign, { seed: 20261107 });
  assert.equal(world.meta.mode, 'D');
  assert.equal(world.meta.worldId, 'jianhuo');
  assert.equal(world.clocks.filter(c => c.kind === 'track').length, 8, '默认应挂载演化八线时钟');

  // 注入公开项与机密项（含公开 NPC 的 secret 底牌、纯 secret NPC、secret 时钟、secret 账本、secret 传闻）
  manageClock(campaign, {
    add: true,
    id: 'clk:pub_tax',
    name: '灰港加征船坞税',
    kind: 'threat',
    cadence: 'day',
    max: 4,
    current: 1,
    visibility: 'public'
  });
  manageClock(campaign, {
    add: true,
    id: 'clk:sec_ritual',
    name: '机密黑烛地窖祭礼',
    kind: 'threat',
    cadence: 'tenday',
    max: 6,
    current: 2,
    visibility: 'secret'
  });

  manageLedger(campaign, {
    add: true,
    id: 'led:pub_debt',
    type: '债',
    debtKind: '契约',
    summary: '欠铁锚船坞 80sp 修船契约款',
    dueAt: 'Y0142-M01-D10T04',
    overdueConsequence: '扣留货船',
    visibility: 'public'
  });
  manageLedger(campaign, {
    add: true,
    id: 'led:sec_plot',
    type: '秘密',
    summary: '机密账目：港务官私吞祭坛灰铁',
    visibility: 'secret'
  });

  manageNpc(campaign, {
    add: true,
    id: 'npc:pub_smith',
    name: '老铁匠巴隆',
    voice: '粗哑洪亮',
    desire: '赎回学徒契书',
    fear: '炉火熄灭',
    secret: '巴隆的机密底牌：曾替叛军打造私械',
    attitude: 1,
    locationId: 'loc:greyhaven',
    alive: true,
    visibility: 'public'
  });
  manageNpc(campaign, {
    add: true,
    id: 'npc:sec_spy',
    name: '密探夜枭',
    voice: '低沉无声',
    desire: '窃取航道图',
    fear: '真名暴露',
    secret: '夜枭的机密底牌：隶属暗影残页',
    attitude: -2,
    locationId: 'loc:greyhaven',
    alive: true,
    visibility: 'secret'
  });

  manageRumor(campaign, {
    add: true,
    id: 'rum:sec_1',
    text: '机密传闻：地下密道直通审判所地牢',
    credibility: '亲见',
    tier: '超凡',
    visibility: 'secret'
  });

  const updatedWorld = getWorld(campaign);

  // 1) 玩家视图：行数 <= 15，且严禁出现任何 secret 内容或公开 NPC 的 secret 字段
  const playerStatus = formatWorldStatus(updatedWorld, { gm: false, campaign });
  const playerLines = playerStatus.trim().split('\n');
  assert.ok(
    playerLines.length <= 15,
    `world status 玩家视图行数必须 <= 15，实际为 ${playerLines.length} 行:\n${playerStatus}`
  );
  assert.ok(playerStatus.includes('灰港加征船坞税'));
  assert.ok(playerStatus.includes('欠铁锚船坞 80sp'));
  assert.ok(playerStatus.includes('老铁匠巴隆'));
  assert.equal(playerStatus.includes('机密黑烛地窖祭礼'), false, '玩家视图不得泄露 secret 时钟');
  assert.equal(playerStatus.includes('港务官私吞祭坛灰铁'), false, '玩家视图不得泄露 secret 账本');
  assert.equal(playerStatus.includes('密探夜枭'), false, '玩家视图不得泄露 secret NPC');
  assert.equal(playerStatus.includes('曾替叛军打造私械'), false, '玩家视图不得泄露公开 NPC 的 secret 字段');
  assert.equal(playerStatus.includes('地下密道直通审判所地牢'), false, '玩家视图不得泄露 secret 传闻');

  // 2) GM 视图：行数同样 <= 15，且展示机密摘要
  const gmStatus = formatWorldStatus(updatedWorld, { gm: true, campaign });
  const gmLines = gmStatus.trim().split('\n');
  assert.ok(
    gmLines.length <= 15,
    `world status --gm 视图行数必须 <= 15，实际为 ${gmLines.length} 行:\n${gmStatus}`
  );
  assert.ok(gmStatus.includes('机密黑烛地窖祭礼') || gmStatus.includes('GM'));
  assert.ok(gmStatus.includes('曾替叛军打造私械'));
});

test('phase2 (world.js clock 与 time) - 暂停时钟恢复为 active 时对齐 nextTick 到当前时间之后，避免补掷；演化八线联动与拆分推进等价', () => {
  const campaign = 'p2-clock-resume-test';
  cleanCampaign(campaign);

  initWorld(campaign, { seed: 987654, noTracks: true });
  manageClock(campaign, {
    add: true,
    id: 'clk:hunt',
    name: '荒原追兵',
    kind: 'threat',
    cadence: 'day',
    max: 10,
    current: 1,
    visibility: 'public'
  });

  // 暂停该每日时钟
  manageClock(campaign, { pause: true, id: 'clk:hunt' });
  let w = getWorld(campaign);
  const pausedClk = w.clocks.find(c => c.id === 'clk:hunt');
  assert.equal(pausedClk.status, 'paused');
  const oldNextTick = pausedClk.nextTick; // Y0142-M01-D02T04

  // 推进 10 天：暂停期间不得触发任何结算
  const step10d = runWorldTime(campaign, { advance: '10d' });
  assert.equal(step10d.events.length, 0, '暂停中的时钟在推进 10d 期间不得掷骰');
  assert.equal(step10d.world.calendar.day, 11);

  // 恢复为 active：nextTick 必须对齐到当前时间 (Y0142-M01-D11T08) 之后，即 Y0142-M01-D12T04
  manageClock(campaign, { resume: true, id: 'clk:hunt' });
  w = getWorld(campaign);
  const resumedClk = w.clocks.find(c => c.id === 'clk:hunt');
  assert.equal(resumedClk.status, 'active');
  assert.notEqual(resumedClk.nextTick, oldNextTick);
  assert.ok(
    toTotalHours(resumedClk.nextTick) > toTotalHours(w.calendar),
    `恢复后的 nextTick (${resumedClk.nextTick}) 必须晚于当前时间 (${formatTimestamp(w.calendar)})`
  );
  assert.equal(resumedClk.nextTick, 'Y0142-M01-D12T04');

  // 再推进 1 小时：绝不触发补掷！
  const step1h = runWorldTime(campaign, { advance: '1h' });
  assert.equal(step1h.events.length, 0, '恢复后推进 1h 不得补掷过去 10 天的漏骰');
  assert.equal(step1h.world.clocks.find(c => c.id === 'clk:hunt').current, 1);

  // 测试演化八线写死联动与拆分推进等价：
  // 1) 手动将【魔兽迁徙】推进到阶段 2（跨区域大迁徙），验证触发对【战争】的写死联动 (+1)
  const trackCamp = 'p2-track-linkage-test';
  cleanCampaign(trackCamp);
  initWorld(trackCamp, { seed: 2026, intensity: 'fast' });
  const beforeWar = getWorld(trackCamp).clocks.find(c => c.id === 'track:war').current;
  const advRes = manageClock(trackCamp, { advance: 2, id: 'track:migration' });
  const afterWorld = advRes.world;
  const afterMigration = afterWorld.clocks.find(c => c.id === 'track:migration').current;
  const afterWar = afterWorld.clocks.find(c => c.id === 'track:war').current;
  assert.equal(afterMigration, 2);
  assert.equal(afterWar, beforeWar + 1, '魔兽迁徙跨入阶段 2 应自动触发写死联动使战争线 +1');
  assert.ok(advRes.linkageEvents.length >= 1, '应返回触发的联动事件记录');

  // 2) 时间推进中包含演化八线与联动时，一次推进 90d === 三次推进 30d 严格等价
  const eqCampA = 'p2-track-eq-a';
  const eqCampB = 'p2-track-eq-b';
  cleanCampaign(eqCampA);
  cleanCampaign(eqCampB);
  initWorld(eqCampA, { seed: 77777, intensity: 'fast' });
  initWorld(eqCampB, { seed: 77777, intensity: 'fast' });

  const once90 = runWorldTime(eqCampA, { advance: '90d' });
  const splitEvents = [];
  let splitWorld = null;
  for (let i = 0; i < 3; i++) {
    const step = runWorldTime(eqCampB, { advance: '30d' });
    splitWorld = step.world;
    splitEvents.push(...step.events);
  }
  assert.deepEqual(splitWorld.calendar, once90.world.calendar);
  assert.equal(splitWorld.rng.state, once90.world.rng.state);
  assert.deepEqual(splitWorld.clocks, once90.world.clocks);
  assert.deepEqual(splitEvents, once90.events);
});

test('phase2 (world.js canon 与 ledger) - 定论冲突硬拒绝、无缝退位衔接、疑似冲突告警与账本逾期提醒', () => {
  const campaign = 'p2-canon-ledger-test';
  cleanCampaign(campaign);
  initWorld(campaign, { seed: 10101 });

  // 1) 新增定论
  manageCanon(campaign, {
    add: true,
    id: 'canon:ruler_1',
    entityId: 'faction:holy_seat',
    predicate: '执政教宗',
    value: '庇护七世',
    validFrom: 'Y0130-M01-D01T00',
    validTo: null,
    status: '定论',
    source: '设定切片',
    visibility: 'public'
  });

  // 2) 重叠时间段写入不同定论 -> 必须抛错拒绝
  assert.throws(
    () => manageCanon(campaign, {
      add: true,
      id: 'canon:ruler_2',
      entityId: 'faction:holy_seat',
      predicate: '执政教宗',
      value: '灰衣枢机瓦伦丁',
      validFrom: 'Y0142-M01-D01T08',
      validTo: null,
      status: '定论',
      source: '玩家行动',
      visibility: 'public'
    }),
    /canon 定论冲突/
  );

  // 3) 使用 retire 将旧定论在当前时间截断，再写入新定论 -> 无缝衔接成功
  manageCanon(campaign, {
    retire: true,
    id: 'canon:ruler_1'
  });
  const addSuccess = manageCanon(campaign, {
    add: true,
    id: 'canon:ruler_2',
    entityId: 'faction:holy_seat',
    predicate: '执政教宗',
    value: '灰衣枢机瓦伦丁',
    validFrom: 'Y0142-M01-D01T08',
    validTo: null,
    status: '定论',
    source: '玩家行动',
    visibility: 'public'
  });
  assert.equal(addSuccess.world.canon.length, 2);

  // 4) 写入同区间传说 -> 允许共存但返回 suspectedConflicts
  const rumorCanon = manageCanon(campaign, {
    add: true,
    id: 'canon:ruler_rumor',
    entityId: 'faction:holy_seat',
    predicate: '执政教宗',
    value: '前教宗替身傀儡',
    validFrom: 'Y0142-M01-D01T08',
    validTo: null,
    status: '传说',
    source: '生成',
    visibility: 'rumor'
  });
  assert.ok(rumorCanon.suspectedConflicts.length >= 1);

  // 5) 账本登记与到期提醒
  manageLedger(campaign, {
    add: true,
    id: 'led:loan_1',
    type: '债',
    debtKind: '契约',
    summary: '3天内向灰港税吏缴纳 20sp 滞纳金',
    dueAt: 'Y0142-M01-D02T00',
    overdueConsequence: '税吏带卫兵查封旅店房间',
    visibility: 'public'
  });
  const timeRes = runWorldTime(campaign, { advance: '1d' });
  assert.ok(
    timeRes.overdueLedger.some(item => item.id === 'led:loan_1'),
    '跨过 dueAt 后 time 推进结果应提示逾期未了结账本项'
  );
});

test('phase2 (world.js npc, rumor 与 oracle) - 抽表生成、死亡保护与合法复活余波账本、认知层级 tier 过滤、新增表零改代码', () => {
  const campaign = 'p2-npc-rumor-oracle';
  cleanCampaign(campaign);
  initWorld(campaign, { seed: 20260505 });

  // 1) 抽表生成 NPC（默认玩家态返回剥离 secret，落盘 world.json 完整保留 secret）
  const genRes = manageNpc(campaign, {
    generate: true,
    locationId: 'loc:greyhaven'
  });
  const npc = genRes.npc;
  assert.ok(npc.id && npc.name && npc.voice && npc.desire && npc.fear);
  assert.equal('secret' in npc, false, '未传 gm:true 时返回视图应剥离 NPC secret');
  const savedNpc = getWorld(campaign).npcs.find(n => n.id === npc.id);
  assert.ok(savedNpc.secret, '落盘到 world.json 的 NPC 必须完整保留 secret 底牌');
  assert.equal(npc.alive, true);

  // 2) NPC 死亡保护与合法复活自动写余波账本
  manageNpc(campaign, {
    update: true,
    id: npc.id,
    alive: false
  });
  assert.equal(getWorld(campaign).npcs.find(n => n.id === npc.id).alive, false);

  assert.throws(
    () => manageNpc(campaign, {
      update: true,
      id: npc.id,
      alive: true
    }),
    /已死亡.*复活/
  );

  const reviveRes = manageNpc(campaign, {
    update: true,
    id: npc.id,
    alive: true,
    revive: true,
    reviveReason: '圣座高阶牧师施展死者复活'
  });
  assert.equal(reviveRes.npc.alive, true);
  assert.ok(
    reviveRes.world.ledger.some(l => l.type === '余波' && l.relatedNpcIds.includes(npc.id)),
    '合法复活已故 NPC 时必须自动在 world.ledger 登记一条【余波】记录'
  );

  // 3) 传闻按地点认知层级 (tier) 过滤：凡俗地点 (loc:greyhaven) 抽不出超凡/异界/诸界传闻
  for (let i = 0; i < 5; i++) {
    const drawRes = manageRumor(campaign, {
      draw: true,
      locationId: 'loc:greyhaven'
    });
    assert.equal(drawRes.rumor.tier, '凡俗', '凡俗层级地点抽取的传闻不得超出凡俗层级');
  }

  // 4) Oracle 提问与新增第 5 组随机表“零改代码”验证
  const oracleRes = runOracle(campaign, {
    question: '今晚渡口是否有走私船靠岸？',
    odds: 'likely'
  });
  assert.ok(oracleRes.roll >= 1 && oracleRes.roll <= 6);
  assert.ok(oracleRes.answer);
  assert.ok(oracleRes.omen);

  // 动态复制 tables.json 并追加第 5 组新表 custom_weather，不改一行 world.js 代码直接调用
  const tmpTablesFile = path.join(TEMP_SESSIONS_DIR, 'custom-tables.json');
  const baseTables = JSON.parse(fs.readFileSync(TABLES_PATH, 'utf8'));
  baseTables.tables.custom_weather = {
    name: '剑火边疆天象异变表',
    description: '测试新增第 5 组表不改代码',
    entries: [
      { id: 'w1', text: '铅灰冻雨夹杂细碎火山灰' },
      { id: 'w2', text: '逆风吹来带着硫磺味的暖雾' }
    ]
  };
  fs.writeFileSync(tmpTablesFile, JSON.stringify(baseTables, null, 2), 'utf8');

  const customDraw = runOracle(campaign, {
    table: 'custom_weather',
    tablesFile: tmpTablesFile
  });
  assert.equal(customDraw.tableKey, 'custom_weather');
  assert.ok(
    ['铅灰冻雨夹杂细碎火山灰', '逆风吹来带着硫磺味的暖雾'].includes(customDraw.entry.text),
    '新增表不改代码即可通过 oracle --table 直接抽取'
  );
});

test('phase2 (state.js rest 联动与模式隔离) - mode: "D" 短休/长休原子推进 world.json 时间，非 D 模式行为 100% 不变', () => {
  // 1) D 模式战役：短休推进 1h，长休推进 8h，走双文件事务且支持 opId 幂等
  const dCamp = 'p2-d-mode-rest';
  cleanCampaign(dCamp);

  initSession(dCamp, { mode: 'D', name: '雷恩', class: '战士', hp: 14, ac: 16, gold: 10 });
  initWorld(dCamp, { seed: 314159 });

  updateState(dCamp, { hp: '-6', useResource: '回气' });
  assert.equal(getState(dCamp).character.hp.current, 8);
  assert.equal(getWorld(dCamp).calendar.hour, 8);

  // 短休（带 opId）：恢复生命骰 + 推进 1 小时 (08:00 -> 09:00)
  applyRest(dCamp, 'short', { dice: 1, heal: 4, opId: 'rest-short-op-001' });
  assert.equal(getState(dCamp).character.hp.current, 12);
  assert.equal(getState(dCamp).character.resources['回气'].current, 2);
  assert.equal(getWorld(dCamp).calendar.hour, 9, 'D 模式短休必须将 world.json 时间推进 1 小时');
  assert.ok(getWorld(dCamp).meta.completedOpIds.includes('rest-short-op-001'));

  // 重复提交相同 opId：幂等跳过，不二次加血、不二次推进时间
  updateState(dCamp, { hp: '-5' });
  applyRest(dCamp, 'short', { dice: 1, heal: 4, opId: 'rest-short-op-001' });
  assert.equal(getState(dCamp).character.hp.current, 7, '重复 opId 必须幂等跳过，不重复回血');
  assert.equal(getWorld(dCamp).calendar.hour, 9, '重复 opId 必须幂等跳过，不重复推进世界时间');

  // 长休：恢复满血与全部生命骰 + 推进 8 小时 (09:00 -> 17:00)
  applyRest(dCamp, 'long', { opId: 'rest-long-op-002' });
  assert.equal(getState(dCamp).character.hp.current, 14);
  assert.equal(getState(dCamp).character.hitDice.current, 1);
  assert.equal(getWorld(dCamp).calendar.hour, 17, 'D 模式长休必须将 world.json 时间推进 8 小时');

  // 2) 非 D 模式（经典 A/B/C 模式）：即便目录下存在 world.json，也绝不触发世界时间推进
  const abcCamp = 'p2-abc-mode-rest';
  cleanCampaign(abcCamp);

  initSession(abcCamp, { name: '布鲁诺', class: '牧师', hp: 16, ac: 18, gold: 25 });
  initWorld(abcCamp, { seed: 111 }); // 故意在同目录放一个 world.json 测试防误判
  updateState(abcCamp, { hp: '-6' });

  const worldBefore = getWorld(abcCamp);
  applyRest(abcCamp, 'long');
  const stateAfter = getState(abcCamp);
  const worldAfter = getWorld(abcCamp);

  assert.equal(stateAfter.character.hp.current, 16);
  assert.equal(stateAfter.inventory.gold, 25);
  assert.deepEqual(worldAfter.calendar, worldBefore.calendar, '非 D 模式绝不能因目录存在 world.json 而推进世界时间');
});

test('phase2 (回滚失败人工恢复指引与 CLI 无 ANSI 门禁) - .bak 损坏时给出人能看懂的手动处理步骤，跨目录 CLI 零 ANSI', () => {
  const crashCamp = 'p2-rollback-error-guide';
  cleanCampaign(crashCamp);

  initSession(crashCamp, { mode: 'D', name: '艾拉', hp: 12 });
  initWorld(crashCamp, { seed: 404 });

  // 模拟在写完 state.json、未写 world.json 时崩溃
  assert.throws(() => {
    applyRest(crashCamp, 'long', {
      opId: 'op-crash-corrupt-bak',
      _simulateCrashAfterStateWrite: true
    });
  }, /SIMULATED_CRASH_AFTER_STATE_WRITE/);

  const sessionDir = path.dirname(getSessionPath(crashCamp));
  // 故意破坏 state.json.bak 使自动回滚校验失败
  fs.unlinkSync(path.join(sessionDir, 'state.json.bak'));

  assert.throws(
    () => recoverPendingOp(sessionDir),
    (err) => {
      assert.match(err.message, /无法安全回滚事务/);
      assert.match(err.message, /手动处理/);
      assert.match(err.message, /state\.json/);
      assert.match(err.message, /world\.json/);
      assert.match(err.message, /pending-op\.json/);
      return true;
    },
    '回滚失败报错必须用人能看懂的话写清楚如何手动检查 .bak、对齐状态并删除 pending-op.json'
  );

  // 单向依赖红线校验：world.js 严禁导入或反向调用 state.js
  const worldScriptSrc = fs.readFileSync(WORLD_SCRIPT, 'utf8');
  assert.equal(
    /state\.js/.test(worldScriptSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')),
    false,
    'world.js 代码实现严禁引用或反向调用 state.js'
  );

  // CLI 跨目录调用全 9 命令与零 ANSI 转义码验证
  const cliCamp = 'p2-cli-check';
  cleanCampaign(cliCamp);

  const runCli = (scriptPath, args) => {
    const res = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: os.tmpdir(),
      env: { ...process.env, DND_SESSIONS_DIR: TEMP_SESSIONS_DIR },
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, `CLI 执行失败 (${path.basename(scriptPath)} ${args.join(' ')}): ${res.stderr}`);
    assert.equal(/\x1b\[[0-9;]*m/.test(res.stdout), false, '非 TTY 管道输出不得包含 ANSI 颜色转义码');
    return res.stdout;
  };

  runCli(STATE_SCRIPT, ['init', cliCamp, '--mode', 'D', '--name', '科林', '--hp', '12']);
  runCli(WORLD_SCRIPT, ['init', cliCamp, '--seed', '2026']);
  const statusOut = runCli(WORLD_SCRIPT, ['status', cliCamp]);
  assert.ok(statusOut.trim().split('\n').length <= 15);

  runCli(WORLD_SCRIPT, ['clock', cliCamp, '--add', '--id', 'clk:cli_1', '--name', '巡城宵禁', '--cadence', 'day', '--max', '4']);
  runCli(WORLD_SCRIPT, ['clock', cliCamp, '--pause', '--id', 'clk:cli_1']);
  runCli(WORLD_SCRIPT, ['time', cliCamp, '--advance', '2d']);
  runCli(WORLD_SCRIPT, ['clock', cliCamp, '--resume', '--id', 'clk:cli_1']);

  runCli(WORLD_SCRIPT, ['ledger', cliCamp, '--add', '--id', 'led:cli_1', '--type', '线索', '--summary', '钟楼暗格密信']);
  runCli(WORLD_SCRIPT, ['canon', cliCamp, '--add', '--id', 'canon:cli_1', '--entity', 'loc:greyhaven', '--predicate', '治安官', '--value', '霍尔顿']);
  runCli(WORLD_SCRIPT, ['npc', cliCamp, '--generate', '--location', 'loc:greyhaven']);
  runCli(WORLD_SCRIPT, ['rumor', cliCamp, '--draw', '--location', 'loc:greyhaven']);
  runCli(WORLD_SCRIPT, ['oracle', cliCamp, '--question', '守卫是否换岗？', '--odds', 'even']);

  runCli(STATE_SCRIPT, ['rest', cliCamp, '--short']);
  const timeOut = runCli(WORLD_SCRIPT, ['time', cliCamp, '--json']);
  const timeJson = JSON.parse(timeOut);
  assert.equal(timeJson.calendar.day, 3);
  assert.equal(timeJson.calendar.hour, 9);
});
