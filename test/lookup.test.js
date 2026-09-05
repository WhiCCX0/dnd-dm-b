import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup } from '../scripts/lookup.js';

test('lookup - 2024/2025 核心怪兽点查 (地精武者)', () => {
  const result = lookup('monster', '地精武者', { brief: true, json: true });
  assert.ok(result, '应返回查询结果对象');
  assert.equal(result.found, true, '应成功找到条目');
  assert.match(result.entry.title, /地精武者/);
  assert.equal(result.entry.edition, '2024');
  assert.ok(result.entry.brief, '应包含紧凑数据卡');
  assert.ok(result.entry.brief.includes('AC 15'), '应包含 AC 15 数据');
});

test('lookup - 2024 核心法术点查 (火球术)', () => {
  const result = lookup('spell', '火球术', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /火球术/);
  assert.equal(result.entry.category, 'spell');
});

test('lookup - 玩家口语/黑话映射: 潜行 -> 躲藏', () => {
  const result = lookup('rule', '潜行', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /躲藏/);
  assert.equal(result.entry.edition, '2024');
});

test('lookup - 玩家口语/黑话映射: 开锁 -> 盗贼工具', () => {
  const result = lookup('rule', '开锁', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /盗贼工具/);
});

test('lookup - 玩家口语/黑话映射: 借机 -> 借机攻击', () => {
  const result = lookup('rule', '借机', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /借机攻击/);
});

test('lookup - 玩家口语/黑话映射: 闪避 -> 回避', () => {
  const result = lookup('rule', '闪避', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /回避/);
});

test('lookup - 玩家口语/黑话映射: 半血 -> 浴血', () => {
  const result = lookup('rule', '半血', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /浴血/);
});

test('lookup - 玩家口语/黑话映射: 濒死 -> 死亡豁免检定', () => {
  const result = lookup('rule', '濒死', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /死亡豁免检定/);
});

test('lookup - 玩家口语/黑话映射: 血瓶 -> 治疗药水', () => {
  const result = lookup('item', '血瓶', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /治疗药水/);
});

test('lookup - 玩家口语/黑话映射: 哥布林 -> 地精', () => {
  const result = lookup('monster', '哥布林', { brief: true, json: true });
  assert.equal(result.found, true);
  assert.match(result.entry.title, /地精/);
});

test('lookup - 安全性与异常输入防护: SQL 注入与特殊字符不崩溃', () => {
  const injection = lookup('search', "' OR 1=1; DROP TABLE entries; --", { brief: true, json: true });
  assert.ok(injection, '面对注入字符应安全返回');
  assert.equal(typeof injection.found, 'boolean');

  const specialChars = lookup('search', '!@#$%^&*()_+{}[]:<>?,./', { brief: true, json: true });
  assert.ok(specialChars, '面对特殊符号应安全处理');
});

test('lookup - 未匹配关键词优雅返回', () => {
  const result = lookup('search', '这是一个绝不可能存在的极其罕见的DND词条xyz789', { json: true });
  assert.equal(result.found, false);
});

test('lookup - 2024 核心职业招牌机制特性直达 (偷袭, 动作如潮, 灵巧动作, 狂暴)', () => {
  const sneak = lookup('rule', '偷袭', { brief: true, json: true });
  assert.equal(sneak.found, true);
  assert.match(sneak.entry.title, /偷袭/);
  assert.match(sneak.entry.brief, /游荡者/);

  const surge = lookup('rule', '动作如潮', { brief: true, json: true });
  assert.equal(surge.found, true);
  assert.match(surge.entry.title, /动作如潮/);
  assert.match(surge.entry.brief, /战士/);

  const cunning = lookup('rule', '灵巧动作', { brief: true, json: true });
  assert.equal(cunning.found, true);
  assert.match(cunning.entry.title, /灵巧动作/);

  const rage = lookup('rule', '狂暴', { brief: true, json: true });
  assert.equal(rage.found, true);
  assert.match(rage.entry.title, /狂暴/);
  assert.match(rage.entry.brief, /野蛮人/);
});

