import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initSession,
  getState,
  updateState,
  applyRest,
  generateHud,
  getSessionPath,
  addEncounterMob,
  damageEncounterMob,
  clearEncounter,
  parseCliArgs
} from '../scripts/state.js';

const TEMP_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-sessions-'));
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
  // 牧师生命骰默认推断为 d8
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

  // 验证状态未被 NaN 污染
  const state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 20);
  assert.equal(state.character.ac, 15);
  assert.equal(state.inventory.gold, 50);
  assert.equal(state.status.encounter.mobs[0].hp, 10);
});

test('state - 未初始化战役调用 update 或 mob-add 时显式报错拒绝隐式建档 (M8)', () => {
  assert.throws(
    () => updateState('non-existent-campaign', { hp: '-5' }),
    /未找到战役/
  );
  assert.throws(
    () => addEncounterMob('non-existent-campaign', { name: '地精', hp: 7 }),
    /未找到战役/
  );
});

test('state - 原子写盘与 .bak 备份机制 (M9)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  updateState(TEST_CAMPAIGN, { hp: '-3' });

  const sessionFile = getSessionPath(TEST_CAMPAIGN);
  const bakFile = `${sessionFile}.bak`;
  const dirFiles = fs.readdirSync(path.dirname(sessionFile));

  assert.ok(fs.existsSync(sessionFile), 'state.json 应存在');
  assert.ok(fs.existsSync(bakFile), '更新后应生成 state.json.bak 备份');
  assert.ok(!dirFiles.some(f => f.endsWith('.tmp')), '写盘完成后不应残留 .tmp 临时文件');

  const bakData = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
  assert.equal(bakData.character.hp.current, 12, '备份文件应保存更新前的状态');
});

test('state - 临时生命抵扣机制 (Temp HP absorbs damage first)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  updateState(TEST_CAMPAIGN, { tempHp: 6 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 6);
  assert.equal(state.character.hp.current, 20);

  updateState(TEST_CAMPAIGN, { hp: '-8' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 0, '临时生命应归零');
  assert.equal(state.character.hp.current, 18, '实际生命扣除剩余的 2 点');
});

test('state - 2024 浴血 (Bloodied) 状态自动触发、消除与 HUD 去重 (L9)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  // 扣除 11 点生命 -> 当前 9/20 (低于一半 10 点，触发浴血)
  updateState(TEST_CAMPAIGN, { hp: '-11' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 9);
  assert.ok(state.status.conditions.includes('浴血'), '生命跌破半数应自动添加浴血');

  // HUD 中 [浴血] 只应出现一次，不应重复渲染
  const hudLine = generateHud(state, 'line');
  const matches = hudLine.match(/浴血/g) || [];
  assert.equal(matches.length, 1, 'HUD 单行模式中“浴血”应仅渲染一次');

  // 恢复 5 点生命 -> 当前 14/20 (超过一半，解除浴血)
  updateState(TEST_CAMPAIGN, { hp: '+5' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 14);
  assert.ok(!state.status.conditions.includes('浴血'), '生命恢复半数以上应自动脱离浴血');
});

test('state - 调整生命上限 (--max-hp) 时自动钳制当前生命并重算浴血 (M7)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  // 将上限下调至 15，当前生命应从 20 自动钳制到 15
  updateState(TEST_CAMPAIGN, { maxHp: 15 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.max, 15);
  assert.equal(state.character.hp.current, 15);
  assert.ok(!state.status.conditions.includes('浴血'));

  // 扣至 8/15 (未跌破 floor(15/2)=7，不浴血)，随后将上限提升至 20 -> 8/20 (<=10，应自动触发浴血)
  updateState(TEST_CAMPAIGN, { hp: 8 });
  assert.ok(!getState(TEST_CAMPAIGN).status.conditions.includes('浴血'));

  updateState(TEST_CAMPAIGN, { maxHp: 20 });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 8);
  assert.ok(state.status.conditions.includes('浴血'), '上限提高导致当前HP占比<=50%时应触发浴血');
});

