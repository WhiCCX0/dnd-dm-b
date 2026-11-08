import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getCategory, parseWcpContent } from '../scripts/build-index.js';
import { htmlToMarkdown, decodeHtmlEntities } from '../scripts/build-db.js';
import { packDbArchive, setupFromRelease } from '../scripts/setup-db.js';
import { assertFts5Support, createFts5UnsupportedError } from '../scripts/sqlite-capability.js';

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
  assert.ok(content.includes('node <SKILL_DIR>/scripts/roll-dice.js'), 'SKILL.md 应使用 node <SKILL_DIR>/scripts/roll-dice.js 完整路径');

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

test('gate (R1) - DMG 2024 五篇主持包拆分“原文要点 / DM 扩展”，且原文要点中人名、怪物名、XP 与库内 #1071-#1075 一致', () => {
  const starterDir = path.join(rootDir, 'resources', 'starter-adventure');
  const dbPath = path.join(rootDir, 'references', 'rules.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });

  const specs = [
    {
      file: 'dmg-1-fouled-stream.md',
      id: 1071,
      npcs: ['波罗果芙'],
      monsters: ['树人', '枯枝怪', '尖叫菌', '啵灵蛙武者', '棕熊', '心能灰泥怪', '蚊蝠'],
      keyFacts: ['上厄里村', '自由城市灰鹰', '橡子', '治疗药水', '次等复原术', '形似大脑的真菌', '鲜花法杖'],
      forbiddenInCanon: ['橡溪村', '瘤木林', '异界裂隙', 'DC 11 体质豁免']
    },
    {
      file: 'dmg-2-miner-difficulties.md',
      id: 1072,
      npcs: ['克里斯崔蒂·裂砧', 'Kristryd Splitanvil'],
      monsters: ['打手', '紫腐菌', '锈蚀怪', '巨蜘蛛', '昆虫集群', '暗幕魔兽', '石锥怪', '凝胶方块', '恐爪怪'],
      keyFacts: ['黑石镇', '500gp', '黄玉', '黄霉菌', '东南角', '碎石', '无视角色'],
      forbiddenInCanon: ['Anvilcleaver', '被困矿工', 'DC 11 感知豁免', '铁索窄桥', '吊篮']
    },
    {
      file: 'dmg-3-winged-god.md',
      id: 1073,
      npcs: ['诺迪·巴杜克斯'],
      monsters: ['平民', '狗头人武者', '带翼狗头人', '熔岩魔蝠', '烟魔蝠', '红龙雏龙'],
      keyFacts: ['石冢山地', '钻石湖', '150gp', '400gp', '4200cp', '2000sp', '180gp', '50gp', '治疗药水', '攀爬绳', '警报术', '通晓语言'],
      forbiddenInCanon: ['发光洞窟', '农夫', '被掳村民', '水闸']
    },
    {
      file: 'dmg-4-horns-of-the-beast.md',
      id: 1074,
      npcs: ['梅尔奇斯', '埃乌兹'],
      monsters: ['邪魔邪教徒', '鲨华祭司', '鲨华武者', '水元素', '巨猿', '霸王龙', '异特龙', '甲龙', '历战武者', '新晋武者', '巴弗灭的牛头人', '巨鳄鱼', '狂蟾魔'],
      keyFacts: ['艾美迪奥丛林', '杰克力湾', '2000gp', '1-14', '流沙', '恶魔附身', '移除诅咒', '次元袋', '250gp', '传送法阵', '海神河', '鉴定术'],
      forbiddenInCanon: ['迷雾魔角岛', '热病丛林', '共鸣黑曜石']
    },
    {
      file: 'dmg-5-boreal-ball.md',
      id: 1075,
      npcs: ['北风舞会男爵', '坎尼法', '妲芮丝', '福吉特', '蜗牛舌奶奶', '拉夏斯·阿尔贝辛', '瓦卡'],
      monsters: ['半羊人欢庆之主', '树精', '皮克精', '绿鬼婆', '魔法师', '大地精长官', '大地精武者'],
      keyFacts: ['冰之宫殿', '庄园', '三支舞', '声望', '北风舞会护咒', '施展一次', '冰刃'],
      forbiddenInCanon: ['北风大公', '可用 3 次', '舞会总管']
    }
  ];

  try {
    for (const spec of specs) {
      const fullPath = path.join(starterDir, spec.file);
      const md = fs.readFileSync(fullPath, 'utf8');
      const canonHeader = `## 原文要点（严格对应库内 #${spec.id}）`;
      const extHeader = '## DM 扩展（非原文，可选）';

      const canonIdx = md.indexOf(canonHeader);
      const extIdx = md.indexOf(extHeader);
      assert.ok(canonIdx !== -1, `${spec.file} 必须包含标题：${canonHeader}`);
      assert.ok(extIdx > canonIdx, `${spec.file} 必须包含标题：${extHeader}，且位于原文要点之后`);
      assert.ok(!md.includes('DMG 原文'), `${spec.file} 缩放表列名与正文中不得再将改编/缩放内容标为“DMG 原文”`);

      const canonSection = md.slice(canonIdx, extIdx);
      const extSection = md.slice(extIdx);
      assert.ok(extSection.includes('官方 4 人配置'), `${spec.file} 的 DM 扩展缩放表应包含“官方 4 人配置”列`);
      assert.ok(!canonSection.includes('2 人双人配置') && !canonSection.includes('===='), `${spec.file} 原文要点不得混入缩放表或自绘 ASCII 地图`);

      const row = db.prepare('SELECT content_md FROM entries WHERE id = ?').get(spec.id);
      assert.ok(row && row.content_md, `rules.db 中必须存在 #${spec.id}`);
      const normDb = row.content_md.replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase();

      // 1. 校验原文要点中所有标注的 NPC 人名、怪物名、关键原文事实均在库内正文中存在
      for (const npc of spec.npcs) {
        assert.ok(canonSection.includes(npc), `${spec.file} 原文要点必须包含库内人名：${npc}`);
        assert.ok(normDb.includes(npc.replace(/\s+/g, ' ').toLowerCase()), `库内 #${spec.id} 必须包含人名：${npc}`);
      }
      for (const mon of spec.monsters) {
        assert.ok(canonSection.includes(`\`${mon}\``), `${spec.file} 原文要点必须以反引号标注怪物数据卡名：\`${mon}\``);
        assert.ok(normDb.includes(mon.toLowerCase()), `库内 #${spec.id} 必须包含怪物名：${mon}`);
      }
      for (const fact of spec.keyFacts) {
        const normCanon = canonSection.replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase();
        assert.ok(normCanon.includes(fact.toLowerCase()), `${spec.file} 原文要点必须包含库内关键设定/数值：${fact}`);
        assert.ok(normDb.includes(fact.toLowerCase()), `库内 #${spec.id} 必须包含关键设定/数值：${fact}`);
      }

      // 2. 动态反向扫描：原文要点中所有反引号标注的生物/数据卡名称必须 100% 出现在库内正文中
      const taggedTokens = [...canonSection.matchAll(/`([^`]+)`/g)].map(m => m[1].trim());
      assert.ok(taggedTokens.length >= spec.monsters.length, `${spec.file} 原文要点中应标注所有出场生物`);
      for (const tok of taggedTokens) {
        if (tok.startsWith('#') || tok.startsWith('node ')) continue;
        assert.ok(
          normDb.includes(tok.replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase()),
          `${spec.file} 原文要点中出现的标注词 \`${tok}\` 在库内 #${spec.id} 正文中找不到`
        );
      }

      // 3. 动态校验所有 XP 数字：原文要点中出现的每一个 XP 数字都必须在库内正文中找到对应 XP
      const xpMatches = [...canonSection.matchAll(/(\d[\d,]*)\s*XP/gi)].map(m => m[1].replace(/,/g, ''));
      assert.ok(xpMatches.length >= 1, `${spec.file} 原文要点必须写明库内 XP 奖励`);
      for (const xpNum of xpMatches) {
        assert.ok(
          normDb.includes(`${xpNum}xp`),
          `${spec.file} 原文要点中的 ${xpNum} XP 在库内 #${spec.id} 正文中找不到`
        );
      }

      // 4. 确认已被证伪的二创设定不在原文要点中残留
      for (const bad of spec.forbiddenInCanon) {
        assert.ok(!canonSection.includes(bad), `${spec.file} 原文要点不得残留非原文设定：${bad}`);
      }
    }
  } finally {
    db.close();
  }

  const skillMd = fs.readFileSync(path.join(rootDir, 'SKILL.md'), 'utf8');
  assert.ok(
    skillMd.includes('lookup.js module') && skillMd.includes('主持包只作辅助') && skillMd.includes('以原文为准'),
    'SKILL.md 必须写明：运行 A 类冒险时先 lookup module 读原文，主持包只作辅助，冲突以原文为准'
  );
});

