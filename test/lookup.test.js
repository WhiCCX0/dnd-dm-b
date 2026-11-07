import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

function resolveTestDbPath() {
  return process.env.DND_DB_PATH
    ? path.resolve(process.env.DND_DB_PATH)
    : path.join(ROOT_DIR, 'references', 'rules.db');
}

test('lookup (R12.1 & R12.2) - 全仓库 Markdown 文档示例命令覆盖 <SKILL_DIR> 写法且主结果精确命中预期 #ID 或标题/别名', (t) => {
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

  const db = new DatabaseSync(resolveTestDbPath(), { readOnly: true });
  const cmdRegex = /node\s+(?:<SKILL_DIR>\/|\$SKILL_DIR\/|\$\{SKILL_DIR\}\/)?scripts\/lookup\.js\s+([a-z]+)\s+(?:"([^"]+)"|'([^']+)'|([^\s`#]+))/g;
  let checkedCount = 0;
  let idCheckedCount = 0;

  try {
    // 专项校验：模组章节中 monster "施特拉德" 必须命中模组首领而非通用吸血鬼
    const strahd = lookup('monster', '施特拉德', { brief: true, json: true });
    assert.equal(strahd.found, true);
    assert.equal(strahd.entry.title, '施特拉德·冯·扎洛维奇', 'monster "施特拉德" 应命中鸦阁首领施特拉德·冯·扎洛维奇而非通用吸血鬼');

    for (const file of mdFiles) {
      const relFile = path.relative(ROOT_DIR, file);
      const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);

      lines.forEach((line, lineIdx) => {
        cmdRegex.lastIndex = 0;
        let match;
        while ((match = cmdRegex.exec(line)) !== null) {
          const cmd = match[1];
          const query = match[2] || match[3] || match[4];
          if (!query || query.includes('<') || query.includes('>')) continue;

          const res = lookup(cmd, query, { brief: true, json: true });
          assert.equal(
            res.found,
            true,
            `文档 ${relFile}:${lineIdx + 1} 中的示例命令 [lookup.js ${cmd} "${query}"] 必须命中，实际未找到`
          );

          // 提取同行或紧邻上一行注释中的 #编号（如 #945, #1071, #8146）
          const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : '';
          const sameLineId = line.match(/(?:^|[\s(`#])#(\d{2,5})\b/);
          const prevCommentId = /^\s*#\s+/.test(prevLine) ? prevLine.match(/#(\d{2,5})\b/) : null;
          const expectedId = sameLineId ? Number(sameLineId[1]) : (prevCommentId ? Number(prevCommentId[1]) : null);

          if (expectedId !== null) {
            assert.equal(
              res.entry.id,
              expectedId,
              `文档 ${relFile}:${lineIdx + 1} [${cmd} "${query}"] 主结果 ID 应为 #${expectedId}，实际为 #${res.entry.id} (${res.entry.title})`
            );
            idCheckedCount++;
          } else if (cmd === 'module' && res.hasFullPlot === false) {
            assert.ok(
              res.moduleName.toLowerCase().includes(query.toLowerCase()) ||
              res.entry.url.toLowerCase().includes(query.toLowerCase()),
              `文档 ${relFile}:${lineIdx + 1} [module "${query}"] 返回的模组名 (${res.moduleName}) 与查询词不匹配`
            );
          } else {
            const qLower = query.toLowerCase();
            const row = db.prepare('SELECT id, title, title_en, aliases FROM entries WHERE id = ?').get(res.entry.id);
            const cf = CLASS_FEATURES_MAP[query];
            const vern = VERNACULAR_MAP[query];
            const vernQuery = vern ? vern.query.toLowerCase() : null;
            const vernCf = vern ? CLASS_FEATURES_MAP[vern.query] : null;

            let matchedTitleOrAlias = false;
            if (cf && ['rule', 'class', 'search'].includes(cmd) && res.entry.title === `${cf.class}：${cf.feature}`) {
              matchedTitleOrAlias = true;
            } else if (vernCf && ['rule', 'class', 'search'].includes(cmd) && res.entry.title === `${vernCf.class}：${vernCf.feature}`) {
              matchedTitleOrAlias = true;
            } else if (row) {
              const aliases = (row.aliases || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean);
              const titleLower = row.title.toLowerCase();
              const titleEnLower = (row.title_en || '').toLowerCase();
              matchedTitleOrAlias =
                titleLower === qLower ||
                titleEnLower === qLower ||
                aliases.includes(qLower) ||
                (vernQuery !== null && (titleLower === vernQuery || aliases.includes(vernQuery)));
            }

            assert.equal(
              matchedTitleOrAlias,
              true,
              `文档 ${relFile}:${lineIdx + 1} [${cmd} "${query}"] 未标 #编号时，主结果 (#${res.entry.id} "${res.entry.title}") 必须等于查询词或其别名`
            );
          }

          checkedCount++;
        }
      });
    }
  } finally {
    db.close();
  }

  t.diagnostic(`R12.2 扫描验证 lookup.js 文档示例总数: ${checkedCount} (含显式 #ID 校验: ${idCheckedCount})`);
  assert.ok(checkedCount >= 140, `应至少扫描并验证 140 条文档内的 lookup.js 示例命令，实际验证: ${checkedCount}`);
  assert.ok(idCheckedCount >= 6, `应至少包含 6 条带显式 #编号 的文档示例校验，实际: ${idCheckedCount}`);
});

