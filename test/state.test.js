import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  clearEncounter
} from '../scripts/state.js';

const TEST_CAMPAIGN = 'unit-test-campaign';

test.beforeEach(() => {
  const p = getSessionPath(TEST_CAMPAIGN);
  const dir = path.dirname(p);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test.after(() => {
  const p = getSessionPath(TEST_CAMPAIGN);
  const dir = path.dirname(p);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
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
});

test('state - 临时生命抵扣机制 (Temp HP absorbs damage first)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  // 获得 6 点临时生命
  updateState(TEST_CAMPAIGN, { tempHp: 6 });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 6);
  assert.equal(state.character.hp.current, 20);

  // 受到 8 点伤害 (6点被临时生命完全吸收，实际生命扣除2点 -> 18)
  updateState(TEST_CAMPAIGN, { hp: '-8' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.temp, 0, '临时生命应归零');
  assert.equal(state.character.hp.current, 18, '实际生命扣除剩余的 2 点');
});

test('state - 2024 浴血 (Bloodied) 状态自动触发与消除', () => {
  initSession(TEST_CAMPAIGN, { hp: 20 });

  // 扣除 11 点生命 -> 当前 9/20 (低于一半 10 点，触发浴血)
  updateState(TEST_CAMPAIGN, { hp: '-11' });
  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 9);
  assert.ok(state.status.conditions.includes('浴血'), '生命跌破半数应自动添加浴血');

  // 恢复 5 点生命 -> 当前 14/20 (超过一半，解除浴血)
  updateState(TEST_CAMPAIGN, { hp: '+5' });
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 14);
  assert.ok(!state.status.conditions.includes('浴血'), '生命恢复半数以上应自动脱离浴血');
});

test('state - 法术位与金币物品更新', () => {
  initSession(TEST_CAMPAIGN, {
    slots: '1:3,2:1',
    gold: 20
  });

  // 消耗 1 个 1 环法术位
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
});

test('state - 长休恢复 (满血与恢复法术位)', () => {
  initSession(TEST_CAMPAIGN, { hp: 20, slots: '1:2' });
  updateState(TEST_CAMPAIGN, { hp: '-15', slotLevel: 1, slotChange: '-2' });

  let state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 5);
  assert.equal(state.character.spellSlots[1].current, 0);

  // 执行长休
  applyRest(TEST_CAMPAIGN, 'long');
  state = getState(TEST_CAMPAIGN);
  assert.equal(state.character.hp.current, 20);
  assert.equal(state.character.spellSlots[1].current, 2);
});

test('state - HUD 状态栏文本生成', () => {
  const state = initSession(TEST_CAMPAIGN, { name: '雷恩', class: '游侠', hp: 16 });
  const hudLine = generateHud(state, 'line');
  assert.ok(hudLine.includes('雷恩'));
  assert.ok(hudLine.includes('16/16'));

  const hudCombat = generateHud(state, 'combat');
  assert.ok(hudCombat.includes('行动仪表盘'));
  assert.ok(hudCombat.includes('雷恩'));
});

test('state - 遭遇战怪物小队生成与管理 (mob-add)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  const state = addEncounterMob(TEST_CAMPAIGN, {
    name: '地精武者',
    hp: 10,
    ac: 15,
    count: 2,
    init: 14
  });

  assert.equal(state.status.inCombat, true, '应标记进入战斗状态');
  assert.equal(state.status.encounter.active, true, '遭遇战应激活');
  assert.equal(state.status.encounter.mobs.length, 2, '应生成 2 只怪物');
  assert.equal(state.status.encounter.mobs[0].id, '地精武者-1');
  assert.equal(state.status.encounter.mobs[0].hp, 10);
  assert.equal(state.status.encounter.mobs[0].ac, 15);
  assert.equal(state.status.encounter.mobs[0].initiative, 14);
  assert.equal(state.status.encounter.mobs[1].id, '地精武者-2');
});

test('state - 遭遇战怪物受击、浴血与阵亡判定 (mob-hit)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  addEncounterMob(TEST_CAMPAIGN, { name: '兽人狂战士', hp: 20, ac: 13, count: 1 });

  // 受到 12 点伤害 -> 剩余 8/20 (低于一半，触发浴血)
  let state = damageEncounterMob(TEST_CAMPAIGN, '兽人狂战士', 12);
  let mob = state.status.encounter.mobs[0];
  assert.equal(mob.hp, 8);
  assert.ok(mob.conditions.includes('浴血'), '跌破半血应获得浴血状态');

  // 受到致命 10 点伤害 -> 归零，触发阵亡
  state = damageEncounterMob(TEST_CAMPAIGN, '兽人狂战士', 10);
  mob = state.status.encounter.mobs[0];
  assert.equal(mob.hp, 0);
  assert.ok(mob.conditions.includes('阵亡'), '生命归零应标记阵亡');
});

test('state - 遭遇战清理与 HUD 怪物列表呈现 (mob-clear & HUD)', () => {
  initSession(TEST_CAMPAIGN, { name: '瓦伦', hp: 12 });
  addEncounterMob(TEST_CAMPAIGN, { name: '地精武者', hp: 10, ac: 15, count: 2 });
  damageEncounterMob(TEST_CAMPAIGN, '地精武者-1', 6);

  let state = getState(TEST_CAMPAIGN);
  const hud = generateHud(state, 'combat');
  assert.ok(hud.includes('敌方战斗目标'), 'HUD 应包含怪物目标清单');
  assert.ok(hud.includes('地精武者-1'), 'HUD 应包含地精武者-1');
  assert.ok(hud.includes('浴血'), '受损怪物应显示浴血');

  // 清理遭遇战
  state = clearEncounter(TEST_CAMPAIGN);
  assert.equal(state.status.inCombat, false);
  assert.equal(state.status.encounter.mobs.length, 0);
  assert.equal(state.status.round, 0);
});

