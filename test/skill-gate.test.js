import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { getCategory, parseWcpContent } from '../scripts/build-index.js';
import { htmlToMarkdown, decodeHtmlEntities } from '../scripts/build-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('gate - references/session-zero-interface.md 官方开局切片完整性', () => {
  const sessionZeroPath = path.join(rootDir, 'references', 'session-zero-interface.md');
  assert.ok(fs.existsSync(sessionZeroPath), 'session-zero-interface.md 文件必须存在');

  const content = fs.readFileSync(sessionZeroPath, 'utf8');
  assert.ok(content.length > 1000, 'session-zero-interface.md 内容必须详实 (>1000 bytes)');

  assert.ok(content.includes('【第一步：选择跑团模式】'), '必须包含第一步模式选择');
  assert.ok(content.includes('【第二步：认领 2024 英雄角色卡】'), '必须包含第二步角色认领');
  assert.ok(content.includes('【第三步：选择冒险战役剧本】'), '必须包含第三步剧本选本');

  const heroes = ['瓦伦', '莱拉', '阿里斯泰尔', '冯达尔', '瑟莱', '卡珊德拉'];
  for (const hero of heroes) {
    assert.ok(content.includes(hero), `开局接口必须包含预制英雄：${hero}`);
  }

  assert.ok(content.includes('① ① ①') && content.includes('随机'), '必须包含极速指令与代抽指引');
  assert.ok(!content.includes('5d8 睡眠控场'), 'session-zero-interface.md 不应残留 2014 版 5d8 睡眠术描述');
  assert.ok(content.includes('【睡眠术】感知豁免沉睡控场'), 'session-zero-interface.md 必须采用 2024 感知豁免睡眠术描述');
});

test('gate - SKILL.md 2.2.0 版本规范、三级收敛架构与分级门禁声明', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  assert.ok(fs.existsSync(skillPath), 'SKILL.md 必须存在');

  const content = fs.readFileSync(skillPath, 'utf8');
  assert.ok(content.includes('version: 2.2.0'), 'SKILL.md 必须升级声明 version: 2.2.0');
  assert.ok(
    content.includes('L0 常驻层') &&
    content.includes('L1 运行工具与切片层') &&
    content.includes('L2 深度规则与模组档案库'),
    'SKILL.md 必须明确声明 L0/L1/L2 三级收敛分层架构'
  );
  assert.ok(content.includes('session-zero-interface.md'), 'SKILL.md 必须在 L1 明确声明 session-zero-interface.md');
  assert.ok(!content.includes('5d8 生命值无豁免沉睡'), 'SKILL.md 不应残留 2014 版 5d8 睡眠术描述');
  assert.ok(!content.includes('句长极差 > 15 字') && !content.includes('句长极差是否 > 15 字'), 'SKILL.md 已移除机械的句长极差>15字教条');
  assert.ok(!content.includes('run_command'), 'SKILL.md 不应硬编码特定 Agent 的私有工具名 run_command');
});

test('gate - 2024 规则一致性校验：睡眠术、长休生命值骰、横扫与推离 (Stage 4 Gate)', () => {
  const wizardPath = path.join(rootDir, 'resources', 'premade-characters', 'wizard-evoker.md');
  const wizardContent = fs.readFileSync(wizardPath, 'utf8');
  assert.ok(!wizardContent.includes('5d8'), 'wizard-evoker.md 不应包含旧版 5d8 睡眠术规则');
  assert.ok(/60\s*尺/.test(wizardContent) && wizardContent.includes('感知豁免'), 'wizard-evoker.md 睡眠术应为 60尺 与 感知豁免');

  const cheatSheetPath = path.join(rootDir, 'templates', 'novice-cheat-sheet.md');
  const cheatSheetContent = fs.readFileSync(cheatSheetPath, 'utf8');
  assert.ok(!cheatSheetContent.includes('恢复一半生命骰'));
  assert.ok(cheatSheetContent.includes('重获所有已消耗的生命值骰'));

  const dmGuideContent = fs.readFileSync(path.join(rootDir, 'dm-guide.md'), 'utf8');
  assert.ok(dmGuideContent.includes('大型 (Large) 或更小'), 'dm-guide.md 推离(Push)必须为大型或更小生物');
  assert.ok(dmGuideContent.includes('不加属性调整值'), 'dm-guide.md 横扫(Cleave)必须注明次目标伤害不加属性调整值');
});

