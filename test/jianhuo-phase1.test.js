import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { lookup } from '../scripts/lookup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const jianhuoDir = path.join(rootDir, 'worlds', 'jianhuo');
const loreDir = path.join(jianhuoDir, 'lore');

const REQUIRED_LORE_FILES = [
  'world-rules.md',
  'history-and-eras.md',
  'nations-and-realms.md',
  'powers-and-factions.md',
  'martial-and-classes.md',
  'arcane-schools-and-reagents.md',
  'pantheon-and-cults.md',
  'daily-life-and-economy.md',
  'ecology-and-bestiary.md',
  'planes-and-cosmology.md',
  'srd-bestiary-and-planes.md',
  'legends-and-relics.md'
];

function collectMdFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectMdFiles(full));
    else if (ent.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('W1.1 - 阶段 1 目录结构、单权威去重与禁止搬迁项完备', () => {
  const topFiles = [
    path.join(jianhuoDir, 'SCHEMA.md'),
    path.join(jianhuoDir, 'capsule.md'),
    path.join(jianhuoDir, 'mapping.md'),
    path.join(jianhuoDir, 'migration-log.md'),
    path.join(jianhuoDir, 'secret', 'gm-dossier.md'),
    path.join(rootDir, 'references', 'writing-craft.md')
  ];
  for (const f of topFiles) {
    assert.ok(fs.existsSync(f), `缺少阶段 1 必需文件: ${path.relative(rootDir, f)}`);
    assert.ok(fs.statSync(f).size > 200, `文件不应为空壳: ${path.relative(rootDir, f)}`);
  }

  for (const name of REQUIRED_LORE_FILES) {
    const full = path.join(loreDir, name);
    assert.ok(fs.existsSync(full), `缺少设定切片: worlds/jianhuo/lore/${name}`);
    assert.ok(fs.statSync(full).size > 300, `设定切片内容过短: worlds/jianhuo/lore/${name}`);
  }

  // capsule.md 须严格 <= 120 行且保留第 14 行西方奇幻谱系总锚（地精改为侏儒）
  const capsuleLines = fs.readFileSync(path.join(jianhuoDir, 'capsule.md'), 'utf8').split(/\r?\n/);
  assert.ok(
    capsuleLines.length <= 120,
    `capsule.md 必须控制在 120 行以内，实际: ${capsuleLines.length} 行`
  );
  const capsuleTxt = capsuleLines.join('\n');
  assert.ok(
    capsuleTxt.includes('精灵的长寿与疏离') && capsuleTxt.includes('侏儒的魔导工学'),
    'capsule.md 必须保留西方奇幻谱系总锚且将工匠地精改为侏儒'
  );

  // 严禁保留母本第二权威、严禁搬迁 saves/、嵌套 .git/、旧验证/扫描脚本
  assert.ok(!fs.existsSync(path.join(jianhuoDir, 'world-setting.md')), '不得保留母本 world-setting.md 第二权威');
  assert.ok(!fs.existsSync(path.join(loreDir, 'world-setting.md')), 'lore/ 下不得保留母本 world-setting.md');
  assert.ok(!fs.existsSync(path.join(rootDir, 'references', 'world-setting.md')), 'references/ 下不得保留母本 world-setting.md');
  assert.ok(!fs.existsSync(path.join(jianhuoDir, 'saves')), '严禁搬迁私人存档目录 saves/');
  assert.ok(!fs.existsSync(path.join(jianhuoDir, '.git')), '严禁搬迁旧仓 .git/');
  assert.ok(!fs.existsSync(path.join(rootDir, 'scripts', 'de-ai-scan.js')), 'CommonJS de-ai-scan.js 不得迁入');
  assert.ok(!fs.existsSync(path.join(rootDir, 'scripts', 'validate-state.js')), '旧伤势 validate-state.js 不得迁入');
});

test('W1.2 - mapping.md 全量条目均由真实 lookup 精确命中且覆盖种族/职业/精通/九神/12本土魔兽', () => {
  const mappingTxt = fs.readFileSync(path.join(jianhuoDir, 'mapping.md'), 'utf8');
  const db = new DatabaseSync(path.join(rootDir, 'references', 'rules.db'), { readOnly: true });

  try {
    const getRow = db.prepare('SELECT id, title, category, edition FROM entries WHERE id = ?');
    const refRe = /`([^`\n#]+?)`\s*(?:[（(]\s*`?#(\d{1,5})`?\s*[)）])/g;
    const refs = [];
    let m;
    while ((m = refRe.exec(mappingTxt)) !== null) {
      refs.push({ name: m[1].trim(), id: Number(m[2]) });
    }

    assert.ok(refs.length >= 75, `mapping.md 应包含至少 75 处带 #编号 的规则库映射，实际: ${refs.length}`);

    const catToCmd = {
      monster: 'monster',
      class: 'class',
      feat: 'feat',
      item: 'item',
      spell: 'spell',
      rule: 'rule',
      origin: 'search'
    };

    const failures = [];
    for (const { name, id } of refs) {
      const row = getRow.get(id);
      if (!row) {
        failures.push(`#${id} (${name}) 在 rules.db 中不存在`);
        continue;
      }
      if (row.title !== name) {
        failures.push(`#${id} 标题为 "${row.title}"，mapping.md 写为 "${name}"`);
        continue;
      }
      const cmd = catToCmd[row.category] || 'search';
      const res = lookup(cmd, name, { json: true });
      if (!res.found) {
        failures.push(`lookup("${cmd}", "${name}") 未命中任何词条`);
      } else if (res.entry.id !== id) {
        failures.push(`lookup("${cmd}", "${name}") 命中 #${res.entry.id} (${res.entry.title})，而非预期 #${id}`);
      }
    }
    assert.deepEqual(failures, [], `mapping.md 存在未通过真实 lookup 核验的条目:\n${failures.join('\n')}`);

    // 关键覆盖核验：10 个 2024 种族、12 个 2024 职业、8 种武器精通、12 种本土魔兽、序章平民与 20 级后成长
    const requiredNames = [
      '人类', '精灵', '矮人', '半身人', '兽人', '龙裔', '侏儒', '提夫林', '阿斯莫', '歌利亚',
      '雅灵', '仙灵', '半羊人（多元宇宙的怪物）',
      '野蛮人', '吟游诗人', '牧师', '德鲁伊', '战士', '武僧', '圣武士', '游侠', '游荡者', '术士', '魔契师', '法师',
      '横扫', '擦掠', '迅击', '推离', '削弱', '缓速', '失衡', '侵扰',
      '生命领域', '光明领域', '诡术领域', '战争领域',
      '平民', '传奇恩惠专长', '超自然赠礼', '聚落', '非玩家角色',
      '夺心魔', '眼魔', '拟身怪', '凝胶方块', '地精武者'
    ];
    for (const req of requiredNames) {
      assert.ok(mappingTxt.includes(`\`${req}\``), `mapping.md 缺少关键规则库名称: \`${req}\``);
    }

    const nativeBeasts12 = [
      '霜翼尸鹫', '极地冰铠熊', '裂岩巨角兽', '铁脊腐狼',
      '湿沼勒喉水鬼', '腐木拟态巨蛛', '食髓盲蝠', '裂地酸斑石蟹',
      '噬铁黑蠕虫', '渊喉鸣喉怪', '玻璃之漠晶骨游魂', '双首畸变嵌合兽'
    ];
    const bestiaryTxt = fs.readFileSync(path.join(loreDir, 'ecology-and-bestiary.md'), 'utf8');
    for (const beast of nativeBeasts12) {
      assert.ok(mappingTxt.includes(beast), `mapping.md 必须逐只映射本土魔兽: ${beast}`);
      assert.ok(bestiaryTxt.includes(beast), `ecology-and-bestiary.md 必须保留本土魔兽并绑卡: ${beast}`);
    }
  } finally {
    db.close();
  }
});

test('W1.3 - 9 类违背 D&D 2024 的旧机制性条款全部清理干净', () => {
  const allFiles = [
    ...collectMdFiles(jianhuoDir),
    path.join(rootDir, 'references', 'writing-craft.md')
  ].filter(f => !f.endsWith('migration-log.md'));

  const bannedPatterns = [
    { re: /spell_burnout_stage|hp_state|treatment_status|folded_history_digest/, reason: '旧模板伤势/枯竭字段残留' },
    { re: /绝不向玩家宣告.{0,12}法术位|禁止说[“"]?法术位/, reason: '旧机制#1 禁说法术位' },
    { re: /施法耗时翻倍|耗材翻倍|永久掉上限/, reason: '旧机制#1 法术生理枯竭数值惩罚' },
    { re: /戴铁护手.{0,8}(?:不能|无法|禁止)施法|铁手套.{0,8}(?:不能|无法|禁止)施法/, reason: '旧机制#2 铁护手禁施法' },
    { re: /必须烧掉目标生前|烧掉生前用过的金币/, reason: '旧机制#4 死者交谈强制烧金币耗材' },
    { re: /高阶施法必留终身侵蚀|必然终身肉体畸变/, reason: '旧机制#5 强制终身肉体畸变铁律' },
    { re: /钝击伤害减半/, reason: '旧机制#6 信徒神恩数值减伤' },
    { re: /当场石化|心脏冻结暴毙|当场双目失明/, reason: '旧机制#6 破戒自动数值暴毙' },
    { re: /必遭法则绞杀|绝对禁止复活|禁止一切死而复生/, reason: '旧机制#7 机制禁复活与自动神罚' },
    { re: /极度不耐强酸|泼洒刺鼻黑醋/, reason: '旧机制#8 拟身怪强酸弱点反写（2024 实为强酸免疫）' },
    { re: /15\s*至\s*25\s*(?:帝国)?金币|12\s*(?:帝国)?金币.{0,10}战马/, reason: '旧机制#9 非 PHB 2024 旧板甲/战马物价' },
    { re: /完全免疫低阶火系/, reason: '旧机制#9 普通兽材直接赋予法术免疫' },
    { re: /句长极差\s*>\s*15/, reason: 'de-ai-scan 机械句长教条不得迁入' }
  ];

  const violations = [];
  for (const file of allFiles) {
    const rel = path.relative(rootDir, file);
    const txt = fs.readFileSync(file, 'utf8');
    for (const { re, reason } of bannedPatterns) {
      if (re.test(txt)) {
        violations.push(`${rel}: 命中违禁旧规则 [${reason}] (${re})`);
      }
    }
  }
  assert.deepEqual(violations, [], `发现未清理的旧机制条款:\n${violations.join('\n')}`);

  // 正向核验：复活按 2024 可用、拟身怪标明强酸免疫、板甲按 PHB 2024 标 1,500 gp
  const worldRules = fs.readFileSync(path.join(loreDir, 'world-rules.md'), 'utf8');
  assert.ok(
    worldRules.includes('2024') && worldRules.includes('复活'),
    'world-rules.md 须明确 2024 合法复活法术始终可用，仅产生宗教/政治叙事后果'
  );
  const srdBestiary = fs.readFileSync(path.join(loreDir, 'srd-bestiary-and-planes.md'), 'utf8');
  assert.ok(
    srdBestiary.includes('`拟身怪`') && srdBestiary.includes('强酸免疫'),
    'srd-bestiary-and-planes.md 须写明拟身怪在 2024 数据卡中具有强酸免疫'
  );
  const economy = fs.readFileSync(path.join(loreDir, 'daily-life-and-economy.md'), 'utf8');
  assert.ok(
    economy.includes('1,500 gp') || economy.includes('1500 gp'),
    'daily-life-and-economy.md 板甲价格必须对齐 PHB 2024 的 1,500 gp'
  );
});

test('W1.4 - 十二席彻底删除、侏儒/地精规矩、苍穹之冠与冬线速度矛盾统一、武器精通标准译名', () => {
  const sliceFiles = collectMdFiles(jianhuoDir).filter(f => !f.endsWith('migration-log.md'));

  const twelveSeatsBanned = [
    '十二席', '当代传奇名录', '灰烬圣女', '断岳·戈尔姆', '戈尔姆',
    '九戒·奥义斯', '白鲸女王', '无声王', '盲眼先知', '白甲·卡莱恩', '守泉老人',
    '永冬之王正在苏醒', '三个僭主'
  ];
  const artisanGoblinBanned = ['地精工坊', '地精精算', '地精的魔导工学', '地精魔导', '⑦地精', '地精城邦'];

  const issues = [];
  for (const file of sliceFiles) {
    const rel = path.relative(rootDir, file);
    const txt = fs.readFileSync(file, 'utf8');
    for (const term of twelveSeatsBanned) {
      if (txt.includes(term)) issues.push(`${rel}: 残留十二席/固定传奇人物词 "${term}"`);
    }
    for (const term of artisanGoblinBanned) {
      if (txt.includes(term)) issues.push(`${rel}: 残留工匠族旧称 "${term}"（须改为侏儒）`);
    }
    if (txt.includes('天穹之冠')) {
      issues.push(`${rel}: 残留未统一异名 "天穹之冠"（须统一为苍穹之冠）`);
    }
    if (/每年南移一里|每年向南推进三里/.test(txt)) {
      issues.push(`${rel}: 残留冲突冬线速度（须统一为往年一寸、今年半里）`);
    }
  }
  assert.deepEqual(issues, [], `发现十二席残留或设定矛盾:\n${issues.join('\n')}`);

  // 器物持有者改为下落成谜/多方争夺
  const relics = fs.readFileSync(path.join(loreDir, 'legends-and-relics.md'), 'utf8');
  assert.ok(
    relics.includes('殉道者骨链') && relics.includes('锈铁断钢') &&
    relics.includes('下落成谜') && relics.includes('多方争夺'),
    'legends-and-relics.md 须保留殉道者骨链与锈铁断钢并将持有者改为下落成谜/多方争夺'
  );

  // 苍穹之冠表里两层与冬线速度在公开卷和内档一致对齐
  const nations = fs.readFileSync(path.join(loreDir, 'nations-and-realms.md'), 'utf8');
  const dossier = fs.readFileSync(path.join(jianhuoDir, 'secret', 'gm-dossier.md'), 'utf8');

  assert.ok(nations.includes('苍穹之冠') && nations.includes('缓慢下沉'), '公开卷须写明苍穹之冠对外流传缓慢下沉');
  assert.ok(
    dossier.includes('苍穹之冠') && dossier.includes('缓慢下沉') &&
    dossier.includes('锚链将断') && dossier.includes('飘向虚空'),
    '内档须统一名称为苍穹之冠，并对齐“对外流传缓慢下沉 / 候选真相锚链将断飘向虚空”两层'
  );

  for (const [label, txt] of [['nations-and-realms.md', nations], ['gm-dossier.md', dossier]]) {
    assert.ok(
      txt.includes('一寸') && txt.includes('半里'),
      `${label} 冬线速度必须统一包含“往年每年……一寸，今年骤然加速至半里”`
    );
  }

  // 武器精通必须使用 5echm 2024 标准译名，不含旧错译
  const martial = fs.readFileSync(path.join(loreDir, 'martial-and-classes.md'), 'utf8');
  for (const mName of ['横扫', '擦掠', '迅击', '推离', '削弱', '缓速', '失衡', '侵扰']) {
    assert.ok(martial.includes(`\`${mName}\``), `martial-and-classes.md 缺少 2024 标准武器精通 \`${mName}\``);
  }
  for (const oldWrong of ['钝击减力', '缓足', '绊摔', '扰目']) {
    assert.ok(!martial.includes(oldWrong), `martial-and-classes.md 不得保留旧错误精通译名 "${oldWrong}"`);
  }
});

test('W1.5 - migration-log.md 完整覆盖原仓文件与母本全部独有段落且已落入对应切片', () => {
  const migLog = fs.readFileSync(path.join(jianhuoDir, 'migration-log.md'), 'utf8');

  const sourceFiles = [
    'SKILL.md', 'world-setting.md', 'world-rules.md', 'history-and-eras.md',
    'nations-and-realms.md', 'powers-and-factions.md', 'martial-and-classes.md',
    'arcane-schools-and-reagents.md', 'pantheon-and-cults.md', 'daily-life-and-economy.md',
    'ecology-and-bestiary.md', 'planes-and-cosmology.md', 'srd-bestiary-and-planes.md',
    'legends-and-relics.md', 'starting-interface.md', 'literary-pipeline-contract.md',
    'gm-dossier.md', 'validate-state.js', 'de-ai-scan.js'
  ];
  for (const sf of sourceFiles) {
    assert.ok(migLog.includes(sf), `migration-log.md 必须记录原仓文件处理去向: ${sf}`);
  }

  const uniqueMotherItems = [
    '西方奇幻谱系总锚',
    '巫术四灵',
    '魂法三阶',
    '隐世之境',
    '野性与狩猎',
    '独立 NPC',
    '传说形成律',
    '具名担保',
    '监护',
    '授刃礼'
  ];
  for (const item of uniqueMotherItems) {
    assert.ok(migLog.includes(item), `migration-log.md 必须登记母本独有段落救回记录: ${item}`);
  }

  // 实证救回段落确实存在于迁入切片中，而非只记空账
  const powers = fs.readFileSync(path.join(loreDir, 'powers-and-factions.md'), 'utf8');
  assert.ok(powers.includes('巫术四灵') && powers.includes('魂法三阶') && powers.includes('隐世之境'), 'powers-and-factions.md 必须实际救回巫术四灵、魂法三阶、隐世之境');
  assert.ok(powers.includes('具名担保') && powers.includes('授刃礼') && powers.includes('监护'), 'powers-and-factions.md 必须实际救回公会跳级具名担保与 17 岁监护连带/部族授刃礼');

  const pantheon = fs.readFileSync(path.join(loreDir, 'pantheon-and-cults.md'), 'utf8');
  assert.ok(pantheon.includes('野性与狩猎'), 'pantheon-and-cults.md 必须实际救回边地野性与狩猎信仰');

  const history = fs.readFileSync(path.join(loreDir, 'history-and-eras.md'), 'utf8');
  assert.ok(history.includes('传说形成律'), 'history-and-eras.md 必须实际救回传说形成失真律');

  // 货币措辞检查：在仓库主人最终确认前，不提前声称货币方案“已确认”
  for (const f of collectMdFiles(jianhuoDir)) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(
      !/货币记账契约[^\n]*已确认|统一铜币[^\n]*已确认/.test(txt),
      `${path.relative(rootDir, f)} 在仓库主人确认前不得将统一铜币写为“已确认”`
    );
  }
});
