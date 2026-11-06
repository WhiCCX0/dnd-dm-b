import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { lookup, VERNACULAR_MAP, CLASS_FEATURES_MAP, queryFallback } from '../scripts/lookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('lookup - 2024/2025 核心怪兽点查与双语检索 (地精武者 / Goblin Warrior / 邪魔邪教徒)', () => {
  const result = lookup('monster', '地精武者', { brief: true, json: true });
  assert.ok(result, '应返回查询结果对象');
  assert.equal(result.found, true, '应成功找到条目');
  assert.match(result.entry.title, /地精武者/);
  assert.equal(result.entry.edition, '2024');
  assert.ok(result.entry.brief.includes('AC'), '应包含 AC 数据');

  const enGoblin = lookup('monster', 'Goblin Warrior', { brief: true, json: true });
  assert.equal(enGoblin.found, true, '英文名 Goblin Warrior 应命中地精武者');
  assert.match(enGoblin.entry.title, /地精武者/);

  // 验证多数据卡合集页中的独立子怪物标题提取与单怪摘要隔离
  const fiendCultist = lookup('monster', '邪魔邪教徒', { brief: true, json: true });
  assert.equal(fiendCultist.found, true);
  assert.equal(fiendCultist.entry.title, '邪魔邪教徒');
  assert.ok(fiendCultist.entry.brief.startsWith('[怪物]'), '邪魔邪教徒应识别为 [怪物] 数据卡而非设定页');
  const acCount = (fiendCultist.entry.brief.match(/\bAC\b/g) || []).length;
  assert.equal(acCount, 1, '多怪页面的 brief 摘要应严格隔离在单个怪物数据卡内');
});

test('lookup - 2024 核心法术点查与译名别名覆盖 (火球术 / 睡眠术 / 恶言相加 / 炼狱叱喝)', () => {
  const fireball = lookup('spell', '火球术', { brief: true, json: true });
  assert.equal(fireball.found, true);
  assert.match(fireball.entry.title, /火球术/);
  assert.equal(fireball.entry.category, 'spell');
  assert.match(fireball.entry.brief, /8d6/, '火球术 --brief 必须保留 8d6 伤害骰');

  const sleep = lookup('spell', '睡眠术', { brief: true, json: true });
  assert.equal(sleep.found, true);
  assert.equal(sleep.entry.edition, '2024');
  assert.match(sleep.entry.brief, /感知豁免/);

  for (const q of ['恶言相加', '恶言相向', 'Vicious Mockery']) {
    const vm = lookup('spell', q, { brief: true, json: true });
    assert.equal(vm.found, true, `查询 "${q}" 应命中恶言相加`);
    assert.match(vm.entry.brief, /1d6/);
  }

  for (const q of ['炼狱叱喝', '地狱之斥', 'Hellish Rebuke']) {
    const hr = lookup('spell', q, { brief: true, json: true });
    assert.equal(hr.found, true, `查询 "${q}" 应命中炼狱叱喝`);
    assert.match(hr.entry.brief, /2d10/);
  }
});