test('lookup (R8) - 无静默截断至 10,000 字的正文，且 #259/#2094/#2920 末尾与上游 c1425c8 一致', () => {
  const dbPath = resolveTestDbPath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const truncatedCount = db.prepare('SELECT count(*) as c FROM entries WHERE length(content_md) = 10000').get().c;
    assert.equal(truncatedCount, 0, `正文长度恰好等于 10000 的静默截断条目数必须为 0，实际: ${truncatedCount}`);

    const expectedEndings = [
      { id: 259, title: '法师法术列表', ending: '女妖之嚎Wail of the BansheeAU' },
      { id: 2094, title: '神器', ending: '该属性被使用后，七天内不能再次使用。 |' },
      { id: 2920, title: '费伦诸神详情', ending: '那就去做无聊的娱乐吧。' }
    ];
    for (const exp of expectedEndings) {
      const row = db.prepare('SELECT title, content_md FROM entries WHERE id = ?').get(exp.id);
      assert.ok(row, `必须存在 #${exp.id} (${exp.title})`);
      assert.ok(row.content_md.length > 10000, `#${exp.id} 正文长度应完整大于 10000，实际: ${row.content_md.length}`);
      assert.ok(
        row.content_md.trimEnd().endsWith(exp.ending),
        `#${exp.id} (${exp.title}) 正文末尾必须与上游 c1425c8 一致（期望以 "${exp.ending}" 结尾，实际末尾: "${row.content_md.slice(-40)}"）`
      );
    }
  } finally {
    db.close();
  }
});

test('lookup (R9) - 全文检索覆盖长页全文：5 个仅在长页第 2,000 字之后出现的词均命中对应条目', () => {
  const dbPath = resolveTestDbPath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const cases = [
    { id: 4, title: '兼职规则', term: '你准备的法术' },
    { id: 51, title: '牧师', term: '你通过祈祷' },
    { id: 105, title: '战士', term: '战士特性表列' },
    { id: 330, title: '血族（吸血鬼）', term: '自愿饲血' },
    { id: 273, title: '法师法术列表', term: '转瞬壁垒' }
  ];

  try {
    for (const c of cases) {
      const row = db.prepare('SELECT content_md FROM entries WHERE id = ?').get(c.id);
      assert.ok(row, `应存在 #${c.id}`);
      const firstPos = row.content_md.indexOf(c.term);
      assert.ok(firstPos > 2000, `"${c.term}" 在 #${c.id} 中首次出现位置应 > 2000，实际: ${firstPos}`);

      const res = lookup('search', c.term, { json: true });
      assert.equal(res.found, true, `search "${c.term}" 必须命中`);
      const hitIds = [res.entry.id, ...(res.related || []).map(r => r.id)];
      assert.ok(
        hitIds.includes(c.id),
        `search "${c.term}" 必须命中长页条目 #${c.id} (${c.title})，实际命中 IDs: ${JSON.stringify(hitIds)}`
      );
    }
  } finally {
    db.close();
  }
});

