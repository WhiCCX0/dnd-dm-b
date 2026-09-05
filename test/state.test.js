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
  getSessionPath
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