test('gate - 构建脚本单元测试与 rules.db 元数据表及紧凑性门禁', () => {
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
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const freelist = db.prepare('PRAGMA freelist_count').get();
  const emptyCount = db.prepare("SELECT count(*) as c FROM entries WHERE content_md = '' AND brief_md = ''").get();
  const totalCount = db.prepare('SELECT count(*) as c FROM entries').get();
  const metaRows = db.prepare('SELECT key, value FROM meta').all();
  db.close();

  assert.equal(freelist.freelist_count, 0, 'rules.db 经过 VACUUM 后 freelist_count 应为 0');
  assert.equal(emptyCount.c, 0, 'rules.db 不应包含任何空壳条目');
  assert.ok(totalCount.c >= 8800, `rules.db 应包含至少 8800 条合并去重后的有效词条，当前: ${totalCount.c}`);
  assert.ok(metaRows.length >= 2, 'rules.db 必须包含 meta 元数据表记录');
});

test('gate (R13) - 文档命令统一使用 node <SKILL_DIR>/scripts/xxx.js，且 SKILL.md 开头说明如何确定 <SKILL_DIR>', () => {
  const skillMd = fs.readFileSync(path.join(rootDir, 'SKILL.md'), 'utf8');
  const introSlice = skillMd.slice(0, 1200);
  assert.ok(
    introSlice.includes('<SKILL_DIR>') && introSlice.includes('SKILL.md') && introSlice.includes('所在'),
    'SKILL.md 开头必须明确告知 agent 如何确定 <SKILL_DIR>（即 SKILL.md 所在目录）'
  );

  const docTargets = [
    path.join(rootDir, 'SKILL.md'),
    path.join(rootDir, 'README.md'),
    path.join(rootDir, 'dm-guide.md'),
    path.join(rootDir, 'references', 'session-zero-interface.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'official-modules-guide.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'the-whispering-crypt.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'dmg-1-fouled-stream.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'dmg-2-miner-difficulties.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'dmg-3-winged-god.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'dmg-4-horns-of-the-beast.md'),
    path.join(rootDir, 'resources', 'starter-adventure', 'dmg-5-boreal-ball.md'),
    path.join(rootDir, 'worlds', 'jianhuo', 'SCHEMA.md'),
    path.join(rootDir, 'worlds', 'jianhuo', 'capsule.md'),
    path.join(rootDir, 'worlds', 'jianhuo', 'mapping.md'),
    path.join(rootDir, 'worlds', 'jianhuo', 'MODE.md'),
    path.join(rootDir, 'worlds', 'jianhuo', 'start-form.md')
  ];

  const bareCmdRegex = /node\s+scripts\/(?:lookup|roll-dice|state|world)\.js\b/;
  for (const file of docTargets) {
    const rel = path.relative(rootDir, file);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      !bareCmdRegex.test(text),
      `文件 ${rel} 中仍残留依赖当前目录的相对命令 "node scripts/..."，应统一为 "node <SKILL_DIR>/scripts/..."`
    );
  }
});

