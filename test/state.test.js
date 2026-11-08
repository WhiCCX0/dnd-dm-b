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
  advanceSessionTime,
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

test('state - 0 HP 受到伤害即使被临时 HP 完全吸收也增加死亡豁免失败', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  updateState(TEST_CAMPAIGN, { hp: '-12' });
  updateState(TEST_CAMPAIGN, { tempHp: 5 });
  updateState(TEST_CAMPAIGN, { hp: '-3' });
  const state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 0);
  assert.equal(state.character.hp.temp, 2);
  assert.equal(state.character.deathSaves.failures, 1);
});

test('state - 休息门禁：0 HP 与战斗中禁止休息，短休自动读取 CON，满血时不浪费生命骰', () => {
  initSession(TEST_CAMPAIGN, { preset: 'valen' });
  updateState(TEST_CAMPAIGN, { hp: '-12' });
  assert.throws(() => applyRest(TEST_CAMPAIGN, 'short'), /没有 HP 至少为 1/);

  initSession(TEST_CAMPAIGN, { preset: 'valen', force: true });
  addEncounterMob(TEST_CAMPAIGN, { name: '守卫', hp: 10, ac: 12 });
  assert.throws(() => applyRest(TEST_CAMPAIGN, 'short'), /不能开始休息/);

  clearEncounter(TEST_CAMPAIGN);
  initSession(TEST_CAMPAIGN, {
    name: '瓦伦',
    class: '战士',
    level: 2,
    hp: 20,
    abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    force: true
  });
  updateState(TEST_CAMPAIGN, { hp: '-12' });
  const rested = applyRest(TEST_CAMPAIGN, 'short', { dice: 2, rng: () => 0.99 });
  assert.equal(rested.character.hp.current, 20);
  assert.equal(rested.character.hitDice.current, 1, '恢复满血后应停止继续消耗生命骰');

  const noWaste = applyRest(TEST_CAMPAIGN, 'short', { dice: 1, rng: () => 0.99 });
  assert.equal(noWaste.character.hp.current, 20);
  assert.equal(noWaste.character.hitDice.current, 1, '满血时不应消耗生命骰');
});

test('state - 长休按资源恢复规则结算：短休资源全恢复、长休定量资源递增、非休息资源不变', () => {
  initSession(TEST_CAMPAIGN, {
    name: '资源测试者',
    class: '战士',
    hp: 12,
    setResource: [
      '短休资源:0/3:short:1',
      '长休定量资源:0/3:long:1',
      '长休全恢复资源:0/3:long:all',
      '不恢复资源:0/3:never'
    ]
  });

  applyRest(TEST_CAMPAIGN, 'long');
  const resources = getState(TEST_CAMPAIGN).character.resources;
  assert.equal(resources['短休资源'].current, 3, '长休也应恢复短休资源');
  assert.equal(resources['长休定量资源'].current, 1, 'long:1 只恢复 1 点');
  assert.equal(resources['长休全恢复资源'].current, 3, 'long:all 恢复至上限');
  assert.equal(resources['不恢复资源'].current, 0, '未知/非休息恢复规则不得被强行重置');
});

test('state - 非 D 模式累计游戏时钟执行 16 小时长休间隔', () => {
  initSession(TEST_CAMPAIGN, { hp: 12 });
  applyRest(TEST_CAMPAIGN, 'long');
  assert.equal(getState(TEST_CAMPAIGN).clock.elapsedHours, 8);
  assert.throws(() => applyRest(TEST_CAMPAIGN, 'long'), /至少等待 16 小时/);
  advanceSessionTime(TEST_CAMPAIGN, 16);
  applyRest(TEST_CAMPAIGN, 'long');
  assert.equal(getState(TEST_CAMPAIGN).clock.elapsedHours, 32);
});

