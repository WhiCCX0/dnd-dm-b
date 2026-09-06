import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('gate - references/session-zero-interface.md 官方开局切片完整性', () => {
  const sessionZeroPath = path.join(rootDir, 'references', 'session-zero-interface.md');
  assert.ok(fs.existsSync(sessionZeroPath), 'session-zero-interface.md 文件必须存在');

  const content = fs.readFileSync(sessionZeroPath, 'utf8');
  assert.ok(content.length > 1000, 'session-zero-interface.md 内容必须详实 (>1000 bytes)');

  // 必须包含标准三步架构
  assert.ok(content.includes('【第一步：选择跑团模式】'), '必须包含第一步模式选择');
  assert.ok(content.includes('【第二步：认领 2024 英雄角色卡】'), '必须包含第二步角色认领');
  assert.ok(content.includes('【第三步：选择冒险战役剧本】'), '必须包含第三步剧本选本');

  // 必须包含 6 套 2024 预制英雄卡招牌
  const heroes = ['瓦伦', '莱拉', '阿里斯泰尔', '冯达尔', '瑟莱', '卡珊德拉'];
  for (const hero of heroes) {
    assert.ok(content.includes(hero), `开局接口必须包含预制英雄：${hero}`);
  }

  // 必须包含极速开局与代抽指引
  assert.ok(content.includes('① ① ①') && content.includes('随机'), '必须包含极速指令与代抽指引');
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
});

test('gate - SKILL.md D&D 2024 核心执裁常驻微胶囊完整性', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  // 八大武器精通指纹
  const masteries = ['擦掠 (Graze)', '削弱 (Sap)', '失衡 (Topple)', '侵扰 (Vex)', '迅击 (Nick)', '推离 (Push)', '缓速 (Slow)', '横扫 (Cleave)'];
  for (const m of masteries) {
    assert.ok(content.includes(m), `常驻微胶囊必须包含武器精通指纹：${m}`);
  }

  // 2024 五大核心执裁机制
  assert.ok(content.includes('附赠动作 (Bonus Action)'), '必须包含 2024 喝治疗药水附赠动作规则');
  assert.ok(content.includes('突袭机制 (Surprise 2024)'), '必须包含 2024 突袭先攻劣势规则');
  assert.ok(content.includes('力竭规则 (Exhaustion 2024)'), '必须包含 2024 力竭每层-2规则');
  assert.ok(content.includes('倒地状态 (Prone)'), '必须包含 2024 倒地起立半速与近优远劣规则');
  assert.ok(content.includes('浴血标记 (Bloodied)'), '必须包含 2024 浴血标记规则');

  // 标准 DC 字典
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

test('gate - SKILL.md 真机物理掷骰铁律约束', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  assert.ok(content.includes('真机物理掷骰铁律'), 'SKILL.md 必须确立真机物理掷骰铁律');
  assert.ok(content.includes('绝对严禁口胡假骰'), '必须明文严禁纯文本捏造假骰点');
  assert.ok(content.includes('node scripts/roll-dice.js'), '必须强制要求执行真实掷骰脚本并回显终端数据');
});

test('gate - SKILL.md DM 执裁 8 项硬门禁卡合规性', () => {
  const skillPath = path.join(rootDir, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');

  assert.ok(content.includes('DM 执裁 8 项硬门禁卡'), 'SKILL.md 附录必须包含 8 项硬门禁卡');
  assert.ok(content.includes('门禁 1 (客观真骰)'), '必须包含客观真骰门禁');
  assert.ok(content.includes('门禁 2 (规则时效)'), '必须包含 2024 规则时效门禁');
  assert.ok(content.includes('门禁 3 (HUD防漂移)'), '必须包含 HUD 防漂移门禁');
  assert.ok(content.includes('门禁 4 (行动脚手架)'), '必须包含四选一行动脚手架门禁');
  assert.ok(content.includes('门禁 5 (空间战图)'), '必须包含 ASCII 战图门禁');
  assert.ok(content.includes('门禁 6 (反应暂停)'), '必须包含反应主动暂停征询门禁');
  assert.ok(content.includes('门禁 7 (去AI味与通感)'), '必须包含去AI味与通感门禁');
  assert.ok(content.includes('门禁 8 (开局接口)'), '必须包含 Session 0 开局接口门禁');
});

test('gate - templates/hud-status-bar.md 增量算式防漂移锁规范', () => {
  const hudPath = path.join(rootDir, 'templates', 'hud-status-bar.md');
  assert.ok(fs.existsSync(hudPath), 'hud-status-bar.md 模板必须存在');

  const content = fs.readFileSync(hudPath, 'utf8');
  assert.ok(content.includes('增量算式强制注记'), 'HUD 规范必须包含动态增量算式注记');
  assert.ok(content.includes('防漂移锁'), 'HUD 规范必须包含防漂移锁说明');
});
