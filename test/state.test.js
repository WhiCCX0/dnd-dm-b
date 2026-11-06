import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initSession,
  addPartyMember,
  getState,
  updateState,
  applyRest,
  generateHud,
  getSessionPath,
  addEncounterMob,
  damageEncounterMob,
  clearEncounter,
  advanceTurn,
  manageNotes,
  calculateEncounterDifficulty,
  parseCliArgs
} from '../scripts/state.js';
import { lookup } from '../scripts/lookup.js';
import { roll } from '../scripts/roll-dice.js';

const TEMP_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-sessions-'));
process.env.DND_SESSIONS_DIR = TEMP_SESSIONS_DIR;
process.env.SESSIONS_DIR = TEMP_SESSIONS_DIR;

const TEST_CAMPAIGN = 'unit-test-campaign';

test.beforeEach(() => {
  const p = getSessionPath(TEST_CAMPAIGN);
  const dir = path.dirname(p);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => {
  if (fs.existsSync(TEMP_SESSIONS_DIR)) {
    fs.rmSync(TEMP_SESSIONS_DIR, { recursive: true, force: true });
  }
});

test('state - 初始化战役状态与默认属性', () => {
  const state = initSession(TEST_CAMPAIGN, {
    name: '布鲁诺',
    class: '牧师',
    level: 2,
    hp: 18,
    ac: 18,
    gold: 50
  });

  assert.equal(state.character.name, '布鲁诺');
  assert.equal(state.character.class, '牧师');
  assert.equal(state.character.hp.current, 18);
  assert.equal(state.character.hp.max, 18);
  assert.equal(state.character.ac, 18);
  assert.equal(state.inventory.gold, 50);
  assert.equal(state.character.hitDice.die, 'd8');
  assert.equal(state.character.hitDice.max, 2);
});

test('state - 严格数值校验拒绝非法输入防止 NaN 污染 (H2)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20, ac: 15, gold: 50 });

  assert.throws(() => updateState(TEST_CAMPAIGN, { hp: 'abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { hp: '+abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { tempHp: 'abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { maxHp: 'abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { ac: 'abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { gold: 'abc' }), /必须是有效整数/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { gold: '+abc' }), /必须是有效整数/);

  addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 10, ac: 15, count: 1 });
  assert.throws(() => damageEncounterMob(TEST_CAMPAIGN, '地精武者-1', 'abc'), /必须是有效整数/);

  const state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 20);
  assert.equal(state.character.ac, 15);
  assert.equal(state.inventory.gold, 50);
  assert.equal(state.status.encounter.mobs[0].hp, 10);
});

test('state - 未初始化战役调用 update 或 mob-add 时显式报错拒绝隐式建档 (M8)', () => {
  assert.throws(() => updateState('non-existent-campaign', { hp: '-5' }), /未找到战役/);
  assert.throws(() => addEncounterMob('non-existent-campaign', { name: '地精', hp: 7 }), /未找到战役/);
});

test('state - 原子写盘与 .bak 备份机制 (M9)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  updateState(TEST_CAMPAIGN, { hp: '-3' });

  const sessionFile = getSessionPath(TEST_CAMPAIGN);
  const bakFile = `${sessionFile}.bak`;
  const dirFiles = fs.readdirSync(path.dirname(sessionFile));

  assert.ok(fs.existsSync(sessionFile));
  assert.ok(fs.existsSync(bakFile));
  assert.ok(!dirFiles.some(f => f.endsWith('.tmp')));

  const bakData = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
  assert.equal(bakData.character.hp.current, 12);
});

test('state - 临时生命抵扣与跨操作清除陈旧 lastDelta 防漂移 (Stage 3.2)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  updateState(TEST_CAMPAIGN, { tempHp: 6 });
  updateState(TEST_CAMPAIGN, { hp: '-8', reason: '重击' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 0);
  assert.equal(state.character.hp.current, 18);
  assert.equal(state.character.hp.lastDelta, '-2 重击');

  // 下一次无关操作（如捡金币）必须自动清除旧的 hp.lastDelta
  updateState(TEST_CAMPAIGN, { gold: '+10' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.lastDelta, undefined, '跨操作后不应残留上回合的 lastDelta');
});

test('state - 2024 浴血 (Bloodied) 状态自动触发、消除与 HUD 去重 (L9)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  updateState(TEST_CAMPAIGN, { hp: '-11' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 9);
  assert.ok(state.status.conditions.includes('浴血'));

  const hudLine = generateHud(state, 'line');
  const matches = hudLine.match(/浴血/g) || [];
  assert.equal(matches.length, 1);

  updateState(TEST_CAMPAIGN, { hp: '+5' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 14);
  assert.ok(!state.status.conditions.includes('浴血'));
});

test('state - 调整生命上限 (--max-hp) 时自动钳制当前生命并重算浴血 (M7)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });
  updateState(TEST_CAMPAIGN, { maxHp: 15 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.max, 15);
  assert.equal(state.character.hp.current, 15);

  updateState(TEST_CAMPAIGN, { hp: 8 });
  updateState(TEST_CAMPAIGN, { maxHp: 20 });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 8);
  assert.ok(state.status.conditions.includes('浴血'));
});

test('state - 巨额溢伤即死、已死亡禁疗锁、--revive 复活与 3 次死亡豁免稳定 (Stage 3.2)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });

  // 12 HP 满血受到 24 点伤害 -> 溢伤 12 >= 上限 12 -> 当场即死！
  updateState(TEST_CAMPAIGN, { hp: '-24', reason: '巨龙吐息' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 0);
  assert.ok(state.status.conditions.includes('死亡'), '溢伤达到生命上限必须当场触发【死亡】');

  // 已死亡角色拒绝普通治疗与休整回血
  assert.throws(() => updateState(TEST_CAMPAIGN, { hp: '+5' }), /已死亡，普通治疗无法生效/);
  assert.throws(() => applyRest(TEST_CAMPAIGN, 'long'), /已死亡，无法通过休整恢复生命/);

  // 使用 --revive 复活并恢复生命
  updateState(TEST_CAMPAIGN, { hp: '+6', revive: true });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 6);
  assert.ok(!state.status.conditions.includes('死亡'));

  // 再次归零陷入昏迷，连续 3 次死亡豁免成功 -> 进入【稳定】
  updateState(TEST_CAMPAIGN, { hp: '-6' });
  updateState(TEST_CAMPAIGN, { deathSave: 'success' });
  updateState(TEST_CAMPAIGN, { deathSave: 'success' });
  const hudMid = generateHud(getState(TEST_CAMPAIGN), 'line');
  assert.ok(hudMid.includes('死亡豁免: 成2/败0'), 'HUD 必须直观展示死亡豁免进度');

  updateState(TEST_CAMPAIGN, { deathSave: 'success' });
  state = getState(TEST_CAMPAIGN);
  assert.ok(state.status.conditions.includes('稳定'), '3 次死亡豁免成功应附加【稳定】标记');

  // 0 HP 稳定状态下再次受击 -> 脱离稳定并记 1 次死亡豁免失败
  updateState(TEST_CAMPAIGN, { hp: '-2' });
  state = getState(TEST_CAMPAIGN);
  assert.ok(!state.status.conditions.includes('稳定'));
  assert.equal(state.character.deathSaves.failures, 1);
});