test('state - 预制角色的技能、豁免、攻击和背景数据进入唯一权威存档', () => {
  const state = initSession(TEST_CAMPAIGN, { preset: 'valen' });
  const character = state.character;
  assert.equal(character.background, '士兵 (Soldier)');
  assert.equal(character.proficiencyBonus, 2);
  assert.deepEqual(character.savingThrowProficiencies, ['str', 'con']);
  assert.ok(character.skills['运动']);
  assert.equal(character.attacks[0].name, '巨剑');
  assert.ok(character.startingEquipment.includes('链甲'));
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

test('state (R3) - 临时生命吸收全部或部分伤害时仍按本次全部伤害触发专注检定', () => {
  initSession(TEST_CAMPAIGN, { name: '冯达尔', class: '牧师', hp: 20, slots: '1:2' });
  updateState(TEST_CAMPAIGN, { concentrate: '祝福术', tempHp: 10 });

  // 1) 临时生命 10，受 8 点伤害（全部被临时生命吸收）-> 提示 DC 10
  updateState(TEST_CAMPAIGN, { hp: '-8', reason: '地精短弓' });
  let st = getState(TEST_CAMPAIGN);
  assert.equal(st.character.hp.temp, 2);
  assert.equal(st.character.hp.current, 20);
  assert.equal(st.character.concentrationCheckDc, 10, '临时生命 10 受 8 点伤害应提示专注检定 DC 10');
  assert.ok(st.log.at(-1).detail.includes('DC 10'));

  // 2) 临时生命 5，受 30 点伤害（部分吸收）-> 按全部伤害 30 计算 DC = max(10, floor(30/2)) = 15
  updateState(TEST_CAMPAIGN, { maxHp: 30, hp: 30, tempHp: 5 });
  updateState(TEST_CAMPAIGN, { hp: '-30', reason: '火球术' });
  st = getState(TEST_CAMPAIGN);
  assert.equal(st.character.hp.temp, 0);
  assert.equal(st.character.hp.current, 5);
  assert.equal(st.character.concentrationCheckDc, 15, '临时生命 5 受 30 点伤害应按总伤害 30 提示 DC 15');
  assert.ok(st.log.at(-1).detail.includes('DC 15'));
});

test('state (R4) - 已死亡角色或 HP > 0 角色执行任何 --death-save 均报错且只有 --revive 能移除死亡', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });

  // HP > 0 时执行死亡豁免应报错
  assert.throws(() => updateState(TEST_CAMPAIGN, { deathSave: 'success' }), /无需进行死亡豁免|生命值大于 0/);
  assert.throws(() => updateState(TEST_CAMPAIGN, { deathSave: 'nat20' }), /无需进行死亡豁免|生命值大于 0/);

  // 溢伤即死
  updateState(TEST_CAMPAIGN, { hp: '-24' });
  assert.ok(getState(TEST_CAMPAIGN).status.conditions.includes('死亡'));

  // 死亡角色执行所有死亡豁免分支（含 nat20）必须报错，且状态不变
  for (const ds of ['nat20', 'crit-success', 'success', 'fail', 'nat1', 'reset']) {
    assert.throws(() => updateState(TEST_CAMPAIGN, { deathSave: ds }), /已死亡/);
  }
  let st = getState(TEST_CAMPAIGN);
  assert.equal(st.character.hp.current, 0);
  assert.ok(st.status.conditions.includes('死亡'), '死亡角色在报错后必须仍处于死亡状态');

  // --revive --hp 1 正常复活
  updateState(TEST_CAMPAIGN, { revive: true, hp: 1 });
  st = getState(TEST_CAMPAIGN);
  assert.equal(st.character.hp.current, 1);
  assert.ok(!st.status.conditions.includes('死亡'), '--revive --hp 1 应移除死亡并恢复至 1 HP');
});