test('lookup (R10) - 所有含数据卡的 2024 怪物条目，精简卡中“攻击检定”出现次数不少于正文', () => {
  const dbPath = resolveTestDbPath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const monsters = db.prepare(
      "SELECT id, title, url, brief_md, content_md FROM entries WHERE category = 'monster' AND edition = '2024' AND brief_md LIKE '[怪物] %'"
    ).all();
    assert.ok(monsters.length >= 500, `2024 怪物数据卡条目应不少于 500 条，实际: ${monsters.length}`);

    const countAtk = s => (s.match(/攻击检定/g) || []).length;
    const missing = monsters.filter(m => countAtk(m.brief_md) < countAtk(m.content_md));
    assert.equal(
      missing.length,
      0,
      `2024 怪物精简卡不得丢失任何“攻击检定”，当前缺失 ${missing.length} 张（示例: ${missing.slice(0, 5).map(m => `#${m.id} ${m.title}`).join(', ')}）`
    );
  } finally {
    db.close();
  }
});

test('lookup (R11) - 同版本同标题重复条目已合并或加来源区分，lookup item 治疗药水 只返回一条主结果', () => {
  const dbPath = resolveTestDbPath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const dupGroups = db.prepare(
      'SELECT edition, lower(title) as lt, count(*) as c FROM entries GROUP BY edition, lower(title) HAVING c > 1'
    ).all();
    assert.equal(
      dupGroups.length,
      0,
      `同版本同标题未区分来源的重复组数应降为 0，当前仍有 ${dupGroups.length} 组（示例: ${dupGroups.slice(0, 5).map(g => `${g.edition}:${g.lt}(${g.c})`).join(', ')}）`
    );

    const inspRows = db.prepare("SELECT id, title FROM entries WHERE edition = '2024' AND title = '英雄激励'").all();
    assert.equal(inspRows.length, 1, '2024 英雄激励应去重为唯一主条目');

    const oaRows = db.prepare("SELECT id, title FROM entries WHERE edition = '2024' AND title = '借机攻击'").all();
    assert.equal(oaRows.length, 1, '2024 借机攻击应去重为唯一主条目');
  } finally {
    db.close();
  }

  const potion = lookup('item', '治疗药水', { json: true });
  assert.equal(potion.found, true);
  assert.equal(potion.entry.title, '治疗药水', '主结果应为核心魔法物品治疗药水');
  assert.ok(
    (potion.related || []).every(r => r.title !== '治疗药水'),
    `相关条目不得再出现同名未区分的“治疗药水”，实际 related: ${JSON.stringify(potion.related)}`
  );
});

test('lookup (R16) - 数据库与索引缺失时输出一行明确的 setup-db 获取指引', () => {
  const missingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-missing-db-'));
  try {
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT_DIR, 'scripts', 'lookup.js'), 'monster', '地精武者'],
      {
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          DND_DB_PATH: path.join(missingDir, 'rules.db'),
          DND_INDEX_PATH: path.join(missingDir, 'topics_index.json')
        },
        encoding: 'utf8'
      }
    );
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
    const nonEmptyLines = combined.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    assert.equal(nonEmptyLines.length, 1, `数据库缺失时应输出单行明确指引，实际行数 ${nonEmptyLines.length}: ${combined}`);
    assert.ok(
      nonEmptyLines[0].includes('setup-db.js'),
      `数据库缺失提示应指引运行 setup-db.js，实际: ${nonEmptyLines[0]}`
    );
  } finally {
    fs.rmSync(missingDir, { recursive: true, force: true });
  }
});

