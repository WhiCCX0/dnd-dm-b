import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  toTotalHours,
  validateDModeStateDoc,
  validateWorldDoc
} from '../scripts/world-contract.js';

import {
  initWorld,
  getWorld,
  manageClock,
  manageLedger,
  manageNpc,
  manageRumor
} from '../scripts/world.js';

import {
  initSession,
  addPartyMember,
  getState,
  updateState,
  applyRest,
  promoteCharacter,
  getSessionPath
} from '../scripts/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORLD_SCRIPT = path.join(ROOT_DIR, 'scripts', 'world.js');
const STATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'state.js');
const LOOKUP_SCRIPT = path.join(ROOT_DIR, 'scripts', 'lookup.js');
const DICE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'roll-dice.js');

const TEMP_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-p4-sessions-'));
process.env.DND_SESSIONS_DIR = TEMP_SESSIONS_DIR;
process.env.SESSIONS_DIR = TEMP_SESSIONS_DIR;

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

test('phase4 (规则修复：2024 魔契师契约魔法短休恢复) - 魔契师在短休与长休均恢复全部法术位，其他职业与 A/B/C 行为不变', () => {
  // 1) D 模式下：0 级序章晋升为 1 级魔契师 + 队友 1 级法师 + 队友 1 级牧师
  const dCamp = 'p4-warlock-short-rest-d';
  cleanCampaign(dCamp);

  initSession(dCamp, {
    mode: 'D',
    level: 0,
    name: '莫林',
    abilities: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    copper: 100
  });
  initWorld(dCamp, { seed: 20261107 });

  promoteCharacter(dCamp, { class: '魔契师', armor: '皮甲' });
  addPartyMember(dCamp, { preset: 'alistair' }); // 1级法师：1环 2/2，奥术回想 1/1 (long:all)
  addPartyMember(dCamp, { preset: 'vondal' });   // 1级牧师：1环 2/2
  addPartyMember(dCamp, { preset: 'valen' });    // 1级战士：回气 2/2 (short:1)

  // 消耗魔契师唯一 1 环契约魔法法术位 (1 -> 0)，消耗法师与牧师各 1 个 1 环法术位 (2 -> 1)，消耗战士 2 次回气 (2 -> 0)
  updateState(dCamp, { who: '莫林', slotLevel: 1, slotChange: '-1' });
  updateState(dCamp, { who: '阿里斯泰尔', slotLevel: 1, slotChange: '-1', useResource: '奥术回想' });
  updateState(dCamp, { who: '冯达尔', slotLevel: 1, slotChange: '-1' });
  updateState(dCamp, { who: '瓦伦', useResource: '回气' });
  updateState(dCamp, { who: '瓦伦', useResource: '回气' });

  let st = getState(dCamp);
  assert.equal(st.party[0].spellSlots[1].current, 0, '魔契师施法后 1 环法术位应为 0/1');
  assert.equal(st.party[1].spellSlots[1].current, 1, '法师施法后 1 环法术位应为 1/2');
  assert.equal(st.party[2].spellSlots[1].current, 1, '牧师施法后 1 环法术位应为 1/2');
  assert.equal(st.party[3].resources['回气'].current, 0, '战士消耗后回气应为 0/2');

  // 执行短休：魔契师恢复全部契约魔法法术位 (0 -> 1)，战士回气 +1 (0 -> 1)，法师与牧师法术位保持 1/2 不变！
  st = applyRest(dCamp, 'short', { opId: 'p4-warlock-short-1' });
  assert.equal(st.party[0].spellSlots[1].current, 1, '2024 魔契师在短休后必须恢复全部契约魔法法术位 (1/1)');
  assert.equal(st.party[1].spellSlots[1].current, 1, '法师在短休后不应自动恢复法术位 (保持 1/2)');
  assert.equal(st.party[1].resources['奥术回想'].current, 0, '长休资源在短休后不恢复');
  assert.equal(st.party[2].spellSlots[1].current, 1, '牧师在短休后不应自动恢复法术位 (保持 1/2)');
  assert.equal(st.party[3].resources['回气'].current, 1, '战士在短休后恢复 1 次回气 (1/2)');
  assert.equal(getWorld(dCamp).calendar.hour, 9, 'D 模式短休应推进世界时间 1 小时');

  // 执行长休：所有施法职业法术位与长休资源全部恢复
  updateState(dCamp, { who: '莫林', slotLevel: 1, slotChange: '-1' });
  st = applyRest(dCamp, 'long', { opId: 'p4-warlock-long-1' });
  assert.equal(st.party[0].spellSlots[1].current, 1);
  assert.equal(st.party[1].spellSlots[1].current, 2);
  assert.equal(st.party[1].resources['奥术回想'].current, 1);
  assert.equal(st.party[2].spellSlots[1].current, 2);
  assert.equal(st.party[3].resources['回气'].current, 2);
  assert.equal(getWorld(dCamp).calendar.hour, 17);

  // 2) 经典 A/B/C 模式下：高环魔契师（含邪术师/warlock 别名）短休同样恢复全部法术位，且完全不产生/不触碰 world.json，金币用 gold
  const abcCamp = 'p4-warlock-short-rest-abc';
  cleanCampaign(abcCamp);

  initSession(abcCamp, {
    name: '维克托',
    class: '邪术师',
    level: 3,
    hp: 24,
    ac: 14,
    slots: '2:2',
    gold: 30
  });
  addPartyMember(abcCamp, { preset: 'alistair' });

  updateState(abcCamp, { who: '维克托', slotLevel: 2, slotChange: '-2' });
  updateState(abcCamp, { who: '阿里斯泰尔', slotLevel: 1, slotChange: '-2' });
  assert.equal(getState(abcCamp).party[0].spellSlots[2].current, 0);
  assert.equal(getState(abcCamp).party[1].spellSlots[1].current, 0);

  const abcAfterShort = applyRest(abcCamp, 'short');
  assert.equal(abcAfterShort.party[0].spellSlots[2].current, 2, 'A/B/C 模式下魔契师/邪术师短休同样恢复全部法术位 (2/2)');
  assert.equal(abcAfterShort.party[1].spellSlots[1].current, 0, 'A/B/C 模式下法师短休不恢复法术位 (0/2)');
  assert.equal(abcAfterShort.meta, undefined, 'A/B/C 模式不写入 D 模式 meta');
  assert.equal(abcAfterShort.inventory.gold, 30, 'A/B/C 模式保持 inventory.gold 不变');
  assert.equal('copper' in abcAfterShort.inventory, false, 'A/B/C 模式不生成 copper 字段');
  assert.equal(getWorld(abcCamp), null, 'A/B/C 模式不生成 world.json');
});

