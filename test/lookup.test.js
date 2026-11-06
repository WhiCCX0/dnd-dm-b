import test from 'node:test';
import assert from 'node:assert/strict';
import { lookup, VERNACULAR_MAP, CLASS_FEATURES_MAP, queryFallback } from '../scripts/lookup.js';

test('lookup - 2024/2025 核心怪兽点查 (地精武者)', () => {
  const result = lookup('monster', '地精武者', { brief: true, json: true });
  assert.ok(result, '应返回查询结果对象');
  assert.equal(result.found, true, '应成功找到条目');
  assert.match(result.entry.title, /地精武者/);
  assert.equal(result.entry.edition, '2024');
  assert.ok(result.entry.brief, '应包含紧凑数据卡');
  assert.ok(result.entry.brief.includes('AC 15'), '应包含 AC 15 数据');
});

test('lookup - 2024 核心法术点查 (火球术 & 2024 睡眠术)', () => {
  const fireball = lookup('spell', '火球术', { brief: true, json: true });
  assert.equal(fireball.found, true);
  assert.match(fireball.entry.title, /火球术/);
  assert.equal(fireball.entry.category, 'spell');

  const sleep = lookup('spell', '睡眠术', { json: true });
  assert.equal(sleep.found, true);
  assert.equal(sleep.entry.edition, '2024');
  assert.match(sleep.entry.content, /感知豁免/);
});

test('lookup - VERNACULAR_MAP 全量黑话/口语词典 100% 命中测试 (M4)', () => {
  for (const [slang, target] of Object.entries(VERNACULAR_MAP)) {
    const res = lookup(target.cmd || 'search', slang, { brief: true, json: true });
    assert.equal(
      res.found,
      true,
      `黑话映射 "${slang}" -> [${target.cmd}] "${target.query}" 必须命中有效词条`
    );
    assert.ok(
      (res.entry.content && res.entry.content.length > 0) ||
      (res.entry.brief && res.entry.brief.length > 0),
      `黑话映射 "${slang}" 命中的词条内容不应为空`
    );
  }
});

test('lookup - CLASS_FEATURES_MAP 全量核心职业特性 100% 命中测试', () => {
  for (const key of Object.keys(CLASS_FEATURES_MAP)) {
    const res = lookup('rule', key, { brief: true, json: true });
    assert.equal(res.found, true, `核心职业特性 "${key}" 必须命中`);
    assert.equal(res.entry.edition, '2024');
  }
});

test('lookup - FTS5 全文索引覆盖正文 content_md 检索 (M1)', () => {
  // "溜门撬锁" 仅出现在盗贼工具正文 content_md 表格中，不在标题或摘要 brief_md 中
  const res = lookup('search', '溜门撬锁', { json: true });
  assert.equal(res.found, true, 'FTS5 应能检索到仅出现在正文 content_md 中的词句');
  assert.match(res.entry.title, /盗贼工具/);
});

test('lookup - LIKE 通配符转义与纯符号拒绝误匹配 (M2)', () => {
  const pctRule = lookup('rule', '%', { json: true });
  assert.equal(pctRule.found, false, '单独的 % 不应匹配所有规则');

  const underRule = lookup('rule', '_', { json: true });
  assert.equal(underRule.found, false, '单独的 _ 不应被当作单字符通配符或有效词');

  const wildPotion = lookup('item', '%药水', { json: true });
  assert.equal(wildPotion.found, false, '带前缀 % 的查询应将 % 转义为字面量而非通配符');
});

test('lookup - 词条分类精准性修复验证 (M3, L15)', () => {
  // 游侠子职“怪物杀手”应归类为 class 而非 monster
  const slayer = lookup('class', '怪物杀手', { json: true });
  assert.equal(slayer.found, true);
  assert.equal(slayer.entry.category, 'class', '游侠子职怪物杀手应归类为 class');

  // 提夫林-九狱亚种应归类为 origin 而非 module
  const tiefling = lookup('origin', '提夫林-九狱亚种', { json: true });
  assert.equal(tiefling.found, true);
  assert.equal(tiefling.entry.category, 'origin', '提夫林-九狱亚种应归类为 origin');

  // 黑蜘蛛版本应标记为 5e 而非 2024
  const blackSpider = lookup('monster', '黑蜘蛛', { json: true });
  assert.equal(blackSpider.found, true);
  assert.equal(blackSpider.entry.edition, '5e', '5e 模组 BOSS 黑蜘蛛应标记为 5e 版本');
  assert.ok(blackSpider.entry.content.length > 0, '黑蜘蛛词条应包含完整数据卡正文');

  // 18 项技能与盗贼工具
  const perception = lookup('rule', '察觉', { json: true });
  assert.equal(perception.found, true);
  assert.equal(perception.entry.category, 'rule');

  const thievesTools = lookup('item', '盗贼工具', { json: true });
  assert.equal(thievesTools.found, true);
  assert.equal(thievesTools.entry.category, 'item');
});

test('lookup - 空查询与未知命令防御及降级引擎一致性 (L12, L13, L14)', () => {
  const emptyRes = lookup('search', '   ', { json: true });
  assert.equal(emptyRes.found, false);
  assert.ok(emptyRes.error, '空查询应返回 error 提示');

  const badCmd = lookup('invalid-cmd', '火球术', { json: true });
  assert.equal(badCmd.found, false);
  assert.match(badCmd.error, /未知检索命令/);

  // 测试 queryFallback 对黑话与职业特性的支持
  const fbClass = queryFallback('rule', '偷袭', true, { json: true });
  assert.equal(fbClass.found, true);
  assert.match(fbClass.entry.title, /偷袭/);

  const fbSlang = queryFallback('rule', '潜行', true, { json: true });
  assert.equal(fbSlang.found, true);
  assert.match(fbSlang.entry.title, /躲藏/);

  const fbUnder = queryFallback('rule', '_', true, { json: true });
  assert.equal(fbUnder.found, false);
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

test('lookup - 优先返回包含非空正文的条目 (避免命中空白目录树节点)', () => {
  const res = lookup('search', '坠入阿弗纳斯', { brief: true, json: true });
  assert.equal(res.found, true);
  assert.ok(res.entry.content.length > 0 || res.entry.brief.length > 0, '返回的条目应包含实质内容而非空白目录节点');
});