test('state - 法术位与金币物品更新及未初始化环位报错 (L7)', () => {
  initSession(TEST_CAMPAIGN, {
    slots: '1:3,2:1',
    gold: 20
  });

  updateState(TEST_CAMPAIGN, {
    slotLevel: 1,
    slotChange: '-1',
    gold: '+15',
    addItem: '治疗药水'
  });

  const state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.spellSlots[1].current, 2);
  assert.equal(state.character.spellSlots[1].max, 3);
  assert.equal(state.inventory.gold, 35);
  assert.ok(state.inventory.items.some(i => i.name === '治疗药水'));

  // 消耗不存在的 3 环法术位应报错
  assert.throws(
    () => updateState(TEST_CAMPAIGN, { slotLevel: 3, slotChange: '-1' }),
    /没有可用的 3 环法术位/
  );
});

test('state - 2024 长休规则：恢复全部生命值骰且不擅自移除中毒 (H3)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20, level: 4, class: '战士', slots: '1:2' });
  updateState(TEST_CAMPAIGN, {
    hp: '-15',
    slotLevel: 1,
    slotChange: '-2',
    addCondition: '中毒,魅惑'
  });

  // 先在短休中消耗 3 颗生命骰
  applyRest(TEST_CAMPAIGN, 'short', { dice: 3, heal: 5 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hitDice.current, 1, '短休消耗 3 颗后应剩 1 颗');

  // 执行 2024 长休
  applyRest(TEST_CAMPAIGN, 'long');
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 20);
  assert.equal(state.character.spellSlots[1].current, 2);
  assert.equal(state.character.hitDice.current, 4, '2024 PHB 长休应恢复所有已消耗的生命值骰 (4/4)');
  assert.ok(state.status.conditions.includes('中毒'), '长休不应擅自自动清除中毒状态');
  assert.ok(state.status.conditions.includes('魅惑'), '长休不应擅自自动清除魅惑状态');
});

test('state - 短休消耗生命值骰回血与死亡豁免追踪 (L10)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20, level: 2, class: '野蛮人' });
  assert.equal(getState(TEST_CAMPAIGN).character.hitDice.die, 'd12');

  // 生命归零触发昏迷，随后在 0 HP 下再受击应自动累加死亡豁免失败
  updateState(TEST_CAMPAIGN, { hp: '-20' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 0);
  assert.ok(state.status.conditions.includes('昏迷'));

  // 0 HP 时受到伤害 -> 自动 +1 死亡豁免失败
  updateState(TEST_CAMPAIGN, { hp: '-4' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.deathSaves.failures, 1);

  // 手动记录 1 次死亡豁免成功
  updateState(TEST_CAMPAIGN, { deathSave: 'success' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.deathSaves.successes, 1);

  // 短休消耗 1 颗生命骰恢复 8 点生命 -> 脱离昏迷并重置死亡豁免
  applyRest(TEST_CAMPAIGN, 'short', { dice: 1, heal: 8 });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 8);
  assert.equal(state.character.hitDice.current, 1);
  assert.equal(state.character.deathSaves.failures, 0, '恢复生命脱离0HP后死亡豁免失败应清零');
  assert.equal(state.character.deathSaves.successes, 0, '恢复生命脱离0HP后死亡豁免成功应清零');
  assert.ok(!state.status.conditions.includes('昏迷'));
});

test('state - 职业生命骰与物种移动速度自动推断 (L11)', () => {
  const wizardGoliath = initSession(TEST_CAMPAIGN, {
    name: '奥术歌利亚',
    class: '法师',
    species: '歌利亚',
    level: 1,
    hp: 8
  });
  assert.equal(wizardGoliath.character.hitDice.die, 'd6', '法师生命骰应推断为 d6');
  assert.equal(wizardGoliath.character.speed, 35, '歌利亚速度应推断为 35 尺');
});

test('state - 遭遇战怪物增援顺延编号不覆盖已有伤员且优先攻击存活目标 (M6, L6)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 10, ac: 15, count: 2, init: 14 });

  // 击杀 地精武者-1
  damageEncounterMob(TEST_CAMPAIGN, '地精武者-1', 10);
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.status.encounter.mobs[0].hp, 0);
  assert.ok(state.status.encounter.mobs[0].conditions.includes('阵亡'));

  // 再次增援 1 只同名地精武者 -> 编号应顺延为 地精武者-3，不覆盖 地精武者-1
  state = addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 10, ac: 15, count: 1, init: 12 });
  assert.equal(state.status.encounter.mobs.length, 3);
  assert.equal(state.status.encounter.mobs[0].id, '地精武者-1');
  assert.equal(state.status.encounter.mobs[0].hp, 0, '原有阵亡的地精武者-1不应被重置');
  assert.equal(state.status.encounter.mobs[2].id, '地精武者-3');

  // 对模糊名称 "地精武者" 造成 4 点伤害 -> 应自动跳过已阵亡的 地精武者-1，命中存活的 地精武者-2
  state = damageEncounterMob(TEST_CAMPAIGN, '地精武者', 4);
  assert.equal(state.status.encounter.mobs[0].hp, 0);
  assert.equal(state.status.encounter.mobs[1].hp, 6, '应优先命中存活的地精武者-2');
});

