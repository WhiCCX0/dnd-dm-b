import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roll, parseArgs } from '../scripts/roll-dice.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROLL_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'roll-dice.js');

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

test('roll - 非法 --dc / --ac / --batch 与未知参数校验报错 (Stage 3.1)', () => {
  assert.throws(() => roll('1d20+5', { dc: 'abc' }), /Invalid DC value/);
  assert.throws(() => roll('1d20+5', { ac: 'abc' }), /Invalid AC value/);
  assert.throws(() => roll('1d20+5', { batch: 'abc' }), /Invalid batch count/);
  assert.throws(() => parseArgs(['1d20', '--dc', 'abc']), /Invalid DC value/);
  assert.throws(() => parseArgs(['1d20', '--batch', '0']), /Batch count out of range/);
  assert.throws(() => parseArgs(['1d20+5', '--Adv']), /Unknown option/);
  assert.throws(() => parseArgs(['1d20+5', '--unknown-flag']), /Unknown option/);
  assert.throws(() => parseArgs(['1d20+5', 'unexpected_token']), /Unknown option or unexpected argument/);
});

test('roll - 支持 --flag=value 语法与空格拆分的算式拼接 (Stage 3.1)', () => {
  const eqParsed = parseArgs(['1d20', '+5', '--dc=15', '--batch=3', '--label=Stealth']);
  assert.equal(eqParsed.expr, '1d20+5');
  assert.equal(eqParsed.dc, 15);
  assert.equal(eqParsed.batch, 3);
  assert.equal(eqParsed.label, 'Stealth');

  const spacedParsed = parseArgs(['2d6', '+', '1d8', '-', '2', '--ac=16']);
  assert.equal(spacedParsed.expr, '2d6+1d8-2');
  assert.equal(spacedParsed.ac, 16);
  assert.equal(spacedParsed.attack, true);
});

test('roll - 编程接口 batch 批量投骰返回完整 results 数组 (Stage 3.1)', () => {
  const batchRes = roll('2d6+3', { batch: 5 });
  assert.equal(batchRes.batch, 5);
  assert.equal(batchRes.results.length, 5);
  assert.equal(batchRes.totals.length, 5);
  for (const r of batchRes.results) {
    assert.ok(r.total >= 5 && r.total <= 15);
  }
});

test('roll - 攻击检定模式 (--attack / --ac)：自然 20 无视 AC 必中，自然 1 无视加值必失手 (Stage 3.1)', () => {
  let sawNat20AutoHit = false;
  let sawNat1AutoMiss = false;

  for (let attempt = 0; attempt < 10 && (!sawNat20AutoHit || !sawNat1AutoMiss); attempt++) {
    // 1d20-50 against AC 99: only Nat 20 can hit!
    const impossibleAcBatch = roll('1d20-50', { attack: true, ac: 99, batch: 100 });
    for (const r of impossibleAcBatch.results) {
      if (r.d20Special === 'NATURAL 20!') {
        assert.equal(r.hit, true, '攻击检定自然 20 即使总值低于 AC 也必须自动命中');
        assert.equal(r.autoHit, true);
        sawNat20AutoHit = true;
      } else {
        assert.equal(r.hit, false);
      }
    }

    // 1d20+50 against AC 5: only Nat 1 can miss!
    const trivialAcBatch = roll('1d20+50', { attack: true, ac: 5, batch: 100 });
    for (const r of trivialAcBatch.results) {
      if (r.d20Special === 'NATURAL 1!') {
        assert.equal(r.hit, false, '攻击检定自然 1 即使总值远超 AC 也必须自动失手');
        assert.equal(r.autoMiss, true);
        sawNat1AutoMiss = true;
      } else {
        assert.equal(r.hit, true);
      }
    }
  }

  assert.ok(sawNat20AutoHit, '批量采样中应验证到自然 20 自动命中');
  assert.ok(sawNat1AutoMiss, '批量采样中应验证到自然 1 自动失手');
});

test('roll - CLI 暗骰 (--hidden) 仅输出纯数字不泄露 DC/标签且非 TTY 无 ANSI 转义码', () => {
  const hiddenOut = execFileSync(process.execPath, [ROLL_SCRIPT, '1d20+6', '--dc', '15', '--label', 'Goblin Stealth', '--hidden'], {
    encoding: 'utf-8'
  });
  assert.match(hiddenOut, /^\d+\r?\n$/, '--hidden 应仅输出纯数字结果');
  assert.ok(!hiddenOut.includes('DC') && !hiddenOut.includes('Goblin'), '--hidden 严禁泄露 DC 或标签');

  const normalOut = execFileSync(process.execPath, [ROLL_SCRIPT, '1d20+4', '--dc=12', '--label=Check'], {
    encoding: 'utf-8'
  });
  assert.ok(!normalOut.includes('\x1b['), '非 TTY 子进程输出不应包含 ANSI 颜色转义序列');
});

test('roll - 极端数量骰子与超大修正值边界拦截防止精度丢失或卡死 (L4)', () => {
  const tenHundred = Array(10).fill('20d6').join('+');
  assert.throws(() => roll(tenHundred), /Total dice count .* out of range/);
  assert.throws(() => roll('1d20+99999999999999999999'), /Modifier value out of range/);
  assert.throws(() => roll('4d6kh3+50000'), /out of range/);
});

test('roll - 暴击骰数翻倍 (--crit) 与目标 DC 难度判定', () => {
  const res = roll('2d6+3', { crit: true });
  assert.equal(res.rolls.length, 4, '2d6 暴击应投 4 个骰子');

  assert.equal(roll('1d20+100', { dc: 15 }).success, true);
  assert.equal(roll('1d20-100', { dc: 15 }).success, false);
});

test('roll - 错误表达式输入防御与复合骰子表达式', () => {
  assert.throws(() => roll('invalid-dice'), /Invalid dice expression/);
  assert.throws(() => roll('abc'), /Invalid dice expression/);

  const critRes = roll('1d8+3+2d8', { crit: true });
  assert.equal(critRes.rolls.length, 6);
  assert.equal(critRes.mod, 3);

  const checkWithBless = roll('1d20+5+1d4', { crit: true });
  assert.equal(checkWithBless.rolls.length, 2, '含 d20 的检定公式在传入 --crit 时不应将祝福术 1d4 翻倍');
});