test('gate (R15) - 常驻必检门禁只保留门禁 1（真骰）与门禁 2（规则时效），门禁 3 与门禁 7 移至按场景事件触发', () => {
  const skillMd = fs.readFileSync(path.join(rootDir, 'SKILL.md'), 'utf8');
  const alwaysIdx = skillMd.indexOf('【常驻必检门禁');
  const eventIdx = skillMd.indexOf('【按场景事件触发门禁');
  assert.ok(alwaysIdx !== -1 && eventIdx > alwaysIdx, 'SKILL.md 第 8 节必须包含【常驻必检门禁】与【按场景事件触发门禁】两级分组');

  const alwaysBlock = skillMd.slice(alwaysIdx, eventIdx);
  const eventBlock = skillMd.slice(eventIdx);

  assert.ok(alwaysBlock.includes('门禁 1') && alwaysBlock.includes('门禁 2'), '常驻必检门禁必须包含门禁 1 与门禁 2');
  for (const movedGate of ['门禁 3', '门禁 4', '门禁 5', '门禁 6', '门禁 7', '门禁 8']) {
    assert.ok(!alwaysBlock.includes(movedGate), `常驻必检门禁不得再包含 ${movedGate}`);
    assert.ok(eventBlock.includes(movedGate), `按场景事件触发门禁必须包含 ${movedGate}`);
  }

  assert.ok(
    eventBlock.includes('数值发生变化') && eventBlock.includes('询问状态'),
    '门禁 3 触发条件须改为“本回复中任何数值发生变化，或玩家询问状态时”'
  );
  assert.ok(
    eventBlock.includes('进入新场景') && eventBlock.includes('关键叙事节点'),
    '门禁 7 触发条件须改为“进入新场景或关键叙事节点时”'
  );

  const dmGuide = fs.readFileSync(path.join(rootDir, 'dm-guide.md'), 'utf8');
  const dmAlwaysIdx = dmGuide.indexOf('**常驻必检');
  const dmEventIdx = dmGuide.indexOf('**按场景事件触发');
  assert.ok(dmAlwaysIdx !== -1 && dmEventIdx > dmAlwaysIdx, 'dm-guide.md 第 11 节必须同步分级门禁');
  const dmAlwaysBlock = dmGuide.slice(dmAlwaysIdx, dmEventIdx);
  assert.ok(!dmAlwaysBlock.includes('门禁 3') && !dmAlwaysBlock.includes('门禁 7'), 'dm-guide.md 常驻必检不得包含门禁 3 与门禁 7');
});