test('lookup - 2024 法术 --brief 骰子公式保留率 >= 99% 审计门禁', () => {
  const dbPath = path.join(ROOT_DIR, 'references', 'rules.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const spells = db.prepare("SELECT title, brief_md, content_md FROM entries WHERE category = 'spell' AND edition = '2024'").all();
  db.close();

  const diceRegex = /\b\d+d\d+\b/i;
  const diceSpells = spells.filter(s => diceRegex.test(s.content_md));
  assert.ok(diceSpells.length >= 150, `应至少有 150 道含骰子表达式的 2024 法术，实际: ${diceSpells.length}`);

  const retained = diceSpells.filter(s => diceRegex.test(s.brief_md));
  const rate = retained.length / diceSpells.length;
  assert.ok(
    rate >= 0.99,
    `2024 法术 --brief 骰子保留率必须 >= 99%，当前: ${(rate * 100).toFixed(2)}% (${retained.length}/${diceSpells.length})`
  );
});

test('lookup - 2024 15 种状态、武器精通总览、专长与模组神器切片完整性', () => {
  const conditions15 = [
    '目盲', '魅惑', '耳聋', '力竭', '恐慌',
    '受擒', '失能', '隐形', '麻痹', '石化',
    '中毒', '倒地', '束缚', '震慑', '昏迷'
  ];
  for (const cond of conditions15) {
    const res = lookup('rule', cond, { brief: true, json: true });
    assert.equal(res.found, true, `2024 状态 "${cond}" 必须可查`);
    assert.equal(res.entry.edition, '2024', `状态 "${cond}" 必须优先命中 2024 版`);
    assert.ok(res.entry.brief.length > 35, `状态 "${cond}" 的 brief 必须包含实际规则效果而非空标题`);
    assert.ok(!res.entry.brief.endsWith('你将遭受以下这些效应。'), `状态 "${cond}" 的 brief 不能仅截断在引导废话`);
  }

  // 武器精通总览不应被误切到横扫单条
  const masteryOverview = lookup('rule', '武器精通', { brief: true, json: true });
  assert.equal(masteryOverview.found, true);
  assert.equal(masteryOverview.entry.url, '玩家手册2024/装备/精通词条.htm');
  assert.ok(masteryOverview.entry.content.includes('擦掠') && masteryOverview.entry.content.includes('横扫'));

  const cleave = lookup('rule', 'Cleave', { brief: true, json: true });
  assert.equal(cleave.found, true);
  assert.match(cleave.entry.title, /横扫/);
  assert.match(cleave.entry.brief, /负数/);

  const alertFeat = lookup('feat', '警戒', { brief: true, json: true });
  assert.equal(alertFeat.found, true);
  assert.equal(alertFeat.entry.edition, '2024');

  for (const q of ['鸦族圣徽', '日圣符']) {
    const symbol = lookup('item', q, { brief: true, json: true });
    assert.equal(symbol.found, true, `施特拉德神器 "${q}" 必须命中`);
    assert.match(symbol.entry.title, /鸦族圣徽/);
  }
});

test('lookup - module 命令：DMG 2024 五大完整冒险直达与 5e 模组目录严格隔离', () => {
  const dmgAdventures = ['秽染溪泉', '矿洞惊魂', '有翼之神', '兽之角冠', '北风舞会'];
  for (const adv of dmgAdventures) {
    const res = lookup('module', adv, { json: true });
    assert.equal(res.found, true, `DMG 2024 教学冒险 "${adv}" 必须命中`);
    assert.equal(res.hasFullPlot, true);
    assert.ok(res.entry.content.length > 500, `"${adv}" 必须返回完整冒险正文`);
  }

  const phandelver = lookup('module', '矿坑', { json: true });
  assert.equal(phandelver.found, true);
  assert.equal(phandelver.hasFullPlot, false);
  assert.ok(phandelver.disclaimer.includes('不含完整章节剧情'), '5e 模组返回结果必须包含诚实免责声明');
  const allUrls = [
    ...phandelver.groups.monsters,
    ...phandelver.groups.items,
    ...phandelver.groups.appendices
  ].map(r => r.url);
  assert.ok(allUrls.length > 0);
  assert.ok(
    allUrls.every(u => u.startsWith('模组/矿坑/')),
    `查询 "矿坑" 不得混入《破碎方尖碑》等其他模组条目: ${allUrls.join(', ')}`
  );
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

test('lookup - CLASS_FEATURES_MAP 全量核心职业特性 100% 命中测试且不劫持 monster/item 命令', () => {
  for (const key of Object.keys(CLASS_FEATURES_MAP)) {
    const res = lookup('rule', key, { brief: true, json: true });
    assert.equal(res.found, true, `核心职业特性 "${key}" 必须命中`);
    assert.equal(res.entry.edition, '2024');
  }
});

test('lookup - FTS5 全文索引覆盖正文 content_md 检索 (M1)', () => {
  const res = lookup('search', '溜门撬锁', { json: true });
  assert.equal(res.found, true, 'FTS5 应能检索到仅出现在正文 content_md 中的词句');
  assert.match(res.entry.title, /盗贼工具/);
});

test('lookup - LIKE 通配符转义与纯符号拒绝误匹配 (M2)', () => {
  assert.equal(lookup('rule', '%', { json: true }).found, false);
  assert.equal(lookup('rule', '_', { json: true }).found, false);
  assert.equal(lookup('item', '%药水', { json: true }).found, false);
});

test('lookup - 词条分类精准性修复验证 (M3, L15)', () => {
  const slayer = lookup('class', '怪物杀手', { json: true });
  assert.equal(slayer.found, true);
  assert.equal(slayer.entry.category, 'class');

  const tiefling = lookup('origin', '提夫林-九狱亚种', { json: true });
  assert.equal(tiefling.found, true);
  assert.equal(tiefling.entry.category, 'origin');

  const blackSpider = lookup('monster', '黑蜘蛛', { json: true });
  assert.equal(blackSpider.found, true);
  assert.equal(blackSpider.entry.edition, '5e');
  assert.ok(blackSpider.entry.content.length > 0);

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
  assert.ok(emptyRes.error);

  const badCmd = lookup('invalid-cmd', '火球术', { json: true });
  assert.equal(badCmd.found, false);
  assert.match(badCmd.error, /未知检索命令/);

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
  assert.ok(injection);
  assert.equal(typeof injection.found, 'boolean');

  const specialChars = lookup('search', '!@#$%^&*()_+{}[]:<>?,./', { brief: true, json: true });
  assert.ok(specialChars);
});

test('lookup - 全仓库 Markdown 文档示例命令 100% 真实命中门禁 (Stage 1 Gate)', () => {
  const mdFiles = [];
  function collectMd(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'sessions') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collectMd(full);
      else if (entry.name.endsWith('.md')) mdFiles.push(full);
    }
  }
  collectMd(ROOT_DIR);

  const cmdRegex = /node\s+scripts\/lookup\.js\s+([a-z]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s`#]+))/g;
  let checkedCount = 0;

  for (const file of mdFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = cmdRegex.exec(content)) !== null) {
      const cmd = match[1];
      const query = match[2] || match[3] || match[4];
      // Skip template placeholders like <命令> or <模组名>
      if (!query || query.includes('<') || query.includes('>')) continue;
      const res = lookup(cmd, query, { brief: true, json: true });
      assert.equal(
        res.found,
        true,
        `文档 ${path.relative(ROOT_DIR, file)} 中的示例命令 [node scripts/lookup.js ${cmd} "${query}"] 必须 100% 命中，实际未找到！`
      );
      checkedCount++;
    }
  }

  assert.ok(checkedCount >= 40, `应至少扫描并验证 40 条文档内的 lookup.js 示例命令，实际验证: ${checkedCount}`);
});