test('state (R5) - 先攻推进按 activeTurnId 定位：前序死亡、自身死亡、末位死亡、中途加怪均不跳人，且未设先攻告警', () => {
  // 0. 未设先攻告警：瓦伦未设先攻、布兰未设先攻时进入先攻轮转应记录包含二人名字的警告
  initSession(TEST_CAMPAIGN, { preset: 'valen,bran' });
  addEncounterMob(TEST_CAMPAIGN, { name: '骷髅', hp: 13, ac: 14, count: 1, init: 12 });
  const warnState = advanceTurn(TEST_CAMPAIGN);
  const lastLog = warnState.log.at(-1).detail;
  assert.ok(
    lastLog.includes('瓦伦·铁福德') && lastLog.includes('布兰·铁须') && lastLog.includes('未设'),
    `开战未设先攻应输出包含未设先攻队员名字的警告，实际: ${lastLog}`
  );

  // 1. A(20), B(15), C(12), D(8)，当前 B；A 死亡后执行 next -> 必须轮到 C（不能跳到 D）
  initSession(TEST_CAMPAIGN, { name: 'A', hp: 10, force: true });
  addPartyMember(TEST_CAMPAIGN, { name: 'B', hp: 10 });
  addPartyMember(TEST_CAMPAIGN, { name: 'C', hp: 10 });
  addPartyMember(TEST_CAMPAIGN, { name: 'D', hp: 10 });
  updateState(TEST_CAMPAIGN, { who: 'A', init: 20 });
  updateState(TEST_CAMPAIGN, { who: 'B', init: 15 });
  updateState(TEST_CAMPAIGN, { who: 'C', init: 12 });
  updateState(TEST_CAMPAIGN, { who: 'D', init: 8 });

  let s = advanceTurn(TEST_CAMPAIGN); // Round 1: A
  assert.equal(s.status.activeTurn, 'A');
  assert.ok(s.status.activeTurnId, '存档必须保存 activeTurnId');
  s = advanceTurn(TEST_CAMPAIGN); // Round 1: B
  assert.equal(s.status.activeTurn, 'B');

  // A 死亡（20 点溢伤即死）
  updateState(TEST_CAMPAIGN, { who: 'A', hp: '-20' });
  s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.activeTurn, 'C', 'A 死亡后从 B 推进必须轮到 C，不能跳过 C');
  assert.equal(s.status.round, 1);

  // 2. 当前行动者自己死亡：当前 C 死亡后执行 next -> 轮到 D
  updateState(TEST_CAMPAIGN, { who: 'C', hp: '-20' });
  s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.activeTurn, 'D', '当前行动者 C 死亡后推进应轮到排在其后的 D');
  assert.equal(s.status.round, 1);

  // 3. 末位单位死亡：当前末位 D 死亡后执行 next -> 进入第 2 轮并轮到首位存活者 B
  updateState(TEST_CAMPAIGN, { who: 'D', hp: '-20' });
  s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.round, 2, '末位单位死亡后推进应进入下一轮');
  assert.equal(s.status.activeTurn, 'B', '进入第 2 轮应轮到首位存活单位 B');

  // 4. 中途加入怪物：当前 B(15)，存活还有复生后的 D(8)；中途加入高先攻怪物 E(18) -> B 之后应轮到 D，不跳人也不重复 B
  updateState(TEST_CAMPAIGN, { who: 'D', revive: true, hp: 10 });
  addEncounterMob(TEST_CAMPAIGN, { name: '援军地精', hp: 7, ac: 15, count: 1, init: 18 });
  s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.activeTurn, 'D', '中途加入高先攻怪物后，当前 B 推进应正常轮到 D');
  s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.round, 3);
  assert.equal(s.status.activeTurn, '援军地精-1', '新一轮应按先攻轮到新加入的 18 先攻援军地精-1');
});

test('state (R6) - 带轮数状态仅在 next 递减，先 --round +1 再 next 只减 1', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  updateState(TEST_CAMPAIGN, { init: 15, addCondition: '中毒:2' });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精', hp: 7, ac: 13, count: 1, init: 10 });

  // 先执行 --round +1（仅调整轮次数字），再执行 next 轮到瓦伦
  updateState(TEST_CAMPAIGN, { round: '+1' });
  assert.ok(getState(TEST_CAMPAIGN).status.conditions.includes('中毒:2'), '--round +1 不应递减持续状态轮数');

  const s = advanceTurn(TEST_CAMPAIGN);
  assert.equal(s.status.activeTurn, '瓦伦');
  assert.ok(s.status.conditions.includes('中毒:1'), '先 --round +1 再 next 后，中毒:2 应只减 1 变为 中毒:1');
});