test('gate (R16) - rules.db 与 topics_index.json 移出 git，零 npm 依赖，且 setup-db.js 严格校验 SHA-256', async () => {
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('references/rules.db'), '.gitignore 必须包含 references/rules.db');
  assert.ok(gitignore.includes('references/topics_index.json'), '.gitignore 必须包含 references/topics_index.json');

  const lsFiles = spawnSync('git', ['ls-files', 'references/rules.db', 'references/topics_index.json'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (lsFiles.status === 0) {
    assert.equal(
      lsFiles.stdout.trim(),
      '',
      `git 索引中不得继续跟踪 rules.db 或 topics_index.json，实际: ${lsFiles.stdout.trim()}`
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0, '不得引入任何外部 dependencies');
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0, '不得引入任何外部 devDependencies');

  // 验证 setup-db.js 压缩包打包 + SHA-256 校验通过与篡改拦截
  const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-r16-archive-'));
  try {
    const srcDir = path.join(tmpWork, 'src');
    const outDirOk = path.join(tmpWork, 'out-ok');
    const outDirBad = path.join(tmpWork, 'out-bad');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'rules.db'), Buffer.from('SQLite format 3\0mock-db-payload'));
    fs.writeFileSync(path.join(srcDir, 'topics_index.json'), JSON.stringify([{ id: 1, title: '测试' }]));

    const archivePath = path.join(tmpWork, 'bundle.tar.gz');
    const packed = await packDbArchive({
      rulesDbPath: path.join(srcDir, 'rules.db'),
      topicsIndexPath: path.join(srcDir, 'topics_index.json'),
      outArchivePath: archivePath
    });
    assert.match(packed.sha256, /^[a-f0-9]{64}$/);

    await setupFromRelease({
      url: pathToFileURL(archivePath).href,
      sha256: packed.sha256,
      targetDir: outDirOk
    });
    assert.equal(fs.readFileSync(path.join(outDirOk, 'topics_index.json'), 'utf8'), JSON.stringify([{ id: 1, title: '测试' }]));

    const wrongSha = '0'.repeat(64);
    await assert.rejects(
      () => setupFromRelease({
        url: pathToFileURL(archivePath).href,
        sha256: wrongSha,
        targetDir: outDirBad
      }),
      /SHA-256 校验失败/,
      'SHA-256 不一致时 setupFromRelease 必须拒绝解压并报错'
    );
    assert.equal(fs.existsSync(path.join(outDirBad, 'rules.db')), false, '校验失败时不得落盘未校验文件');
  } finally {
    fs.rmSync(tmpWork, { recursive: true, force: true });
  }
});