test('phase4 (端到端全链路测试) - 0级序章 -> 掷骰/记账/查lore -> promote施法职业 -> 走出已知地图canon定论与冲突拒绝 -> 长休跨旬tenday时钟结算 -> 双文件写入中途崩溃与续局恢复 -> 续局world status零secret泄露', () => {
  const camp = 'p4-full-e2e-sandbox';
  cleanCampaign(camp);

  const runCli = (scriptPath, args, { expectFail = false } = {}) => {
    const res = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: os.tmpdir(),
      env: { ...process.env, DND_SESSIONS_DIR: TEMP_SESSIONS_DIR, DND_RNG_SEED: '20261107' },
      encoding: 'utf8'
    });
    if (expectFail) {
      assert.notEqual(res.status, 0, `预期 CLI 失败但实际成功 (${path.basename(scriptPath)} ${args.join(' ')})`);
      return res;
    }
    assert.equal(res.status, 0, `CLI 失败 (${path.basename(scriptPath)} ${args.join(' ')}):\n${res.stderr}`);
    assert.equal(/\x1b\[[0-9;]*m/.test(res.stdout), false, 'CLI 输出不得含 ANSI 转义码');
    return res.stdout;
  };

  // =========================================================================
  // 步骤 1：0 级序章开局（state.js init --mode D --level 0 + world.js init，带开局地区、★代价、◆限制）
  // =========================================================================
  runCli(STATE_SCRIPT, [
    'init', camp,
    '--mode', 'D',
    '--level', '0',
    '--name', '沈默',
    '--abilities', 'str:8,dex:14,con:14,int:12,wis:10,cha:16',
    '--copper', '95',
    '--location', '灰岩外镇旧钟坊'
  ]);
  runCli(WORLD_SCRIPT, [
    'init', camp,
    '--seed', '20261107',
    '--intensity', 'fast',
    '--region', '圣座同盟·灰岩十一邦',
    '--location', '灰岩外镇旧钟坊',
    '--tier', '凡俗',
    '--factions', '圣座审讯骑兵,灰烬学者外围',
    '--cost', '欠钟坊匠师 120cp 学徒赎身契款',
    '--limit', '10日内须结清契款否则移交审讯所劳役'
  ]);

  let st = getState(camp);
  let wd = getWorld(camp);
  assert.equal(st.meta.mode, 'D');
  assert.equal(st.character.level, 0);
  assert.equal(st.character.class, '平民');
  assert.equal(st.character.heroicInspiration, true);
  assert.equal(st.inventory.copper, 95);
  assert.equal('gold' in st.inventory, false);
  assert.equal(wd.meta.region, '圣座同盟·灰岩十一邦');
  assert.equal(wd.clocks.filter(c => c.id.startsWith('clk:trouble_') && c.cadence === 'tenday').length, 3);
  assert.ok(wd.clocks.some(c => c.id === 'clk:start_limit' && c.cadence === 'tenday'));
  assert.ok(wd.ledger.some(l => l.id === 'led:start_cost' && l.summary.includes('120cp')));
  assert.ok(wd.ledger.some(l => l.id === 'led:start_limit' && l.summary.includes('10日内')));

  // =========================================================================
  // 步骤 2：序章中掷骰、记账、查 lore
  // =========================================================================
  const rollOut = runCli(DICE_SCRIPT, ['1d20+3', '--dc', '12', '--label', '拓印钟摆内壁残存古铭文']);
  assert.ok(rollOut.includes('1d20+3'));

  // 铜币记账 + 世界账本记账
  runCli(STATE_SCRIPT, ['update', camp, '--copper', '+55', '--add-item', '古铭文拓片']);
  runCli(WORLD_SCRIPT, [
    'ledger', camp,
    '--add',
    '--id', 'led:prologue_rubbing',
    '--type', '机会',
    '--summary', '灰烬学者愿以 2gp 收购旧钟坊古铭文拓片'
  ]);
  st = getState(camp);
  assert.equal(st.inventory.copper, 150);
  assert.equal('gold' in st.inventory, false);
  assert.ok(getWorld(camp).ledger.some(l => l.id === 'led:prologue_rubbing'));

  // 查 lore（公开设定检索，不触碰 secret）
  const loreOut = runCli(LOOKUP_SCRIPT, ['lore', '圣座同盟', '--brief']);
  assert.ok(loreOut.includes('圣座同盟'));
  const loreSecretJson = JSON.parse(runCli(LOOKUP_SCRIPT, ['lore', '冬线南移', '--json']));
  assert.equal(loreSecretJson.found, false, '默认查 lore 不得命中 secret/gm-dossier.md');

  // =========================================================================
  // 步骤 3：promote 转 1 级（施法职业：魔契师），并验证施法与短休法术位恢复
  // =========================================================================
  const promoteOut = runCli(STATE_SCRIPT, [
    'promote', camp,
    '--class', '魔契师',
    '--armor', '皮甲'
  ]);
  assert.ok(promoteOut.includes('Lv1 魔契师'));
  st = getState(camp);
  assert.equal(st.character.level, 1);
  assert.equal(st.character.class, '魔契师');
  assert.equal(st.character.hp.max, 10); // d8(8) + CON(+2) = 10
  assert.equal(st.character.ac, 13);     // 皮甲(11) + DEX(+2) = 13
  assert.deepEqual(st.character.spellSlots, { 1: { max: 1, current: 1 } });

  // 魔契师施展 1 环法术消耗法术位，随后短休恢复法术位并推进 1 小时
  runCli(STATE_SCRIPT, ['update', camp, '--slot', '1', '-1']);
  assert.equal(getState(camp).character.spellSlots[1].current, 0);
  runCli(STATE_SCRIPT, ['rest', camp, '--short', '--op-id', 'p4-e2e-short-1']);
  assert.equal(getState(camp).character.spellSlots[1].current, 1, '魔契师短休后 1 环契约魔法法术位恢复为 1/1');
  assert.equal(getWorld(camp).calendar.hour, 9);

  // =========================================================================
  // 步骤 4：走出已知地图：生成一个设定里没有的新地点并 canon --add，再登记冲突定论验证被拒绝
  // =========================================================================
  const newLocationName = '鸦骨荒原苦盐井';
  const newLocationId = 'loc:crowbone_saltwell';
  runCli(STATE_SCRIPT, ['update', camp, '--location', newLocationName]);
  runCli(WORLD_SCRIPT, [
    'canon', camp,
    '--add',
    '--id', 'canon:new_loc_ctrl',
    '--entity', newLocationId,
    '--predicate', '实际控制者',
    '--value', '荒原流民互助会',
    '--status', '定论',
    '--source', '生成'
  ]);
  assert.ok(
    getWorld(camp).canon.some(c => c.id === 'canon:new_loc_ctrl' && c.entityId === newLocationId && c.value === '荒原流民互助会'),
    '走出已知地图的新地点应成功写入 canon 定论'
  );

  // 登记一条与之重叠时间段冲突的定论 -> 必须被硬拒绝！
  const conflictRes = runCli(
    WORLD_SCRIPT,
    [
      'canon', camp,
      '--add',
      '--id', 'canon:new_loc_conflict',
      '--entity', newLocationId,
      '--predicate', '实际控制者',
      '--value', '圣座铁骑驻军',
      '--status', '定论',
      '--source', '玩家行动'
    ],
    { expectFail: true }
  );
  assert.match(conflictRes.stderr, /canon 定论冲突拒绝写入/);
  assert.equal(
    getWorld(camp).canon.some(c => c.id === 'canon:new_loc_conflict'),
    false,
    '冲突定论被拒绝后不得写入 world.canon'
  );

  // =========================================================================
  // 步骤 5：长休若干次，推进足够时间，让至少一个按旬结算（tenday）的时钟真正结算
  // =========================================================================
  // 当前时间为 Y0142-M01-D01T09，所有按旬 (tenday) 时钟的首个结算边界为 Y0142-M01-D11T04（距当前 235 小时）。
  // 连续执行 30 次长休（30 * 8h = 240h），跨越 Y0142-M01-D11T04 到达 Y0142-M01-D11T09。
  for (let i = 1; i <= 30; i++) {
    applyRest(camp, 'long', { opId: `p4-e2e-long-${i}` });
  }

  wd = getWorld(camp);
  assert.equal(wd.calendar.year, 142);
  assert.equal(wd.calendar.month, 1);
  assert.equal(wd.calendar.day, 11);
  assert.equal(wd.calendar.hour, 9);

  const tendayClocks = wd.clocks.filter(c => c.cadence === 'tenday' && c.status === 'active');
  assert.ok(tendayClocks.length >= 4, '应存在至少 4 个活跃的按旬 (tenday) 时钟');
  for (const tc of tendayClocks) {
    assert.equal(tc.nextTick, 'Y0142-M01-D21T04', `按旬时钟 ${tc.id} 跨旬后 nextTick 应推进至 Y0142-M01-D21T04`);
  }
  const progressedTendayClocks = wd.clocks.filter(c => c.cadence === 'tenday' && c.current > 0);
  assert.ok(
    progressedTendayClocks.length >= 1,
    `至少一个按旬结算 (tenday) 的时钟应真正结算并推进进度，实际推进: ${progressedTendayClocks.map(c => `${c.name}=${c.current}/${c.max}`).join(', ')}`
  );

  // =========================================================================
  // 步骤 6：模拟中断：在长休的双文件写入中途崩溃，然后像新会话续局那样重新读取（state.js show + world.js status），
  //        验证两个文件一致、时间和时钟没有重复结算
  // =========================================================================
  // 先注入若干 secret 数据，以便在步骤 7 同时检验续局后的玩家视图零 secret 泄露
  manageClock(camp, {
    add: true,
    id: 'clk:sec_abyss',
    name: '机密深渊裂隙共鸣',
    kind: 'threat',
    cadence: 'tenday',
    max: 6,
    current: 2,
    visibility: 'secret'
  });
  manageLedger(camp, {
    add: true,
    id: 'led:sec_inquisitor',
    type: '秘密',
    summary: '机密：审讯官暗中私藏灰烬禁书',
    visibility: 'secret'
  });
  manageNpc(camp, {
    add: true,
    id: 'npc:pub_elder',
    name: '盐井长老胡戈',
    voice: '沙哑低沉',
    desire: '保住苦盐井水源',
    fear: '税骑封井',
    secret: '胡戈的机密底牌：年轻时曾是铁卫逃兵',
    attitude: 1,
    locationId: newLocationId,
    alive: true,
    visibility: 'public'
  });
  manageNpc(camp, {
    add: true,
    id: 'npc:sec_watcher',
    name: '暗影密探夜鸮',
    voice: '阴冷耳语',
    desire: '监视流民动向',
    fear: '身份败露',
    secret: '夜鸮的机密底牌：直接向黑烛残党汇报',
    attitude: -2,
    locationId: newLocationId,
    alive: true,
    visibility: 'secret'
  });
  manageRumor(camp, {
    add: true,
    id: 'rum:sec_whisper',
    text: '机密传闻：盐井底层连通旧纪元封印石门',
    credibility: '亲见',
    tier: '超凡',
    visibility: 'secret'
  });

  // 让角色受伤并消耗 1 环法术位，准备进入将发生崩溃的长休
  runCli(STATE_SCRIPT, ['update', camp, '--hp', '-4', '--slot', '1', '-1']);
  const preCrashState = getState(camp);
  const preCrashWorld = getWorld(camp);
  assert.equal(preCrashState.character.hp.current, 6);
  assert.equal(preCrashState.character.spellSlots[1].current, 0);
  const preCrashHours = toTotalHours(preCrashWorld.calendar);
  const preCrashClocks = structuredClone(preCrashWorld.clocks);
  const preCrashRngState = preCrashWorld.rng.state;

  const sessionDir = path.dirname(getSessionPath(camp));
  const pendingPath = path.join(sessionDir, 'pending-op.json');

  // 6a) 模拟在写完 state.json、尚未写 world.json 的中途进程崩溃
  assert.throws(
    () => applyRest(camp, 'long', {
      opId: 'p4-e2e-crash-mid-write',
      _simulateCrashAfterStateWrite: true
    }),
    /SIMULATED_CRASH_AFTER_STATE_WRITE/
  );
  assert.equal(fs.existsSync(pendingPath), true, '崩溃当下应残留 pending-op.json');
  // 此时磁盘上 state.json 已被写成满血 (HP 10)，而 world.json 仍停留在旧时间
  const rawStateDuringCrash = JSON.parse(fs.readFileSync(path.join(sessionDir, 'state.json'), 'utf8'));
  const rawWorldDuringCrash = JSON.parse(fs.readFileSync(path.join(sessionDir, 'world.json'), 'utf8'));
  assert.equal(rawStateDuringCrash.character.hp.current, 10);
  assert.equal(toTotalHours(rawWorldDuringCrash.calendar), preCrashHours);

  // 像新会话续局那样通过 CLI 重新读取：state.js show + world.js status
  const resumedShowJson = JSON.parse(runCli(STATE_SCRIPT, ['show', camp, '--json']));
  const resumedStatusText = runCli(WORLD_SCRIPT, ['status', camp]);
  const resumedWorldJson = JSON.parse(runCli(WORLD_SCRIPT, ['status', camp, '--json']));

  assert.equal(fs.existsSync(pendingPath), false, '续局读取后应自动完成回滚并清理 pending-op.json');
  assert.equal(resumedShowJson.character.hp.current, 6, '中途崩溃回滚后角色 HP 应与写前一致 (6/10)');
  assert.equal(resumedShowJson.character.spellSlots[1].current, 0, '中途崩溃回滚后法术位应与写前一致 (0/1)');
  assert.equal(toTotalHours(resumedWorldJson.calendar), preCrashHours, '中途崩溃回滚后世界时间不应被错误推进');
  assert.deepEqual(getWorld(camp).clocks, preCrashClocks, '中途崩溃回滚后所有时钟进度与写前完全一致');
  assert.equal(getWorld(camp).rng.state, preCrashRngState, '中途崩溃回滚后 RNG 状态与写前完全一致');

  // 6b) 模拟第二种中断：双文件均已落盘、但在删除 pending-op.json 前崩溃，然后续局读取并重试同一 opId
  assert.throws(
    () => applyRest(camp, 'long', {
      opId: 'p4-e2e-crash-before-unlink',
      _simulateCrashBeforeUnlink: true
    }),
    /SIMULATED_CRASH_BEFORE_UNLINK/
  );
  assert.equal(fs.existsSync(pendingPath), true);

  // 新会话续局读取（state.js show + world.js status）自动收尾已提交事务，且重试相同 opId 不会二次推进时间或时钟
  const committedShow = JSON.parse(runCli(STATE_SCRIPT, ['show', camp, '--json']));
  const committedStatus = runCli(WORLD_SCRIPT, ['status', camp]);
  assert.equal(fs.existsSync(pendingPath), false);
  assert.equal(committedShow.character.hp.current, 10);
  assert.equal(committedShow.character.spellSlots[1].current, 1);
  assert.equal(toTotalHours(getWorld(camp).calendar), preCrashHours + 8, '提交前中断恢复后世界时间应只推进 1 次长休 (8h)');

  const clocksAfterCommit = structuredClone(getWorld(camp).clocks);
  const rngAfterCommit = getWorld(camp).rng.state;

  // 重试同一 opId：验证幂等跳过，时间与时钟绝不重复结算
  runCli(STATE_SCRIPT, ['rest', camp, '--long', '--op-id', 'p4-e2e-crash-before-unlink']);
  assert.equal(toTotalHours(getWorld(camp).calendar), preCrashHours + 8, '相同 opId 重试不得重复推进时间');
  assert.deepEqual(getWorld(camp).clocks, clocksAfterCommit, '相同 opId 重试不得重复结算时钟');
  assert.equal(getWorld(camp).rng.state, rngAfterCommit, '相同 opId 重试不得消耗 RNG');
  assert.equal(validateDModeStateDoc(getState(camp)).valid, true);
  assert.equal(validateWorldDoc(getWorld(camp)).valid, true);

  // =========================================================================
  // 步骤 7：验证续局后 world status 玩家视图不含任何 secret 内容
  // =========================================================================
  const statusLines = committedStatus.trim().split('\n');
  assert.ok(statusLines.length <= 15, `world status 输出行数必须 <= 15，实际 ${statusLines.length} 行`);
  assert.ok(committedStatus.includes('玩家公开视图'));
  assert.ok(committedStatus.includes('盐井长老胡戈'), '公开 NPC 应在玩家视图显示');

  const forbiddenSecrets = [
    '机密深渊裂隙共鸣',
    '审讯官暗中私藏灰烬禁书',
    '年轻时曾是铁卫逃兵',
    '暗影密探夜鸮',
    '直接向黑烛残党汇报',
    '盐井底层连通旧纪元封印石门',
    '冬线南移',
    '渊喉巨脉',
    '苍穹脱缰'
  ];
  const playerStatusRawJson = runCli(WORLD_SCRIPT, ['status', camp, '--json']);
  for (const secText of forbiddenSecrets) {
    assert.equal(
       resContains(resumedStatusText, secText) || resContains(committedStatus, secText) || resContains(playerStatusRawJson, secText),
      false,
      `续局后 world status 玩家视图与 JSON 严禁泄露任何 secret 内容: "${secText}"`
    );
  }
});

function resContains(haystack, needle) {
  return String(haystack || '').includes(needle);
}
