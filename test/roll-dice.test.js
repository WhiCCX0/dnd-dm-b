import test from 'node:test';
import assert from 'node:assert/strict';
import { roll } from '../scripts/roll-dice.js';

test('roll - 标准 d20 投骰', () => {
  const res = roll('1d20+5');
  assert.ok(res.total >= 6 && res.total <= 25, '结果应在 6 到 25 之间');
  assert.equal(res.rolls.length, 1);
  assert.equal(res.mod, 5);
});

test('roll - 多骰伤害计算 (2d6+3)', () => {
  const res = roll('2d6+3');
  assert.ok(res.total >= 5 && res.total <= 15, '结果应在 5 到 15 之间');
  assert.equal(res.rolls.length, 2);
  assert.equal(res.mod, 3);
});

test('roll - 属性生成 4d6kh3 (四骰取高三)', () => {
  const res = roll('4d6kh3');
  assert.ok(res.total >= 3 && res.total <= 18, '结果应在 3 到 18 之间');
  assert.equal(res.rolls.length, 4);
  assert.equal(res.kept.length, 3);
});

test('roll - 优势判定 (--adv 取高)', () => {
  const res = roll('1d20+2', { advantage: true });
  assert.equal(res.rolls.length, 2);
  assert.equal(res.chosen, Math.max(res.rolls[0], res.rolls[1]));
  assert.equal(res.total, res.chosen + 2);
});

test('roll - 劣势判定 (--dis 取低)', () => {
  const res = roll('1d20+2', { disadvantage: true });
  assert.equal(res.rolls.length, 2);
  assert.equal(res.chosen, Math.min(res.rolls[0], res.rolls[1]));
  assert.equal(res.total, res.chosen + 2);
});

test('roll - 暴击骰数翻倍 (--crit)', () => {
  const res = roll('2d6+3', { crit: true });
  assert.equal(res.rolls.length, 4, '2d6 暴击应投 4 个骰子');
});

test('roll - 目标 DC 难度判定', () => {
  const pass = roll('1d20+100', { dc: 15 });
  assert.equal(pass.success, true);

  const fail = roll('1d20-100', { dc: 15 });
  assert.equal(fail.success, false);
});

test('roll - 错误表达式输入防御', () => {
  assert.throws(() => roll('invalid-dice'), /Invalid dice expression/);
  assert.throws(() => roll('abc'), /Invalid dice expression/);
});

test('roll - 复合骰子表达式 (1d8+3+2d8 长剑至圣斩)', () => {
  const res = roll('1d8+3+2d8');
  assert.equal(res.rolls.length, 3, '应投 3 个骰子 (1d8 + 2d8)');
  assert.equal(res.mod, 3, '修正值应为 3');
  assert.ok(res.total >= 6 && res.total <= 27, '伤害总值应在 6 到 27 之间');
  assert.equal(res.terms.length, 3);
});

test('roll - 复合骰子暴击伤害翻倍 (1d8+3+2d8 --crit)', () => {
  const res = roll('1d8+3+2d8', { crit: true });
  assert.equal(res.rolls.length, 6, '暴击后骰子数量翻倍: 2d8 + 4d8 = 6 个骰子');
  assert.equal(res.mod, 3, '固定修正值不翻倍');
  assert.ok(res.total >= 9 && res.total <= 51, '暴击伤害总值应在 9 到 51 之间');
});

test('roll - 复合增益检定 (1d20+5+1d4 祝福术加持)', () => {
  const res = roll('1d20+5+1d4');
  assert.equal(res.rolls.length, 2, '投掷 1 个 d20 和 1 个 d4');
  assert.equal(res.mod, 5);
  assert.ok(res.total >= 7 && res.total <= 29);
});

test('roll - 复合减益检定 (1d20+5-1d4 灾祸术扣除)', () => {
  const res = roll('1d20+5-1d4');
  assert.equal(res.rolls.length, 2);
  assert.equal(res.mod, 5);
  assert.ok(res.total >= 2 && res.total <= 24);
});