test('gate (R18) - setup-db 对 Release HTTP 5xx 有限重试，非 5xx 不重试', async () => {
  const http = await import('node:http');
  const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-r18-retry-'));
  const srcDir = path.join(tmpWork, 'src');
  const targetDir = path.join(tmpWork, 'out');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'rules.db'), Buffer.from('SQLite format 3\0mock-db-payload'));
  fs.writeFileSync(path.join(srcDir, 'topics_index.json'), JSON.stringify([{ id: 1, title: '重试测试' }]));

  const archivePath = path.join(tmpWork, 'bundle.tar.gz');
  const packed = await packDbArchive({
    rulesDbPath: path.join(srcDir, 'rules.db'),
    topicsIndexPath: path.join(srcDir, 'topics_index.json'),
    outArchivePath: archivePath
  });
  const archiveBytes = fs.readFileSync(archivePath);
  let releaseAttempts = 0;
  let notFoundAttempts = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/not-found') {
      notFoundAttempts++;
      res.writeHead(404);
      res.end('not found');
      return;
    }

    releaseAttempts++;
    if (releaseAttempts <= 2) {
      res.writeHead(503);
      res.end('temporary release failure');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': String(archiveBytes.length)
    });
    res.end(archiveBytes);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const previousNoProxy = process.env.NO_PROXY;
  process.env.NO_PROXY = '127.0.0.1,localhost';

  try {
    await setupFromRelease({
      url: `http://127.0.0.1:${port}/bundle.tar.gz`,
      sha256: packed.sha256,
      targetDir
    });

    assert.equal(releaseAttempts, 3, '前两次 HTTP 503 后应在第三次下载成功');
    assert.equal(
      fs.readFileSync(path.join(targetDir, 'topics_index.json'), 'utf8'),
      JSON.stringify([{ id: 1, title: '重试测试' }])
    );

    await assert.rejects(
      () => setupFromRelease({
        url: `http://127.0.0.1:${port}/not-found`,
        sha256: packed.sha256,
        targetDir: path.join(tmpWork, 'not-found')
      }),
      /HTTP 404/
    );
    assert.equal(notFoundAttempts, 1, 'HTTP 404 不应重试');
  } finally {
    if (previousNoProxy !== undefined) process.env.NO_PROXY = previousNoProxy;
    else delete process.env.NO_PROXY;
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tmpWork, { recursive: true, force: true });
  }
});

test('gate (R18) - 运行时版本门禁与 SQLite FTS5 能力一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.16.0');
  assert.equal(assertFts5Support(), true, '当前 CI Node.js 必须支持 SQLite FTS5');

  const unsupported = createFts5UnsupportedError(new Error('no such module: fts5'));
  assert.match(unsupported.message, /不支持 SQLite FTS5/);
  assert.ok(unsupported.message.includes(pkg.engines.node), '不支持 FTS5 时必须提示 package.json 要求的 Node.js 版本');
});

test('gate (R17) - 布兰·铁须头衔统一为“矮人斥候”，且全仓 HP/AC/武器数值与 presets.json 一致', () => {
  const presets = JSON.parse(fs.readFileSync(path.join(rootDir, 'resources', 'premade-characters', 'presets.json'), 'utf8'));
  const bran = presets.bran;
  assert.equal(bran.maxHp, 12);
  assert.equal(bran.ac, 14);
  assert.equal(bran.attacks[0].toHit, 4);
  assert.equal(bran.attacks[0].damage, '1d6+2');
  assert.equal(bran.attacks[1].toHit, 4);
  assert.equal(bran.attacks[1].damage, '1d6+2');

  const cryptMd = fs.readFileSync(path.join(rootDir, 'resources', 'starter-adventure', 'the-whispering-crypt.md'), 'utf8');
  assert.ok(!cryptMd.includes('老练猎人布兰'), 'the-whispering-crypt.md 不得再写“老练猎人布兰”，应统一为“矮人斥候”');
  assert.ok(cryptMd.includes('矮人斥候布兰·铁须'), 'the-whispering-crypt.md 应统一写“矮人斥候布兰·铁须”');
  assert.ok(cryptMd.includes('HP 12/12') && cryptMd.includes('AC 14') && cryptMd.includes('`1d6+2`'), 'the-whispering-crypt.md 布兰数值须与 presets.json 一致');

  const branSheet = fs.readFileSync(path.join(rootDir, 'resources', 'premade-characters', 'sidekick-bran.md'), 'utf8');
  assert.ok(branSheet.includes('矮人斥候随从'), 'sidekick-bran.md 标题应统一为“矮人斥候随从”');
  assert.ok(branSheet.includes('**14**') && branSheet.includes('**12**') && branSheet.includes('1d6 + 2'));

  for (const rel of ['SKILL.md', 'dm-guide.md', 'references/session-zero-interface.md']) {
    const text = fs.readFileSync(path.join(rootDir, rel), 'utf8');
    assert.ok(!text.includes('矮人老兵斥候') && !text.includes('矮人老练斥候'), `${rel} 中布兰头衔应统一为“矮人斥候”`);
  }
});

