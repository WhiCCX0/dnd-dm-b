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

test('gate - SKILL.md 2.2.0 版本规范与三级收敛架构声明', () => {
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
  assert.ok(
    content.includes('session-zero-interface.md'),
    'SKILL.md 必须在 L1 明确声明 session-zero-interface.md P0 必执行绑定'
  );
  assert.ok(!content.includes('5d8 生命值无豁免沉睡'), 'SKILL.md 不应残留 2014 版 5d8 睡眠术描述');
});

test('gate - 2024 规则一致性校验：睡眠术与长休生命值骰 (H3, H4)', () => {
  const wizardPath = path.join(rootDir, 'resources', 'premade-characters', 'wizard-evoker.md');
  const wizardContent = fs.readFileSync(wizardPath, 'utf8');
  assert.ok(!wizardContent.includes('5d8'), 'wizard-evoker.md 不应包含旧版 5d8 睡眠术规则');
  assert.ok(/60\s*尺/.test(wizardContent) && wizardContent.includes('感知豁免'), 'wizard-evoker.md 睡眠术应为 60尺 与 感知豁免');

  const cheatSheetPath = path.join(rootDir, 'templates', 'novice-cheat-sheet.md');
  const cheatSheetContent = fs.readFileSync(cheatSheetPath, 'utf8');
  assert.ok(!cheatSheetContent.includes('恢复一半生命骰'), 'novice-cheat-sheet.md 不应包含旧版恢复一半生命骰描述');
  assert.ok(cheatSheetContent.includes('重获所有已消耗的生命值骰'), 'novice-cheat-sheet.md 应声明重获所有已消耗的生命值骰');
});

test('gate - SKILL.md D&D 2024 核心执裁常驻微胶囊完整性', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  const masteries = ['擦掠 (Graze)', '削弱 (Sap)', '失衡 (Topple)', '侵扰 (Vex)', '迅击 (Nick)', '推离 (Push)', '缓速 (Slow)', '横扫 (Cleave)'];
  for (const m of masteries) {
    assert.ok(content.includes(m), `常驻微胶囊必须包含武器精通指纹：${m}`);
  }

  assert.ok(content.includes('附赠动作 (Bonus Action)'), '必须包含 2024 喝治疗药水附赠动作规则');
  assert.ok(content.includes('突袭机制 (Surprise 2024)'), '必须包含 2024 突袭先攻劣势规则');
  assert.ok(content.includes('力竭规则 (Exhaustion 2024)'), '必须包含 2024 力竭每层-2规则');
  assert.ok(content.includes('倒地状态 (Prone)'), '必须包含 2024 倒地起立半速与近优远劣规则');
  assert.ok(content.includes('浴血标记 (Bloodied)'), '必须包含 2024 浴血标记规则');

  assert.ok(
    content.includes('DC 5') &&
    content.includes('DC 10') &&
    content.includes('DC 15') &&
    content.includes('DC 20') &&
    content.includes('DC 25') &&
    content.includes('DC 30'),
    '常驻微胶囊必须内嵌极易到奇迹的标准 DC 梯次字典'
  );
});

test('gate - SKILL.md 真机物理掷骰铁律与 8 项硬门禁卡合规性', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  assert.ok(content.includes('真机物理掷骰铁律'), 'SKILL.md 必须确立真机物理掷骰铁律');
  assert.ok(content.includes('绝对严禁口胡假骰'), '必须明文严禁纯文本捏造假骰点');
  assert.ok(content.includes('node scripts/roll-dice.js'), '必须强制要求执行真实掷骰脚本并回显终端数据');

  for (let i = 1; i <= 8; i++) {
    assert.ok(content.includes(`门禁 ${i}`), `必须包含门禁 ${i}`);
  }
});

test('gate - templates/hud-status-bar.md 增量算式防漂移锁规范', () => {
  const hudPath = path.join(rootDir, 'templates', 'hud-status-bar.md');
  assert.ok(fs.existsSync(hudPath), 'hud-status-bar.md 模板必须存在');

  const content = fs.readFileSync(hudPath, 'utf8');
  assert.ok(content.includes('增量算式强制注记'), 'HUD 规范必须包含动态增量算式注记');
  assert.ok(content.includes('防漂移锁'), 'HUD 规范必须包含防漂移锁说明');
});