test('gate - SKILL.md D&D 2024 核心执裁常驻微胶囊与 8 项门禁完整性', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  const masteries = ['擦掠 (Graze)', '削弱 (Sap)', '失衡 (Topple)', '侵扰 (Vex)', '迅击 (Nick)', '推离 (Push)', '缓速 (Slow)', '横扫 (Cleave)'];
  for (const m of masteries) {
    assert.ok(content.includes(m), `常驻微胶囊必须包含武器精通指纹：${m}`);
  }

  assert.ok(content.includes('附赠动作 (Bonus Action)'));
  assert.ok(content.includes('突袭机制 (Surprise 2024)'));
  assert.ok(content.includes('力竭规则 (Exhaustion 2024)'));
  assert.ok(content.includes('倒地状态 (Prone)'));
  assert.ok(content.includes('浴血标记 (Bloodied)'));
  assert.ok(content.includes('真机物理掷骰铁律'));
  assert.ok(content.includes('绝对严禁口胡假骰'));
  assert.ok(content.includes('node scripts/roll-dice.js'));

  for (let i = 1; i <= 8; i++) {
    assert.ok(content.includes(`门禁 ${i}`), `必须包含门禁 ${i}`);
  }
});

test('gate - 预制角色卡数学公式重算审计与 presets.json 100% 对齐 (Stage 4 Gate)', () => {
  const premadeDir = path.join(rootDir, 'resources', 'premade-characters');
  const presets = JSON.parse(fs.readFileSync(path.join(premadeDir, 'presets.json'), 'utf8'));

  const expectedConfigs = [
    { key: 'valen', file: 'fighter-champion.md', expectedAc: 17, expectedHp: 12 },
    { key: 'lyra', file: 'rogue-thief.md', expectedAc: 14, expectedHp: 10 },
    { key: 'alistair', file: 'wizard-evoker.md', expectedAc: 12, expectedHp: 8, spellAbility: 'int', expectedDc: 13 },
    { key: 'vondal', file: 'cleric-life.md', expectedAc: 18, expectedHp: 12, spellAbility: 'wis', expectedDc: 13 },
    { key: 'theron', file: 'paladin-devotion.md', expectedAc: 18, expectedHp: 12, spellAbility: 'cha', expectedDc: 12 },
    { key: 'cassandra', file: 'bard-lore.md', expectedAc: 13, expectedHp: 9, spellAbility: 'cha', expectedDc: 13 },
    { key: 'bran', file: 'sidekick-bran.md', expectedAc: 14, expectedHp: 12 }
  ];

  for (const cfg of expectedConfigs) {
    const p = presets[cfg.key];
    assert.ok(p, `presets.json 必须包含预设 "${cfg.key}"`);

    const mod = (score) => Math.floor((score - 10) / 2);
    const conMod = mod(p.abilities.con);
    const computedHp = p.hitDie + conMod + (p.hpBonus || 0);
    assert.equal(p.maxHp, computedHp, `${cfg.key} 的 maxHp (${p.maxHp}) 必须严格等于生命骰满值 + CON调整值 + 额外加成 (${computedHp})`);
    assert.equal(p.maxHp, cfg.expectedHp);

    // 护甲等级重算校验
    const dexBonus = p.armor.addDex ? mod(p.abilities.dex) : 0;
    const computedAc = p.armor.baseAc + dexBonus + (p.armor.shield || 0) + (p.armor.bonus || 0);
    assert.equal(p.ac, computedAc, `${cfg.key} 的 AC (${p.ac}) 必须严格等于护甲公式计算值 (${computedAc})`);
    assert.equal(p.ac, cfg.expectedAc);

    const mdPath = path.join(premadeDir, cfg.file);
    assert.ok(fs.existsSync(mdPath), `角色卡文件 ${cfg.file} 必须存在`);
    const md = fs.readFileSync(mdPath, 'utf8');
    assert.ok(md.includes(p.name), `${cfg.file} 必须包含角色名 ${p.name}`);
    assert.ok(
      md.includes(`**${p.maxHp}**`) || md.includes(`${p.maxHp} / ${p.maxHp}`),
      `${cfg.file} 中的最大生命值必须与 presets.json (${p.maxHp}) 一致`
    );

    if (cfg.spellAbility) {
      const spellDc = 8 + p.proficiencyBonus + mod(p.abilities[cfg.spellAbility]);
      assert.equal(spellDc, cfg.expectedDc, `${cfg.key} 的法术豁免 DC 计算必须等于 ${cfg.expectedDc}`);
      assert.ok(md.includes(`**${spellDc}**`), `${cfg.file} 必须注明准确的法术豁免 DC ${spellDc}`);
    }
  }
});