test('state (R7) - 队友同时带“稳定”“中毒”且被判死亡时，“中毒”保留、“稳定”移除', () => {
  initSession(TEST_CAMPAIGN, { preset: 'valen,bran' });
  // 让队友布兰归零进入昏迷，获得稳定，被判死亡且带有中毒，触发 syncHpConditionsForMember
  updateState(TEST_CAMPAIGN, { who: '布兰', hp: '-12' });
  updateState(TEST_CAMPAIGN, { who: '布兰', deathSave: 'success' });
  updateState(TEST_CAMPAIGN, { who: '布兰', deathSave: 'success' });
  updateState(TEST_CAMPAIGN, { who: '布兰', deathSave: 'success' });
  updateState(TEST_CAMPAIGN, { who: '布兰', deathSave: 'crit-fail' });
  updateState(TEST_CAMPAIGN, { who: '布兰', deathSave: 'crit-fail' }); // 累计失败 >= 3 -> 附加“死亡”
  updateState(TEST_CAMPAIGN, { who: '布兰', addCondition: '中毒' });
  updateState(TEST_CAMPAIGN, { who: '布兰', hp: 0 }); // 触发 syncHpConditionsForMember 清理死亡队友的“稳定”

  const branConds = getState(TEST_CAMPAIGN).party[1].conditions;
  assert.ok(branConds.includes('死亡'), '布兰应处于死亡状态');
  assert.ok(!branConds.includes('稳定'), '布兰的“稳定”必须被移除');
  assert.ok(branConds.includes('中毒'), '布兰的“中毒”必须保留，不得因索引错误被误删');
});

test('state (R12.4 & R14) - 短休生命骰随机函数可注入，且存档目录支持环境变量、用户数据目录与旧存档兼容提示', async () => {
  // 1. 短休掷生命骰支持注入 rng 函数
  initSession(TEST_CAMPAIGN, { name: '瓦伦', class: '战士', level: 2, hp: 20 });
  updateState(TEST_CAMPAIGN, { hp: '-15' }); // 当前 5/20
  const rested = applyRest(TEST_CAMPAIGN, 'short', { dice: 1, con: 2, rng: () => 0.99 }); // d10 掷出 10 + 2 = 12 -> 17/20
  assert.equal(rested.character.hp.current, 17, '注入 rng=() => 0.99 时 d10+2 应稳定恢复 12 点生命至 17');

  // 2. R14 三种存档路径策略测试
  const prevDndDir = process.env.DND_SESSIONS_DIR;
  const prevSessionsDir = process.env.SESSIONS_DIR;
  const prevXdg = process.env.XDG_DATA_HOME;
  const tmpXdg = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-xdg-test-'));
  const tmpEnvDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-env-test-'));
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const legacyCampName = `__r14_legacy_probe_${process.pid}`;
  const legacyCampDir = path.join(rootDir, 'sessions', legacyCampName);

  try {
    // 情况 A：设置了 DND_SESSIONS_DIR -> 优先使用环境变量目录
    process.env.DND_SESSIONS_DIR = tmpEnvDir;
    delete process.env.SESSIONS_DIR;
    assert.equal(
      getSessionPath('camp-env'),
      path.join(tmpEnvDir, 'camp-env', 'state.json'),
      '设置 DND_SESSIONS_DIR 时应优先写入该目录'
    );

    // 情况 B：未设环境变量且旧位置无该战役存档 -> 默认写入用户数据目录 (XDG_DATA_HOME / ~/.local/share 或 %APPDATA%)
    delete process.env.DND_SESSIONS_DIR;
    delete process.env.SESSIONS_DIR;
    process.env.XDG_DATA_HOME = tmpXdg;
    const expectedUserPath = process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'dnd-dm-b', 'sessions', 'camp-user', 'state.json')
      : path.join(tmpXdg, 'dnd-dm-b', 'sessions', 'camp-user', 'state.json');
    assert.equal(
      getSessionPath('camp-user'),
      expectedUserPath,
      '未设环境变量且无旧存档时应默认使用技能目录外的用户数据目录'
    );

    // 情况 C：未设环境变量，但 <SKILL_DIR>/sessions/<camp>/state.json 已存在旧存档 -> 继续读取旧位置并给出迁移提示，不移动不删除
    fs.mkdirSync(legacyCampDir, { recursive: true });
    const legacyStateFile = path.join(legacyCampDir, 'state.json');
    initSession('camp-user', { name: '新目录模板', hp: 10 });
    fs.copyFileSync(expectedUserPath, legacyStateFile);

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      const resolvedLegacy = getSessionPath(legacyCampName);
      assert.equal(resolvedLegacy, legacyStateFile, '发现旧位置已有存档时应继续读取旧位置');
      const loaded = getState(legacyCampName);
      assert.ok(loaded, '应能正常读取旧位置存档');
      assert.ok(fs.existsSync(legacyStateFile), '不应自动移动或删除旧位置存档');
      assert.ok(
        warnings.some(w => w.includes('迁移') || w.includes('旧')),
        '读取旧位置存档时应输出可迁移提示'
      );
    } finally {
      console.warn = origWarn;
    }
  } finally {
    if (prevDndDir !== undefined) process.env.DND_SESSIONS_DIR = prevDndDir;
    else delete process.env.DND_SESSIONS_DIR;
    if (prevSessionsDir !== undefined) process.env.SESSIONS_DIR = prevSessionsDir;
    else delete process.env.SESSIONS_DIR;
    if (prevXdg !== undefined) process.env.XDG_DATA_HOME = prevXdg;
    else delete process.env.XDG_DATA_HOME;
    fs.rmSync(tmpXdg, { recursive: true, force: true });
    fs.rmSync(tmpEnvDir, { recursive: true, force: true });
    fs.rmSync(legacyCampDir, { recursive: true, force: true });
    const sessionsRoot = path.join(rootDir, 'sessions');
    if (fs.existsSync(sessionsRoot) && fs.readdirSync(sessionsRoot).length === 0) {
      fs.rmdirSync(sessionsRoot);
    }
  }
});