test('state - 遭遇战清理与 HUD 怪物列表呈现及 30 条日志裁剪上限 (L8)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 100, ac: 15, count: 1 });

  for (let i = 0; i < 35; i++) {
    damageEncounterMob(TEST_CAMPAIGN, '地精武者-1', 1);
  }

  let state = getState(TEST_CAMPAIGN);
  assert.ok(state.log.length <= 30, `日志条数应严格截断在 30 条以内，当前: ${state.log.length}`);

  state = clearEncounter(TEST_CAMPAIGN);
  assert.equal(state.status.inCombat, false);
  assert.equal(state.status.encounter.mobs.length, 0);
  assert.equal(state.status.round, 0);
  assert.ok(state.log.length <= 30);
});

test('state - HUD 增量算式防漂移回显、临时生命不叠加取高值与长休力竭逐层递减', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });

  updateState(TEST_CAMPAIGN, { tempHp: 5 });
  updateState(TEST_CAMPAIGN, { tempHp: 3 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 5, '较低的临时生命不应覆盖较高的现有临时生命');

  updateState(TEST_CAMPAIGN, { tempHp: 0 });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 0, '传 0 可显式清空临时生命');

  updateState(TEST_CAMPAIGN, { hp: '-4', reason: '狼爪', addCondition: '力竭 2' });
  state = getState(TEST_CAMPAIGN);
  const hud = generateHud(state, 'line');
  assert.ok(hud.includes('8/12 (-4 狼爪)'), 'HUD 应包含显式增量算式 (-4 狼爪)');

  state = applyRest(TEST_CAMPAIGN, 'long');
  assert.ok(state.status.conditions.includes('力竭 1'), '长休后力竭 2 应降为力竭 1');

  state = applyRest(TEST_CAMPAIGN, 'long');
  assert.ok(!state.status.conditions.some(c => c.includes('力竭')), '再次长休后力竭 1 应彻底消除');
});

test('state - parseCliArgs 命令行参数解析覆盖', () => {
  const parsed = parseCliArgs([
    'update',
    'phandelver',
    '--hp', '-5',
    '--reason', '地精弯刀',
    '--add-condition', '中毒'
  ]);
  assert.equal(parsed.command, 'update');
  assert.equal(parsed.campaign, 'phandelver');
  assert.equal(parsed.options.hp, '-5');
  assert.equal(parsed.options.reason, '地精弯刀');
  assert.equal(parsed.options.addCondition, '中毒');
});