test('gate - GitHub Actions CI 数据库初始化顺序与模板 2024 数值/术语一致性门禁', () => {
  const ciYml = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
  const setupIdx = ciYml.indexOf('npm run setup-db');
  const testIdx = ciYml.indexOf('npm test');
  assert.ok(setupIdx !== -1, 'ci.yml 必须包含 npm run setup-db 步骤');
  assert.ok(testIdx !== -1 && setupIdx < testIdx, 'ci.yml 必须在执行 npm test 之前运行 npm run setup-db');

  const cheatSheet = fs.readFileSync(path.join(rootDir, 'templates', 'novice-cheat-sheet.md'), 'utf8');
  assert.ok(!cheatSheet.includes('长笛'), 'novice-cheat-sheet.md 精通词条示例不得包含错别字“长笛”');

  const tracker = fs.readFileSync(path.join(rootDir, 'templates', 'combat-tracker.md'), 'utf8');
  assert.ok(tracker.includes('| 17 | 12 / 12 |'), 'combat-tracker.md 中战士瓦伦 AC/HP 应与 presets.json (AC 17, HP 12/12) 一致');
  assert.ok(tracker.includes('| 14 | 10 / 10 |'), 'combat-tracker.md 中游荡者莱拉 AC/HP 应与 presets.json (AC 14, HP 10/10) 一致');
  assert.ok(tracker.includes('| 12 | 8 / 8 |'), 'combat-tracker.md 中法师阿里斯泰尔 AC/HP 应与 presets.json (AC 12, HP 8/8) 一致');
});

test('gate (T3) - dedup-report.json 零跨来源书合并，且被合并条目的全部骰式均保留在主条目正文中', async () => {
  const reportPath = path.join(rootDir, 'references', 'dedup-report.json');
  assert.ok(fs.existsSync(reportPath), 'references/dedup-report.json 必须由构建流程生成并存在');

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.ok(Array.isArray(report.merges), 'dedup-report.json 必须包含 merges 数组');

  const db = new DatabaseSync(path.join(rootDir, 'references', 'rules.db'));
  try {
    const getEntry = db.prepare('SELECT id, title, url, content_md FROM entries WHERE id = ?');
    for (const rec of report.merges) {
      assert.ok(rec.keptId && rec.mergedId, `合并记录缺少 id: ${JSON.stringify(rec)}`);
      assert.ok(rec.keptTitle && rec.mergedTitle, `合并记录缺少标题: ${JSON.stringify(rec)}`);
      assert.ok(rec.keptSource && rec.mergedSource, `合并记录缺少来源: ${JSON.stringify(rec)}`);
      assert.equal(typeof rec.similarity, 'number', `合并记录缺少相似度数值: ${JSON.stringify(rec)}`);
      assert.equal(typeof rec.keptLength, 'number', `合并记录缺少保留正文长度: ${JSON.stringify(rec)}`);
      assert.equal(typeof rec.mergedLength, 'number', `合并记录缺少被合并正文长度: ${JSON.stringify(rec)}`);
      assert.equal(
        rec.keptSource,
        rec.mergedSource,
        `禁止跨来源书自动合并！发现 ${rec.keptSource} (#${rec.keptId}) 吞并 ${rec.mergedSource} (#${rec.mergedId})`
      );

      const keptRow = getEntry.get(rec.keptId);
      assert.ok(keptRow, `保留条目 #${rec.keptId} 必须存在于 rules.db`);
      const keptLower = keptRow.content_md.replace(/\s+/g, '').toLowerCase();
      for (const die of rec.mergedDice || []) {
        const normDie = String(die).replace(/\s+/g, '').toLowerCase();
        assert.ok(
          keptLower.includes(normDie),
          `被合并条目 #${rec.mergedId} 中的骰式 "${die}" 必须保留在主条目 #${rec.keptId} 正文中`
        );
      }
    }
  } finally {
    db.close();
  }

  // 直接单元测试去重函数的跨来源保护、长度差异与骰式/数字差异保护
  const buildMod = await import('../scripts/build-db.js');
  assert.equal(typeof buildMod.deduplicateAndDisambiguateEntries, 'function', 'build-db.js 应导出 deduplicateAndDisambiguateEntries');

  const synthetic = [
    {
      id: 1, category: 'monster', title: '凝视者眼魔', titleEn: 'Gazer', aliases: [],
      url: '多元宇宙的怪物/图鉴/异怪/凝视者眼魔.htm', anchor: '', edition: '5e',
      contentMd: '小型异怪，绝对中立。AC 13，HP 13 (3d4+6)。啃咬：1d4 穿刺伤害。', briefMd: ''
    },
    {
      id: 2, category: 'monster', title: '凝视者眼魔', titleEn: 'Gazer', aliases: [],
      url: '瓦罗怪物指南/图鉴/凝视者眼魔.htm', anchor: '', edition: '5e',
      contentMd: '小型异怪，绝对中立。AC 13，HP 13 (3d4+6)。啃咬：1d4 穿刺伤害。', briefMd: ''
    },
    {
      id: 3, category: 'monster', title: '同书测试怪', titleEn: 'Test Mob', aliases: [],
      url: '怪物图鉴2025/测试/怪A.htm', anchor: '', edition: '2024',
      contentMd: '中型怪兽。AC 14，HP 22 (4d8+4)。爪击命中造成 1d6+2 挥砍伤害。', briefMd: ''
    },
    {
      id: 4, category: 'monster', title: '同书测试怪', titleEn: 'Test Mob', aliases: [],
      url: '怪物图鉴2025/测试/怪B.htm', anchor: '', edition: '2024',
      contentMd: '中型怪兽。AC 14，HP 22 (4d8+4)。爪击命中造成 2d6+3 挥砍伤害。', briefMd: ''
    }
  ];
  const synRes = buildMod.deduplicateAndDisambiguateEntries(synthetic);
  assert.equal(synRes.mergedCount, 0, '跨来源书同文条目与同书不同骰式条目均不得合并');
  assert.equal(synRes.finalEntries.length, 4, '4 条均应保留并通过来源后缀区分');
});

