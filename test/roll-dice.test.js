import test from 'node:test';
import assert from 'node:assert/strict';
import { roll, parseArgs } from '../scripts/roll-dice.js';

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

test('roll - 属性生成 4d6kh3 (四骰取高三) 与 4d6kl3 (四骰取低三) (L5)', () => {
  const kh = roll('4d6kh3');
  assert.ok(kh.total >= 3 && kh.total <= 18, '结果应在 3 到 18 之间');
  assert.equal(kh.rolls.length, 4);
  assert.equal(kh.kept.length, 3);
  const sortedDesc = [...kh.rolls].sort((a, b) => b - a);
  assert.deepEqual(kh.kept, sortedDesc.slice(0, 3));

  const kl = roll('4d6kl3+1');
  assert.ok(kl.total >= 4 && kl.total <= 19);
  assert.equal(kl.rolls.length, 4);
  assert.equal(kl.kept.length, 3);
  const sortedAsc = [...kl.rolls].sort((a, b) => a - b);
  assert.deepEqual(kl.kept, sortedAsc.slice(0, 3));
  assert.equal(kl.total, kl.kept.reduce((a, b) => a + b, 0) + 1);
});

test('roll - kh/kl 表达式支持 --crit 暴击骰数翻倍 (L5)', () => {
  const res = roll('2d6kh1+3', { crit: true });
  assert.equal(res.rolls.length, 4, '2d6kh1 在 --crit 下应翻倍投 4 颗骰子');
  assert.equal(res.kept.length, 2, '保留骰数也应相应翻倍为 2 颗');
});

test('roll - 优势判定 (--adv 取高) 与 劣势判定 (--dis 取低)', () => {
  const adv = roll('1d20+2', { advantage: true });
  assert.equal(adv.rolls.length, 2);
  assert.equal(adv.chosen, Math.max(adv.rolls[0], adv.rolls[1]));
  assert.equal(adv.total, adv.chosen + 2);

  const dis = roll('1d20+2', { disadvantage: true });
  assert.equal(dis.rolls.length, 2);
  assert.equal(dis.chosen, Math.min(dis.rolls[0], dis.rolls[1]));
  assert.equal(dis.total, dis.chosen + 2);
});

test('roll - 优劣势同时存在时抵消并标注 Adv+Dis Canceled (L3)', () => {
  const canceled = roll('1d20+4', { advantage: true, disadvantage: true });
  assert.equal(canceled.mode, 'Adv+Dis Canceled');
  assert.match(canceled.expr, /Adv\+Dis Canceled/);
  assert.equal(canceled.rolls.length, 2);
  assert.equal(canceled.chosen, canceled.rolls[0], '优劣势抵消时应取第一颗 d20 结果');
  assert.equal(canceled.total, canceled.rolls[0] + 4);
});

test('roll - 非法 --adv / --dis 投骰表达式严格拦截 (L1)', () => {
  assert.throws(() => roll('2d20+5', { advantage: true }), /only applies to a single 1d20 roll/);
  assert.throws(() => roll('2d6+3', { advantage: true }), /only applies to a single 1d20 roll/);
  assert.throws(() => roll('1d20+1d20', { disadvantage: true }), /only applies to a single 1d20 roll/);
});

test('roll - 非法 --dc 与 --batch 参数校验报错 (L2)', () => {
  assert.throws(() => roll('1d20+5', { dc: 'abc' }), /Invalid DC value/);
  assert.throws(() => roll('1d20+5', { batch: 'abc' }), /Invalid batch count/);
  assert.throws(() => parseArgs(['1d20', '--dc', 'abc']), /Invalid DC value/);
  assert.throws(() => parseArgs(['1d20', '--batch', '0']), /Batch count out of range/);
});

test('roll - 极端数量骰子与超大修正值边界拦截防止精度丢失或卡死 (L4)', () => {
  // 总骰子数超过 100 颗
  const tenHundred = Array(10).fill('20d6').join('+');
  assert.throws(() => roll(tenHundred), /Total dice count .* out of range/);

  // 修正值超过 10000
  assert.throws(() => roll('1d20+99999999999999999999'), /Modifier value out of range/);
  assert.throws(() => roll('4d6kh3+50000'), /out of range/);
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

test('roll - 复合骰子表达式 (1d8+3+2d8 长剑至圣斩) 与暴击翻倍', () => {
  const res = roll('1d8+3+2d8');
  assert.equal(res.rolls.length, 3, '应投 3 个骰子 (1d8 + 2d8)');
  assert.equal(res.mod, 3, '修正值应为 3');
  assert.ok(res.total >= 6 && res.total <= 27, '伤害总值应在 6 到 27 之间');
  assert.equal(res.terms.length, 3);

  const critRes = roll('1d8+3+2d8', { crit: true });
  assert.equal(critRes.rolls.length, 6, '暴击后骰子数量翻倍: 2d8 + 4d8 = 6 个骰子');
  assert.equal(critRes.mod, 3, '固定修正值不翻倍');
  assert.ok(critRes.total >= 9 && critRes.total <= 51, '暴击伤害总值应在 9 到 51 之间');
});

test('roll - 复合增益/减益检定 (1d20+5+1d4 祝福术 / 1d20+5-1d4 灾祸术)', () => {
  const bless = roll('1d20+5+1d4');
  assert.equal(bless.rolls.length, 2, '投掷 1 个 d20 和 1 个 d4');
  assert.equal(bless.mod, 5);
  assert.ok(bless.total >= 7 && bless.total <= 29);

  const bane = roll('1d20+5-1d4');
  assert.equal(bane.rolls.length, 2);
  assert.equal(bane.mod, 5);
  assert.ok(bane.total >= 2 && bane.total <= 24);
});

test('roll - 负号单骰与 kh 边界校验及 d20 检定不翻倍增益骰', () => {
  const neg = roll('-1d4+5');
  assert.ok(neg.total >= 1 && neg.total <= 4, '-1d4+5 结果应在 1 到 4 之间');

  assert.throws(() => roll('999d6kh3'), /out of range/);
  assert.throws(() => roll('4d6kh5'), /out of range/);

  const checkWithBless = roll('1d20+5+1d4', { crit: true });
  assert.equal(checkWithBless.rolls.length, 2, '含 d20 的检定公式在传入 --crit 时不应将祝福术 1d4 翻倍');
});