test('gate - resources/premade-characters 6 套 2024 中文预制角色卡中文化与完整性', () => {
  const premadeDir = path.join(rootDir, 'resources', 'premade-characters');
  const expectedFiles = [
    { file: 'fighter-champion.md', name: '瓦伦' },
    { file: 'rogue-thief.md', name: '莱拉' },
    { file: 'wizard-evoker.md', name: '阿里斯泰尔' },
    { file: 'cleric-life.md', name: '冯达尔' },
    { file: 'paladin-devotion.md', name: '瑟莱' },
    { file: 'bard-lore.md', name: '卡珊德拉' }
  ];

  for (const { file, name } of expectedFiles) {
    const filePath = path.join(premadeDir, file);
    assert.ok(fs.existsSync(filePath), `预制角色卡 ${file} 必须存在`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes(name), `${file} 必须包含中文角色名 ${name}`);
    assert.ok(content.includes('六维属性与豁免'), `${file} 必须包含中文化属性表`);
  }
});

test('gate - 构建脚本单元测试：getCategory、parseWcpContent、htmlToMarkdown 与 rules.db 紧凑性 (L16-L18)', () => {
  // 1. getCategory 分类优先级
  assert.equal(getCategory('怪物杀手', '珊娜萨的万事指南/职业选项/游侠/怪物杀手.htm'), 'class');
  assert.equal(getCategory('提夫林-九狱亚种', '魔邓肯的众敌卷册/种族选项/提夫林/提夫林-九狱亚种.htm'), 'origin');
  assert.equal(getCategory('工具', '玩家手册2024/装备/工具.htm'), 'item');
  assert.equal(getCategory('进行游戏', '城主指南2024/第一章：进行游戏/进行游戏.htm'), 'rule');

  // 2. parseWcpContent 动态特征解析
  const mockWcp = [
    '[OPTIONS]',
    'Title=5e不全书',
    '[TOPICS]',
    'TitleList=2',
    'TitleList.Title.0=地精武者',
    'TitleList.Level.0=2',
    'TitleList.Url.0=怪物图鉴2025\\地精\\地精武者.htm',
    'TitleList.Icon.0=0',
    'TitleList.Status.0=0',
    'TitleList.Keywords.0=',
    'TitleList.ContextNumber.0=1',
    'TitleList.ApplyTemp.0=0',
    'TitleList.Expanded.0=0',
    'TitleList.Kind.0=0',
    'TitleList.Title.1=空白目录节点',
    'TitleList.Level.1=1',
    'TitleList.Url.1=',
    ''
  ].join('\r\n');
  const parsedItems = parseWcpContent(mockWcp);
  assert.equal(parsedItems.length, 2);
  assert.equal(parsedItems[0].title, '地精武者');
  assert.equal(parsedItems[0].url, '怪物图鉴2025/地精/地精武者.htm');
  assert.equal(parsedItems[1].url, '');

  // 3. htmlToMarkdown 表格分隔行与 HTML 实体解码
  const sampleHtml = '<table><tr><th>骰值</th><th>效果</th></tr><tr><td>1&#8211;2</td><td>&ldquo;暴击&rdquo; &#x2605;</td></tr></table>';
  const md = htmlToMarkdown(sampleHtml);
  assert.ok(md.includes('| --- | --- |'), 'Markdown 表格首行后应自动生成 GFM 分隔行');
  assert.ok(md.includes('1–2'), '应正确解码十进制 HTML 实体 &#8211;');
  assert.ok(md.includes('“暴击” ★'), '应正确解码命名实体与十六进制实体');
  assert.equal(decodeHtmlEntities('&mdash;&hellip;'), '—…');

  // 4. rules.db 无空闲碎片页且无空正文条目
  const dbPath = path.join(rootDir, 'references', 'rules.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const freelist = db.prepare('PRAGMA freelist_count').get();
  const emptyCount = db.prepare("SELECT count(*) as c FROM entries WHERE content_md = '' AND brief_md = ''").get();
  db.close();

  assert.equal(freelist.freelist_count, 0, 'rules.db 经过 VACUUM 后 freelist_count 应为 0');
  assert.equal(emptyCount.c, 0, 'rules.db 不应包含任何空壳条目');
});