test('gate (T4) - 五篇 DMG 2024 主持包“奖励与 XP”严格区分原文与 DM 裁定', () => {
  const dmg2 = fs.readFileSync(path.join(rootDir, 'resources', 'starter-adventure', 'dmg-2-miner-difficulties.md'), 'utf8');
  assert.ok(
    !dmg2.includes('杀掉或通过清理底层东南角碎石放走'),
    'dmg-2-miner-difficulties.md 不得将“杀掉恐爪怪获 200 XP”写为原文'
  );
  assert.ok(
    dmg2.includes('清理碎石放走') && dmg2.includes('200 XP（原文）') && dmg2.includes('原文未单列 XP'),
    'dmg-2-miner-difficulties.md 须明确标注放走恐爪怪获 200 XP（原文），击杀按 CR 常规 XP 结算（DM 裁定）'
  );
});

test('gate (T5) - 全仓 Markdown 中所有 #编号 引用均存在且标题/别名与紧邻名称一致', (t) => {
  const db = new DatabaseSync(path.join(rootDir, 'references', 'rules.db'));
  try {
    const mdFiles = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === '.git' || ent.name === 'node_modules') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name.endsWith('.md')) mdFiles.push(full);
      }
    };
    walk(rootDir);

    const getRow = db.prepare('SELECT id, title, title_en, aliases FROM entries WHERE id = ?');
    const mismatches = [];
    let totalChecked = 0;

    for (const file of mdFiles) {
      const rel = path.relative(rootDir, file);
      const txt = fs.readFileSync(file, 'utf8');
      const seenAt = new Set();

      const patterns = [
        /`([^`\n#]+?)`\s*(?:[（(]\s*`?#(\d{2,5})`?|`#(\d{2,5})`)/g,
        /`([^`\n#]+?)\s+#(\d{2,5})`/g,
        /《([^》\n]+?)》[^\n#]{0,45}?`?#(\d{2,5})`?/g
      ];

      for (const re of patterns) {
        let m;
        while ((m = re.exec(txt)) !== null) {
          const rawName = m[1].trim();
          if (rawName.endsWith('.md')) continue;
          const id = Number(m[2] || m[3]);
          const dedupKey = `${m.index}:${id}`;
          if (seenAt.has(dedupKey)) continue;
          seenAt.add(dedupKey);

          totalChecked++;
          const row = getRow.get(id);
          if (!row) {
            mismatches.push(`${rel}: "${rawName}" 指向不存在的条目 #${id}`);
            continue;
          }
          const zhName = (rawName.match(/[\u4e00-\u9fa5·]+/) || [rawName])[0];
          const hay = `${row.title} | ${row.title_en || ''} | ${row.aliases || ''}`.toLowerCase();
          if (!hay.includes(zhName.toLowerCase()) && !hay.includes(rawName.toLowerCase())) {
            mismatches.push(`${rel}: "${rawName}" (#${id}) 实际指向 "${row.title}" (${row.title_en || ''})`);
          }
        }
      }
    }

    t.diagnostic(`T5 扫描 #编号 引用总数: ${totalChecked}, 失配数: ${mismatches.length}`);
    assert.ok(totalChecked >= 45, `应至少扫描到 45 处带名称的 #编号 引用，实际: ${totalChecked}`);
    assert.deepEqual(mismatches, [], `发现 #编号 引用失配:\n${mismatches.join('\n')}`);
  } finally {
    db.close();
  }
});