test('state - 法术专注受击体质豁免 DC 提示与昏迷自动断专注 (Stage 3.2)', () => {
  initSession(TEST_CAMPAIGN, { name: '冯达尔', class: '牧师', hp: 30, slots: '1:2' });
  updateState(TEST_CAMPAIGN, { concentrate: '祝福术', slotLevel: 1, slotChange: '-1' });

  // 受到 24 点伤害 -> DC = max(10, floor(24/2)) = 12
  updateState(TEST_CAMPAIGN, { hp: '-24', reason: '食人魔重棒' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.concentration, '祝福术');
  assert.equal(state.character.concentrationCheckDc, 12);
  const hud = generateHud(state, 'line');
  assert.ok(hud.includes('DC12'), 'HUD 应提示专注体质豁免 DC 12');

  // 归零昏迷 -> 自动中断专注
  updateState(TEST_CAMPAIGN, { hp: '-6' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.concentration, null, '归零昏迷应自动中断法术专注');
});

test('state - 多角色小队 (--preset valen,bran)、职业充能资源与短休/长休差异恢复 (Stage 3.2 & Stage 4)', () => {
  let state = initSession(TEST_CAMPAIGN, { preset: 'valen' });
  state = addPartyMember(TEST_CAMPAIGN, { preset: 'bran' });

  assert.equal(state.party.length, 2);
  assert.equal(state.party[0].name, '瓦伦·铁福德');
  assert.equal(state.party[0].ac, 17);
  assert.equal(state.party[0].hp.max, 12);
  assert.equal(state.party[1].name, '布兰·铁须');
  assert.equal(state.party[1].hp.max, 12);
  assert.equal(state.party[1].ac, 14);

  // 瓦伦消耗 2 次【回气】
  updateState(TEST_CAMPAIGN, { useResource: '回气' });
  updateState(TEST_CAMPAIGN, { useResource: '回气' });
  assert.equal(getState(TEST_CAMPAIGN).party[0].resources['回气'].current, 0);
  assert.throws(() => updateState(TEST_CAMPAIGN, { useResource: '回气' }), /剩余次数不足/);

  // 针对队友布兰单独扣血，不影响瓦伦
  updateState(TEST_CAMPAIGN, { who: '布兰', hp: '-5', reason: '骷髅短弓' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.party[0].hp.current, 12);
  assert.equal(state.party[1].hp.current, 7);

  // 2024 战士短休：回气仅恢复 +1 次 (short:1)
  state = applyRest(TEST_CAMPAIGN, 'short', { who: '布兰', dice: 1, heal: 5 });
  assert.equal(state.party[1].hp.current, 12);

  state = applyRest(TEST_CAMPAIGN, 'short');
  assert.equal(state.party[0].resources['回气'].current, 1, '2024 战士短休应恢复 1 次回气');

  // 长休：恢复全部回气 (2/2)
  state = applyRest(TEST_CAMPAIGN, 'long');
  assert.equal(state.party[0].resources['回气'].current, 2);
});

test('state - 先攻排序、next 回合指针推进、带持续轮数状态递减与模糊目标歧义拦截 (Stage 3.2)', () => {
  initSession(TEST_CAMPAIGN, { preset: 'valen,bran' });
  updateState(TEST_CAMPAIGN, { who: '瓦伦', init: 16, addCondition: '中毒:2' });
  updateState(TEST_CAMPAIGN, { who: '布兰', init: 10 });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 10, ac: 15, count: 1, init: 13 });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精头目', hp: 21, ac: 17, count: 1, init: 8 });

  // 模糊子串 "地精" 同时匹配 "地精武者-1" 与 "地精头目-1" -> 必须报错提示歧义！
  assert.throws(
    () => damageEncounterMob(TEST_CAMPAIGN, '地精', 5),
    /存在歧义/
  );

  // 先攻顺序应为: 瓦伦(16) -> 地精武者-1(13) -> 布兰(10) -> 地精头目-1(8)
  // 注意 addEncounterMob 已将 inCombat 置为 true, round=1, turnIndex=0，首次调用 advanceTurn 进入下一位或先重置 round=0 验证完整轮转
  updateState(TEST_CAMPAIGN, { round: 0 });

  let s = advanceTurn(TEST_CAMPAIGN); // Round 1, Turn 0: 瓦伦 (中毒:2 -> 中毒:1)
  assert.equal(s.status.round, 1);
  assert.equal(s.status.activeTurn, '瓦伦·铁福德');
  assert.ok(s.status.conditions.includes('中毒:1'), '第 1 轮行动时 中毒:2 应递减为 中毒:1');

  s = advanceTurn(TEST_CAMPAIGN); // Turn 1: 地精武者-1
  assert.equal(s.status.activeTurn, '地精武者-1');
  s = advanceTurn(TEST_CAMPAIGN); // Turn 2: 布兰·铁须
  assert.equal(s.status.activeTurn, '布兰·铁须');
  s = advanceTurn(TEST_CAMPAIGN); // Turn 3: 地精头目-1
  assert.equal(s.status.activeTurn, '地精头目-1');

  s = advanceTurn(TEST_CAMPAIGN); // Wrap around -> Round 2, Turn 0: 瓦伦 (中毒:1 -> 自动解除)
  assert.equal(s.status.round, 2);
  assert.equal(s.status.activeTurn, '瓦伦·铁福德');
  assert.ok(!s.status.conditions.some(c => c.startsWith('中毒')), '第 2 轮行动时持续时间归零应自动移除中毒');
});

test('state - Stage 5 结构化笔记簿 (note)、遭遇难度计算器 (encounter-calc) 与 HUD --veil 迷雾模式', () => {
  initSession(TEST_CAMPAIGN, { preset: 'valen' });
  manageNotes(TEST_CAMPAIGN, { cat: 'clue', add: '墓室石棺下藏有密道' });
  manageNotes(TEST_CAMPAIGN, { cat: 'npc', add: '村长托宾悬赏 25gp' });
  let st = getState(TEST_CAMPAIGN);
  assert.deepEqual(st.notes.clue, ['墓室石棺下藏有密道']);
  assert.deepEqual(st.notes.npc, ['村长托宾悬赏 25gp']);
  manageNotes(TEST_CAMPAIGN, { cat: 'clue', remove: '密道' });
  assert.equal(getState(TEST_CAMPAIGN).notes.clue.length, 0);

  // 遭遇难度计算器：1 名 1 级角色 vs 3 只 CR 1/4 骷髅 (150 XP > High 100 XP) -> 致命 + 单人行动经济警告
  const soloCalc = calculateEncounterDifficulty({ partyLevels: [1], monsterCrs: ['1/4', '1/4', '1/4'] });
  assert.equal(soloCalc.totalMonsterXp, 150);
  assert.equal(soloCalc.difficulty, '致命 (Deadly)');
  assert.ok(soloCalc.warnings.length >= 1, '1 打 3 必须触发单人行动经济警告');

  // 加入随从布兰后 (2 名 1 级角色: Moderate 预算 150 XP, High 预算 200 XP) -> 150 XP 降为中等 (Moderate) 且无 1v3 警告
  const duoCalc = calculateEncounterDifficulty({ partyLevels: [1, 1], monsterCrs: ['1/4', '1/4', '1/4'] });
  assert.equal(duoCalc.difficulty, '中等 (Moderate)');
  assert.equal(duoCalc.warnings.length, 0);

  const highCalc = calculateEncounterDifficulty({ partyLevels: [1, 1], monsterCrs: ['1/4', '1/4', '1/2'] });
  assert.equal(highCalc.difficulty, '困难 (High)');

  // HUD --veil 迷雾模式隐藏敌方精确 HP 数字
  addEncounterMob(TEST_CAMPAIGN, { name: '骷髅', hp: 13, ac: 14, count: 2 });
  damageEncounterMob(TEST_CAMPAIGN, '骷髅-1', 4); // 9/13 -> 轻伤
  st = getState(TEST_CAMPAIGN);
  const veiledHud = generateHud(st, 'combat', { veil: true });
  assert.ok(veiledHud.includes('状态【轻伤】') && veiledHud.includes('状态【完好】'));
  assert.ok(!veiledHud.includes('9/13') && !veiledHud.includes('AC 14'), '--veil 模式下严禁向玩家泄露怪物精确 HP 与 AC');
});

test('state - 端到端全工具链战斗推演闭环：战士瓦伦 + 随从布兰 vs 3 只 2025 骷髅 & 《秽染溪泉》 (Stage 3 & 5 Gate)', () => {
  // 1. 检索 2025 骷髅真实数据卡
  const skelLookup = lookup('monster', '骷髅', { brief: true, json: true });
  assert.equal(skelLookup.found, true);
  assert.equal(skelLookup.entry.edition, '2024');

  // 2. 初始化瓦伦 + 布兰小队
  const camp = TEST_CAMPAIGN;
  initSession(camp, { preset: 'valen,bran', location: '低语地窖·外殿', quest: '净化亡灵祭坛' });
  addEncounterMob(camp, { name: '骷髅', hp: 13, ac: 14, count: 3, init: 12 });
  updateState(camp, { who: '瓦伦', init: 15 });
  updateState(camp, { who: '布兰', init: 11 });

  // 3. 执行真实攻击与巨剑【擦掠】/命中结算
  const atk = roll('1d20+5', { attack: true, ac: 14 });
  if (atk.hit) {
    const dmg = roll('2d6+3', { crit: atk.autoHit });
    damageEncounterMob(camp, '骷髅-1', dmg.total);
  } else {
    // 2024 巨剑【擦掠 Graze】：未命中仍保底造成力量调整值 3 点挥砍伤害（骷髅无挥砍抗性）
    damageEncounterMob(camp, '骷髅-1', 3);
  }
  assert.ok(getState(camp).status.encounter.mobs[0].hp <= 10, '无论命中还是触发擦掠，骷髅-1 必须真实扣血');

  // 4. 模拟清剿全部骷髅、记录线索笔记并短休恢复
  damageEncounterMob(camp, '骷髅-1', 20);
  damageEncounterMob(camp, '骷髅-2', 20);
  damageEncounterMob(camp, '骷髅-3', 20);
  assert.ok(getState(camp).status.encounter.mobs.every(m => m.conditions.includes('阵亡')));

  clearEncounter(camp);
  manageNotes(camp, { cat: 'clue', add: '祭坛暗格发现触月剑与血契残页' });
  updateState(camp, { addItem: '触月剑', hp: '-5', reason: '骨箭擦伤' });
  updateState(camp, { useResource: '回气', hp: '+6', reason: '回气自愈' });
  const finalState = applyRest(camp, 'short');

  assert.equal(finalState.status.inCombat, false);
  assert.equal(finalState.party[0].hp.current, 12);
  assert.equal(finalState.party[0].resources['回气'].current, 2);
  assert.ok(finalState.inventory.items.some(i => i.name === '触月剑'));
});

test('state - parseCliArgs 严格参数解析与 --flag=value 支持', () => {
  const parsed = parseCliArgs([
    'update',
    'phandelver',
    '--hp=-5',
    '--reason=地精弯刀',
    '--add-condition', '中毒:2'
  ]);
  assert.equal(parsed.command, 'update');
  assert.equal(parsed.campaign, 'phandelver');
  assert.equal(parsed.options.hp, '-5');
  assert.equal(parsed.options.reason, '地精弯刀');
  assert.equal(parsed.options.addCondition, '中毒:2');

  assert.throws(() => parseCliArgs(['update', 'phandelver', '--bogus-flag']), /未知的命令行选项/);
});