test('gate - DMG 2024 五大教学冒险独立速查包完整性与零硬编码宿主机路径检查 (Stage 1 & 5 Gate)', () => {
  const starterDir = path.join(rootDir, 'resources', 'starter-adventure');
  const dmgPacks = [
    'dmg-1-fouled-stream.md',
    'dmg-2-miner-difficulties.md',
    'dmg-3-winged-god.md',
    'dmg-4-horns-of-the-beast.md',
    'dmg-5-boreal-ball.md'
  ];
  for (const f of dmgPacks) {
    const full = path.join(starterDir, f);
    assert.ok(fs.existsSync(full), `DMG 2024 教学冒险速查包 ${f} 必须存在`);
    assert.ok(fs.readFileSync(full, 'utf8').length > 800, `${f} 内容必须详实`);
  }

  // 检查全仓库 Markdown 文件无硬编码 /home/antigravity 路径
  function checkNoHardcodedPaths(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'sessions') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        checkNoHardcodedPaths(full);
      } else if (entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        assert.ok(
          !text.includes('/home/antigravity'),
          `文件 ${path.relative(rootDir, full)} 中不得残留宿主机硬编码路径 /home/antigravity`
        );
      }
    }
  }
  checkNoHardcodedPaths(rootDir);
});

test('gate - 构建脚本单元测试与 rules.db 体积 (<100MB)、元数据表及紧凑性门禁', () => {
  assert.equal(getCategory('怪物杀手', '珊娜萨的万事指南/职业选项/游侠/怪物杀手.htm'), 'class');
  assert.equal(getCategory('提夫林-九狱亚种', '魔邓肯的众敌卷册/种族选项/提夫林/提夫林-九狱亚种.htm'), 'origin');
  assert.equal(getCategory('工具', '玩家手册2024/装备/工具.htm'), 'item');
  assert.equal(getCategory('进行游戏', '城主指南2024/第一章：进行游戏/进行游戏.htm'), 'rule');

  const mockWcp = [
    '[OPTIONS]',
    'Title=5e不全书',
    '[TOPICS]',
    'TitleList=2',
    'TitleList.Title.0=地精武者',
    'TitleList.Level.0=2',
    'TitleList.Url.0=怪物图鉴2025\\地精\\地精武者.htm',
    'TitleList.Title.1=空白目录节点',
    'TitleList.Level.1=1',
    'TitleList.Url.1=',
    ''
  ].join('\r\n');
  const parsedItems = parseWcpContent(mockWcp);
  assert.equal(parsedItems.length, 2);
  assert.equal(parsedItems[0].title, '地精武者');
  assert.equal(parsedItems[0].url, '怪物图鉴2025/地精/地精武者.htm');

  const sampleHtml = '<table><tr><th>骰值</th><th>效果</th></tr><tr><td>1&#8211;2</td><td>&ldquo;暴击&rdquo; &#x2605;</td></tr></table>';
  const md = htmlToMarkdown(sampleHtml);
  assert.ok(md.includes('| --- | --- |'));
  assert.ok(md.includes('1–2'));
  assert.ok(md.includes('“暴击” ★'));
  assert.equal(decodeHtmlEntities('&mdash;&hellip;'), '—…');

  const dbPath = path.join(rootDir, 'references', 'rules.db');
  const stat = fs.statSync(dbPath);
  assert.ok(stat.size < 100 * 1024 * 1024, `rules.db 必须小于 GitHub 100MB 限制，当前: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const freelist = db.prepare('PRAGMA freelist_count').get();
  const emptyCount = db.prepare("SELECT count(*) as c FROM entries WHERE content_md = '' AND brief_md = ''").get();
  const totalCount = db.prepare('SELECT count(*) as c FROM entries').get();
  const metaRows = db.prepare('SELECT key, value FROM meta').all();
  db.close();

  assert.equal(freelist.freelist_count, 0, 'rules.db 经过 VACUUM 后 freelist_count 应为 0');
  assert.equal(emptyCount.c, 0, 'rules.db 不应包含任何空壳条目');
  assert.ok(totalCount.c >= 8900, `rules.db 应包含至少 8900 条去重有效词条，当前: ${totalCount.c}`);
  assert.ok(metaRows.length >= 2, 'rules.db 必须包含 meta 元数据表记录');
});