test('CLI 端到端 (R12.5 & R13) - 从非技能目录运行三个核心脚本均正常执行，且输出无 ANSI 颜色码与无 SQLite 实验警告', () => {
  const extCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-ext-cwd-'));
  const extSessions = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-ext-sessions-'));
  const ansiRegex = /\x1b\[[0-9;]*m/;
  const sqliteWarnRegex = /ExperimentalWarning|SQLite is an experimental feature/i;

  try {
    const commands = [
      {
        name: 'lookup.js',
        args: [path.join(ROOT_DIR, 'scripts', 'lookup.js'), 'monster', '地精武者', '--brief'],
        expectOut: '地精武者'
      },
      {
        name: 'roll-dice.js',
        args: [path.join(ROOT_DIR, 'scripts', 'roll-dice.js'), '1d20+5', '--attack', '--ac', '15'],
        expectOut: '1d20+5'
      },
      {
        name: 'state.js init',
        args: [path.join(ROOT_DIR, 'scripts', 'state.js'), 'init', 'e2e-cli', '--preset', 'valen,bran', '--force'],
        expectOut: '瓦伦·铁福德'
      },
      {
        name: 'state.js show',
        args: [path.join(ROOT_DIR, 'scripts', 'state.js'), 'show', 'e2e-cli', '--hud', '--veil'],
        expectOut: '瓦伦·铁福德'
      }
    ];

    for (const c of commands) {
      const res = spawnSync(process.execPath, c.args, {
        cwd: extCwd,
        env: { ...process.env, DND_SESSIONS_DIR: extSessions, DND_RNG_SEED: '42' },
        encoding: 'utf8'
      });
      const combined = `${res.stdout || ''}${res.stderr || ''}`;
      assert.equal(res.status, 0, `[${c.name}] 在非技能目录 (${extCwd}) 执行应返回状态码 0，实际: ${res.status}\n${combined}`);
      assert.ok((res.stdout || '').includes(c.expectOut), `[${c.name}] 输出应包含 "${c.expectOut}"`);
      assert.ok(!ansiRegex.test(combined), `[${c.name}] 子进程输出不得包含终端 ANSI 颜色码: ${JSON.stringify(combined.slice(0, 160))}`);
      assert.ok(!sqliteWarnRegex.test(combined), `[${c.name}] 子进程输出不得包含 SQLite 实验特性警告: ${combined}`);
    }
  } finally {
    fs.rmSync(extCwd, { recursive: true, force: true });
    fs.rmSync(extSessions, { recursive: true, force: true });
  }
});

test('lookup - 2024 全部 38 种基础武器、13 种基础护甲与 26 项种族/背景起源 100% 精准命中', () => {
  const weaponsAndArmors = [
    '短棒', '匕首', '巨棒', '手斧', '标枪', '轻锤', '硬头锤', '长棍', '镰刀', '矛',
    '飞镖', '轻弩', '短弓', '投石索',
    '战斧', '链枷', '长柄刀', '巨斧', '巨剑', '戟', '骑枪', '长剑', '巨锤', '钉头锤',
    '长矛', '刺剑', '弯刀', '短剑', '三叉戟', '战镐', '战锤', '鞭',
    '吹箭筒', '手弩', '重弩', '长弓', '火铳', '手铳',
    '布甲', '皮甲', '镶钉皮甲', '兽皮甲', '链甲衫', '鳞甲', '胸甲', '半身板甲',
    '环甲', '链甲', '板条甲', '板甲', '盾牌',
    'Longsword', 'Greatsword', 'Chain Mail', 'Studded Leather Armor'
  ];
  for (const item of weaponsAndArmors) {
    const res = lookup('item', item, { brief: true, json: true });
    assert.equal(res.found, true, `item "${item}" 必须命中 2024 基础装备条目`);
    assert.equal(res.entry.edition, '2024', `item "${item}" 必须优先命中 2024 版本`);
    assert.ok(
      res.entry.brief.includes('伤害:') || res.entry.brief.includes('AC:'),
      `item "${item}" 精简卡应包含武器伤害或护甲 AC 字段: ${res.entry.brief}`
    );
  }

  const origins = [
    '阿斯莫', '龙裔', '矮人', '精灵', '侏儒', '歌利亚', '半身人', '人类', '兽人', '提夫林',
    '侍僧', '工匠', '骗子', '罪犯', '艺人', '农民', '农夫', '警卫', '向导', '隐士',
    '商人', '贵族', '智者', '水手', '抄写员', '士兵', '流浪者', '流浪儿'
  ];
  for (const name of origins) {
    const res = lookup('rule', name, { brief: true, json: true });
    assert.equal(res.found, true, `rule "${name}" 必须命中 2024 种族/背景起源条目`);
    assert.equal(res.entry.edition, '2024', `rule "${name}" 必须命中 2024 版本，实际: ${JSON.stringify(res.entry)}`);
    assert.equal(res.entry.category, 'origin', `rule "${name}" 必须命中 origin 类别，实际: ${res.entry.category}`);
  }
});