test('state (T8) - 文档含便携部署 PowerShell 说明，设置 DND_SESSIONS_DIR 写入目标目录，且位于系统盘时 init 给出迁移提示', async () => {
  const { spawnSync } = await import('node:child_process');
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

  for (const docName of ['README.md', 'SKILL.md']) {
    const content = fs.readFileSync(path.join(rootDir, docName), 'utf8');
    assert.ok(content.includes('便携部署'), `${docName} 必须包含“便携部署”说明`);
    assert.ok(
      content.includes("[Environment]::SetEnvironmentVariable('DND_SESSIONS_DIR','D:\\Data\\dnd-dm-b\\sessions','User')"),
      `${docName} 必须包含设置 DND_SESSIONS_DIR 的 PowerShell 示例`
    );
    assert.ok(content.includes('DND_DB_DIR'), `${docName} 便携部署说明应同步涵盖数据库位置变量 DND_DB_DIR`);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-t8-port-'));
  const customSessions = path.join(tmpBase, 'portable-d-drive', 'sessions');
  const fakeSysDrive = path.join(tmpBase, 'fake-c-drive');
  const fakeXdg = path.join(fakeSysDrive, 'appdata');

  try {
    // 1. 设置 DND_SESSIONS_DIR 指向非系统盘目录 -> 写入该目录且不提示系统盘迁移
    const envPortable = { ...process.env, DND_SESSIONS_DIR: customSessions, SystemDrive: fakeSysDrive };
    const rPortable = spawnSync(
      process.execPath,
      [path.join(rootDir, 'scripts', 'state.js'), 'init', 't8-portable', '--force'],
      { cwd: os.tmpdir(), env: envPortable, encoding: 'utf8' }
    );
    assert.equal(rPortable.status, 0);
    assert.ok(fs.existsSync(path.join(customSessions, 't8-portable', 'state.json')), '存档应写入 DND_SESSIONS_DIR 指定目录');
    assert.ok(!rPortable.stdout.includes('系统盘'), '已位于非系统盘时不应输出系统盘迁移提示');

    // 2. 存档路径位于系统盘 (SystemDrive) -> init 输出一行提示可用 DND_SESSIONS_DIR 迁移
    const envSysDrive = { ...process.env, SystemDrive: fakeSysDrive, XDG_DATA_HOME: fakeXdg, APPDATA: fakeXdg };
    delete envSysDrive.DND_SESSIONS_DIR;
    delete envSysDrive.SESSIONS_DIR;
    const rSys = spawnSync(
      process.execPath,
      [path.join(rootDir, 'scripts', 'state.js'), 'init', 't8-sysdrive', '--force'],
      { cwd: os.tmpdir(), env: envSysDrive, encoding: 'utf8' }
    );
    assert.equal(rSys.status, 0);
    assert.ok(
      rSys.stdout.includes('系统盘') && rSys.stdout.includes('DND_SESSIONS_DIR'),
      `存档位于系统盘时 init 必须附一行提示可用 DND_SESSIONS_DIR 迁移，实际输出:\n${rSys.stdout}`
    );
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