test('gate (T6) - setup-db 下载支持连接/空闲超时、离线安装提示、NO_PROXY 与进度输出', async () => {
  const net = await import('node:net');
  const http = await import('node:http');
  const setupMod = await import('../scripts/setup-db.js');
  const { downloadArchive } = setupMod;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-t6-dl-'));
  // 1. 只接受 TCP 连接但永不响应的挂起服务器 -> 必须在超时时间内报错退出并给出离线安装提示
  const hangServer = net.createServer((_socket) => {
    // intentionally never send data or close
  });
  await new Promise(resolve => hangServer.listen(0, '127.0.0.1', resolve));
  const hangPort = hangServer.address().port;

  try {
    const startMs = Date.now();
    let caughtErr = null;
    try {
      await Promise.race([
        downloadArchive(`http://127.0.0.1:${hangPort}/hang.tar.gz`, path.join(tmpDir, 'hang.tar.gz'), 5, {
          connectTimeoutMs: 250,
          idleTimeoutMs: 250,
          noProxy: '127.0.0.1,localhost'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TEST_GUARD_HUNG_FOREVER')), 2000))
      ]);
    } catch (err) {
      caughtErr = err;
    }
    const elapsed = Date.now() - startMs;
    assert.ok(caughtErr, '面对不响应服务器必须抛出超时错误');
    assert.notEqual(caughtErr.message, 'TEST_GUARD_HUNG_FOREVER', 'downloadArchive 未实现连接/响应超时，一直挂起');
    assert.ok(elapsed < 1800, `应在超时阈值附近快速退出，实际耗时 ${elapsed}ms`);
    assert.equal(caughtErr.message.trim().split(/\r?\n/).length, 1, `超时报错应为单行明确提示，实际: ${caughtErr.message}`);
    assert.ok(
      caughtErr.message.includes('超时') && caughtErr.message.includes('--from-release --url'),
      `超时错误须包含“超时”与离线安装提示 (--from-release --url)，实际: ${caughtErr.message}`
    );
  } finally {
    hangServer.close();
  }

  // 2. NO_PROXY 绕过不可用代理 + 每 10% 输出下载进度
  const payload = Buffer.alloc(1024 * 100, 0x61); // 100 KiB
  const okServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': String(payload.length) });
    for (let i = 0; i < 10; i++) {
      res.write(payload.subarray(i * 10240, (i + 1) * 10240));
    }
    res.end();
  });
  await new Promise(resolve => okServer.listen(0, '127.0.0.1', resolve));
  const okPort = okServer.address().port;

  const logs = [];
  try {
    const outFile = path.join(tmpDir, 'ok.tar.gz');
    await downloadArchive(`http://127.0.0.1:${okPort}/ok.tar.gz`, outFile, 5, {
      proxyEnv: 'http://127.0.0.1:1', // 死代理：若不尊重 NO_PROXY 将直接连接失败
      noProxy: '127.0.0.1,localhost',
      onProgress: (line) => logs.push(line)
    });
    assert.equal(fs.statSync(outFile).size, payload.length);
    assert.ok(logs.length >= 1 && logs.some(l => l.includes('%')), `应输出百分比下载进度，实际: ${JSON.stringify(logs)}`);
  } finally {
    okServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('gate (T1) - db-manifest 存完整 40 位 SHA，setupFromSource 仅浅拉取单提交，README 含离线安装说明', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'references', 'db-manifest.json'), 'utf8'));
  assert.match(
    manifest.upstreamCommit || '',
    /^[a-f0-9]{40}$/,
    `db-manifest.json 中 upstreamCommit 必须为完整 40 位 SHA，实际: ${manifest.upstreamCommit}`
  );

  const setupSrc = fs.readFileSync(path.join(rootDir, 'scripts', 'setup-db.js'), 'utf8');
  assert.ok(
    setupSrc.includes("'fetch', '--depth', '1'") || setupSrc.includes('"fetch", "--depth", "1"'),
    'setupFromSource 必须使用 git fetch --depth 1 只拉取目标提交'
  );
  assert.ok(setupSrc.includes('FETCH_HEAD'), 'setupFromSource 必须检出 FETCH_HEAD');
  assert.ok(!setupSrc.includes("'clone', '--no-checkout'"), 'setupFromSource 不得再使用全历史 git clone --no-checkout');

  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');
  assert.ok(
    readme.includes('离线安装') && readme.includes('--from-release --url'),
    'README.md 必须包含使用 setup-db.js --from-release --url <本地路径> 的离线安装说明'
  );
});


