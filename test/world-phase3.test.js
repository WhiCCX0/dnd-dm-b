import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateDModeStateDoc,
  toTotalHours,
  formatTimestamp
} from '../scripts/world-contract.js';

import {
  initWorld,
  getWorld,
  formatWorldStatus,
  runWorldTime,
  manageClock
} from '../scripts/world.js';

import {
  initSession,
  getState,
  updateState,
  promoteCharacter,
  generateHud
} from '../scripts/state.js';

import { lookup } from '../scripts/lookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORLD_SCRIPT = path.join(ROOT_DIR, 'scripts', 'world.js');
const STATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'state.js');
const LOOKUP_SCRIPT = path.join(ROOT_DIR, 'scripts', 'lookup.js');
const DICE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'roll-dice.js');

const TEMP_SESSIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-p3-sessions-'));
process.env.DND_SESSIONS_DIR = TEMP_SESSIONS_DIR;
process.env.SESSIONS_DIR = TEMP_SESSIONS_DIR;

test.after(() => {
  if (fs.existsSync(TEMP_SESSIONS_DIR)) {
    fs.rmSync(TEMP_SESSIONS_DIR, { recursive: true, force: true });
  }
});

function cleanCampaign(name) {
  const dir = path.join(TEMP_SESSIONS_DIR, name);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('phase3 (缺口修复 1：钱只记一套账) - D 模式只用 inventory.copper 不存 gold，--gold/--copper 均换算作用于 copper，A/B/C 的 gold 不变', () => {
  const schemaText = fs.readFileSync(path.join(ROOT_DIR, 'worlds', 'jianhuo', 'SCHEMA.md'), 'utf8');
  assert.ok(schemaText.includes('已确认'), 'SCHEMA.md 1.4 节货币方式必须标注“已确认”');

  // 1) D 模式用 --copper 初始化：严禁存 gold 字段
  const dCampCopper = 'p3-currency-d-copper';
  cleanCampaign(dCampCopper);
  const st1 = initSession(dCampCopper, { mode: 'D', name: '霍克', copper: 235 });
  assert.equal(st1.inventory.copper, 235);
  assert.equal(Object.prototype.hasOwnProperty.call(st1.inventory, 'gold'), false, 'D 模式存档严禁包含 gold 字段');
  assert.equal(validateDModeStateDoc(st1).valid, true);
  assert.ok(generateHud(st1, 'line').includes('2gp 3sp 5cp'));

  // 2) D 模式用 --gold 初始化：自动换算为 copper (12gp -> 1200cp)，且不存 gold 字段
  const dCampGold = 'p3-currency-d-gold';
  cleanCampaign(dCampGold);
  const st2 = initSession(dCampGold, { mode: 'D', name: '莱拉', gold: 12 });
  assert.equal(st2.inventory.copper, 1200);
  assert.equal(Object.prototype.hasOwnProperty.call(st2.inventory, 'gold'), false, 'D 模式用 --gold 初始化也不得存 gold 字段');

  // 3) D 模式 update --copper 与 --gold：全部换算后作用于 inventory.copper，绝不产生 inventory.gold
  updateState(dCampCopper, { copper: '+65' }); // 235 + 65 = 300cp
  assert.equal(getState(dCampCopper).inventory.copper, 300);
  assert.equal('gold' in getState(dCampCopper).inventory, false);

  updateState(dCampCopper, { gold: '+2' }); // 300 + 200 = 500cp
  assert.equal(getState(dCampCopper).inventory.copper, 500);
  assert.equal('gold' in getState(dCampCopper).inventory, false);

  updateState(dCampCopper, { gold: '-1' }); // 500 - 100 = 400cp
  assert.equal(getState(dCampCopper).inventory.copper, 400);
  assert.equal('gold' in getState(dCampCopper).inventory, false);

  updateState(dCampCopper, { copper: '-150' }); // 400 - 150 = 250cp
  assert.equal(getState(dCampCopper).inventory.copper, 250);
  assert.equal('gold' in getState(dCampCopper).inventory, false);

  updateState(dCampCopper, { gold: '3' }); // 设为 3gp = 300cp
  assert.equal(getState(dCampCopper).inventory.copper, 300);
  assert.equal('gold' in getState(dCampCopper).inventory, false);

  // 4) A/B/C 模式：完全保持 inventory.gold 行为不变，不生成 copper
  const abcCamp = 'p3-currency-abc';
  cleanCampaign(abcCamp);
  const abcInit = initSession(abcCamp, { name: '瓦伦', gold: 20 });
  assert.equal(abcInit.inventory.gold, 20);
  assert.equal('copper' in abcInit.inventory, false, 'A/B/C 模式不得包含 copper 字段');
  updateState(abcCamp, { gold: '+5' });
  assert.equal(getState(abcCamp).inventory.gold, 25);
  assert.equal('copper' in getState(abcCamp).inventory, false);
});

test('phase3 (缺口修复 2 & 3：world init 不写死开局、3 个“患”级局部问题、★代价/◆限制转换与演化八线 3–4 条按地区启动)', () => {
  // 1) 无参 init：不写死“灰港”或默认势力
  const bareCamp = 'p3-init-bare';
  cleanCampaign(bareCamp);
  const bareWorld = initWorld(bareCamp, { seed: 1001 });
  assert.equal(bareWorld.locations.length, 0, '不传地区/地点时 locations 应为空，不写死“灰港”');
  assert.equal(bareWorld.factions.length, 0, '不传势力时 factions 应为空，不写死默认势力');
  assert.equal(JSON.stringify(bareWorld).includes('灰港'), false, 'world.json 不得残留未在设定中出现的写死地名“灰港”');

  // 2) 使用设定原名开局（如 圣座同盟·灰岩十一邦）：生成 3 个“患”级局部问题（时钟 + 账本）、转换 ★代价 与 ◆限制、仅激活 3-4 条相关演化线
  const loreCamp = 'p3-init-lore-region';
  cleanCampaign(loreCamp);
  const loreWorld = initWorld(loreCamp, {
    seed: 202611,
    region: '圣座同盟·灰岩十一邦',
    location: '白石修道院外镇',
    tier: '凡俗',
    factions: '圣座审讯骑兵,灰烬学者外围',
    cost: '欠修道院药房 120cp 疗伤契约款',
    limit: '7日内须取得审讯所签发的出境路引'
  });

  assert.equal(loreWorld.meta.region, '圣座同盟·灰岩十一邦');
  assert.equal(loreWorld.locations.length, 1);
  assert.equal(loreWorld.locations[0].name, '白石修道院外镇');
  assert.equal(loreWorld.locations[0].tier, '凡俗');
  assert.equal(loreWorld.factions.length, 2);
  assert.deepEqual(loreWorld.factions.map(f => f.name), ['圣座审讯骑兵', '灰烬学者外围']);

  // 校验开局地区生成的 3 个“患”级局部问题（3 个局部威胁时钟 + 3 条对应账本记录）
  const troubleClocks = loreWorld.clocks.filter(c => c.kind === 'threat' && c.id.startsWith('clk:trouble_'));
  const troubleLedgers = loreWorld.ledger.filter(l => l.id.startsWith('led:trouble_'));
  assert.equal(troubleClocks.length, 3, '必须在开局地区生成 3 个“患”级局部问题时钟');
  assert.equal(troubleLedgers.length, 3, '必须在开局地区生成 3 条“患”级局部问题账本记录');
  for (const tc of troubleClocks) {
    assert.equal(tc.status, 'active');
    assert.ok(tc.name.includes('患'), `局部问题时钟名称应标明“患”: ${tc.name}`);
  }

  // 校验 ★代价 与 ◆限制 已分别转为账本记录或局部时钟
  const hasCostRecord =
    loreWorld.ledger.some(l => l.summary.includes('欠修道院药房 120cp')) ||
    loreWorld.clocks.some(c => c.name.includes('欠修道院药房 120cp'));
  const hasLimitRecord =
    loreWorld.clocks.some(c => c.name.includes('7日内须取得审讯所签发的出境路引')) ||
    loreWorld.ledger.some(l => l.summary.includes('7日内须取得审讯所签发的出境路引'));
  assert.equal(hasCostRecord, true, '★代价 必须转成一条账本记录或局部时钟');
  assert.equal(hasLimitRecord, true, '◆限制 必须转成一条账本记录或局部时钟');

  // 校验演化八线：开局只启动与该地区相关的 3-4 条，其余 4-5 条为待启动状态 (paused)
  const tracks = loreWorld.clocks.filter(c => c.kind === 'track');
  assert.equal(tracks.length, 8);
  const activeTracks = tracks.filter(c => c.status === 'active');
  const pausedTracks = tracks.filter(c => c.status === 'paused');
  assert.ok(
    activeTracks.length >= 3 && activeTracks.length <= 4,
    `圣座同盟开局应只启动 3-4 条相关演化线，实际启动 ${activeTracks.length} 条: ${activeTracks.map(t => t.name).join(', ')}`
  );
  assert.equal(activeTracks.length + pausedTracks.length, 8);
  assert.ok(activeTracks.some(t => t.name === '教会分裂'), '圣座同盟开局应启动【教会分裂】线');

  // 3) 完全自定义地区、地点与势力开局同样支持，且待启动演化线可在后续到达或波及时启动
  const customCamp = 'p3-init-custom-region';
  cleanCampaign(customCamp);
  const customWorld = initWorld(customCamp, {
    seed: 30303,
    region: '白雾河谷自治领',
    location: '断桥集市',
    tier: '文明',
    factions: '河谷驳船帮,断桥巡夜队',
    cost: '替失踪船长保管半枚铜契',
    limit: '3日后河谷大雾封航'
  });
  assert.equal(customWorld.locations[0].name, '断桥集市');
  assert.equal(customWorld.factions.length, 2);
  assert.equal(customWorld.clocks.filter(c => c.id.startsWith('clk:trouble_')).length, 3);
  assert.equal(customWorld.ledger.filter(l => l.id.startsWith('led:trouble_')).length, 3);
  const customActiveTracks = customWorld.clocks.filter(c => c.kind === 'track' && c.status === 'active');
  const customPausedTracks = customWorld.clocks.filter(c => c.kind === 'track' && c.status === 'paused');
  assert.ok(customActiveTracks.length >= 3 && customActiveTracks.length <= 4);
  assert.equal(customActiveTracks.length + customPausedTracks.length, 8);

  // 推进 30 天：处于 paused 待启动状态的演化线不会推进，随后玩家抵达相关地区调用 clock --resume 启动该线并对齐 nextTick
  runWorldTime(customCamp, { advance: '30d' });
  const pausedId = customPausedTracks[0].id;
  assert.equal(getWorld(customCamp).clocks.find(c => c.id === pausedId).current, 0, '待启动状态的演化线不应随时间自动推进');
  const resumeRes = manageClock(customCamp, { resume: true, id: pausedId });
  assert.equal(resumeRes.clock.status, 'active');
  assert.ok(
    toTotalHours(resumeRes.clock.nextTick) > toTotalHours(resumeRes.world.calendar),
    `待启动演化线被激活时，nextTick (${resumeRes.clock.nextTick}) 必须对齐到当前时间 (${formatTimestamp(resumeRes.world.calendar)}) 之后`
  );
});

test('phase3 (0 级人生模拟序章与 state.js promote) - 平民 #1623 底板建卡、严格只做 0→1 转职、满级/1级再次 promote 报错拒绝', () => {
  const camp = 'p3-level0-promote';
  cleanCampaign(camp);

  // 1) 0 级建卡：默认采用 #1623 平民底板（level: 0, class: 平民, 1d8 生命骰, HP = max(4, 4 + conMod), AC = 10）
  const st0 = initSession(camp, {
    mode: 'D',
    level: 0,
    name: '阿杰',
    con: 1,
    copper: 85,
    location: '万门外港棚户区'
  });
  assert.equal(st0.character.level, 0);
  assert.equal(st0.character.class, '平民');
  assert.equal(st0.character.hp.max, 5, 'CON +1 的 0 级平民最大 HP 应为 max(4, 4+1) = 5');
  assert.equal(st0.character.hp.current, 5);
  assert.equal(st0.character.ac, 10);
  assert.equal(st0.character.hitDice.die, 'd8', '0 级平民生命骰应为 d8 (#1623)');
  assert.equal(st0.character.hitDice.total, 1);
  assert.equal(st0.inventory.copper, 85);
  assert.equal('gold' in st0.inventory, false);

  // 2) promote (0 → 1)：转职为 1 级战士 (CON +2 -> HP 12, AC 16, 1d10, 自动获得回气)
  const st1 = promoteCharacter(camp, {
    class: '战士',
    con: 2,
    ac: 16
  });
  assert.equal(st1.character.level, 1);
  assert.equal(st1.character.class, '战士');
  assert.equal(st1.character.hp.max, 12);
  assert.equal(st1.character.hp.current, 12);
  assert.equal(st1.character.ac, 16);
  assert.equal(st1.character.hitDice.die, 'd10');
  assert.equal(st1.character.hitDice.total, 1);
  assert.equal(st1.character.hitDice.current, 1);
  assert.ok(st1.character.resources['回气'], '转职 1 级战士应获得回气资源');

  // 3) 已经是 1 级的角色再次调用 promote -> 严格拒绝（只做 0→1）！
  assert.throws(
    () => promoteCharacter(camp, { class: '圣武士' }),
    /仅支持 0 级|0\s*→\s*1|Lv\.1/,
    'promote 必须严格限制只做 0→1，对 1 级及以上角色必须抛错拒绝'
  );
});

test('phase3 (lookup.js lore) - 默认检索公开切片且绝不读取 secret/，显式传 --gm 时才检索 secret/gm-dossier.md', () => {
  // 1) 公开设定检索：国度、奇观、结社、准则
  const aethergard = lookup('lore', '埃瑟加德', { brief: true, json: true });
  assert.equal(aethergard.found, true);
  assert.equal(aethergard.entry.category, 'lore');
  assert.ok(aethergard.entry.file.startsWith('worlds/jianhuo/'));
  assert.equal(aethergard.entry.file.includes('/secret/'), false);
  assert.ok(aethergard.entry.content.includes('埃瑟加德'));

  const guildRules = lookup('lore', '行会四准则', { brief: true, json: true });
  assert.equal(guildRules.found, true);
  assert.ok(guildRules.entry.content.includes('行会四准则'));

  // 2) 默认不带 --gm 查询内档三大劫（冬线南移、渊喉巨脉、苍穹脱缰）：必须返回 found: false，绝不读取 secret/
  for (const secretTerm of ['冬线南移', '渊喉巨脉', '苍穹脱缰']) {
    const pubRes = lookup('lore', secretTerm, { json: true });
    assert.equal(
      pubRes.found,
      false,
      `未加 --gm 时 lookup lore "${secretTerm}" 严禁读取 secret/gm-dossier.md`
    );

    const gmRes = lookup('lore', secretTerm, { gm: true, json: true });
    assert.equal(
      gmRes.found,
      true,
      `显式传入 --gm 时 lookup lore "${secretTerm}" 应命中 secret/gm-dossier.md`
    );
    assert.equal(gmRes.entry.file, 'worlds/jianhuo/secret/gm-dossier.md');
    assert.equal(gmRes.entry.visibility, 'secret');
    assert.ok(gmRes.entry.content.includes(secretTerm));
  }
});

test('phase3 (首屏分流、MODE.md、start-form.md、续局规则与上下文 <= 30KB 字节预算门禁)', (t) => {
  const modePath = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'MODE.md');
  const capsulePath = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'capsule.md');
  const startFormPath = path.join(ROOT_DIR, 'worlds', 'jianhuo', 'start-form.md');
  const sessionZeroPath = path.join(ROOT_DIR, 'references', 'session-zero-interface.md');
  const skillPath = path.join(ROOT_DIR, 'SKILL.md');

  assert.ok(fs.existsSync(modePath), 'worlds/jianhuo/MODE.md 必须存在');
  assert.ok(fs.existsSync(capsulePath), 'worlds/jianhuo/capsule.md 必须存在');
  assert.ok(fs.existsSync(startFormPath), 'worlds/jianhuo/start-form.md 必须存在');

  // 1) MODE.md 行数严格在 80–100 行之间，且第一段是西方奇幻总锚
  const modeText = fs.readFileSync(modePath, 'utf8');
  const modeLines = modeText.trimEnd().split(/\r?\n/);
  assert.ok(
    modeLines.length >= 80 && modeLines.length <= 100,
    `MODE.md 行数必须严格在 80–100 行之间，实际为 ${modeLines.length} 行`
  );
  const firstParagraphLines = modeLines.filter(l => l.trim() && !l.trim().startsWith('#')).slice(0, 3).join('\n');
  assert.ok(
    firstParagraphLines.includes('西方奇幻'),
    `MODE.md 第一段必须为西方奇幻总锚，实际首段: ${firstParagraphLines}`
  );
  assert.ok(modeText.includes('lookup.js lore'), 'MODE.md 必须包含 lookup.js lore 检索规范');
  assert.ok(modeText.includes('promote'), 'MODE.md 必须包含 0 级序章 promote 升 1 级规范');
  assert.ok(modeText.includes('world.js status'), 'MODE.md 必须包含 world.js status 状态同步与续局规范');

  // 2) start-form.md 覆盖世界参数、地区/地点/势力、0级序章/1级开局、★代价与◆限制
  const startFormText = fs.readFileSync(startFormPath, 'utf8');
  for (const kw of ['0 级', '1 级', '★代价', '◆限制', 'world.js init', 'state.js init', '--mode D']) {
    assert.ok(startFormText.includes(kw), `start-form.md 必须包含要素: ${kw}`);
  }

  // 3) 首屏分流与续局规则检查
  const sessionZeroText = fs.readFileSync(sessionZeroPath, 'utf8');
  assert.ok(
    sessionZeroText.includes('路线一') && sessionZeroText.includes('路线二') && sessionZeroText.includes('剑火纪元'),
    'session-zero-interface.md 必须包含首屏双路线分流（路线一经典 / 路线二剑火纪元沙盒，回复 D）'
  );

  const skillText = fs.readFileSync(skillPath, 'utf8');
  assert.ok(
    skillText.includes('路线一') && skillText.includes('路线二') && skillText.includes('start-form.md'),
    'SKILL.md 第 4 节必须同步首屏分流与 start-form.md 指引'
  );
  assert.ok(
    skillText.includes('MODE.md') && skillText.includes('world.js status'),
    'SKILL.md 第 6 节断点续跑必须写明：先读战役元数据，mode: "D" 则加载 MODE.md 并跑 world status'
  );

  // 4) 记录并断言 D 类开局额外读入的 MODE.md + capsule.md + start-form.md 实际字节数 <= 30 KB (30,720 bytes)
  const modeBytes = Buffer.byteLength(modeText, 'utf8');
  const capsuleBytes = Buffer.byteLength(fs.readFileSync(capsulePath, 'utf8'), 'utf8');
  const startFormBytes = Buffer.byteLength(startFormText, 'utf8');
  const totalBytes = modeBytes + capsuleBytes + startFormBytes;

  t.diagnostic(
    `D 类开局额外读入字节统计: MODE.md=${modeBytes}B (${modeLines.length}行) + capsule.md=${capsuleBytes}B + start-form.md=${startFormBytes}B => 合计=${totalBytes}B (${(totalBytes / 1024).toFixed(2)} KB / 上限 30.00 KB)`
  );
  assert.ok(
    totalBytes <= 30 * 1024,
    `MODE.md + capsule.md + start-form.md 总字节数必须 <= 30720 B (30 KB)，实际: ${totalBytes} B`
  );
});

test('phase3 (端到端测试 1：D 类 0 级序章开局 -> lore 检索 -> 掷骰 -> 短休推进时间 -> promote 0→1 -> 铜币记账 -> world status)', () => {
  const camp = 'p3-e2e-d-level0';
  cleanCampaign(camp);

  const runCli = (scriptPath, args) => {
    const res = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: os.tmpdir(),
      env: { ...process.env, DND_SESSIONS_DIR: TEMP_SESSIONS_DIR, DND_RNG_SEED: '2026' },
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, `CLI 失败 (${path.basename(scriptPath)} ${args.join(' ')}):\n${res.stderr}`);
    assert.equal(/\x1b\[[0-9;]*m/.test(res.stdout), false, 'CLI 输出不得含 ANSI 转义码');
    return res.stdout;
  };

  // 1) 初始化 0 级平民角色与剑火世界（铁锚自由同盟与万门海湾）
  runCli(STATE_SCRIPT, [
    'init', camp,
    '--mode', 'D',
    '--level', '0',
    '--name', '林恩',
    '--con', '1',
    '--copper', '120',
    '--location', '万门海湾三号船坞'
  ]);
  runCli(WORLD_SCRIPT, [
    'init', camp,
    '--seed', '20261107',
    '--region', '铁锚自由同盟与万门海湾',
    '--location', '万门海湾三号船坞',
    '--tier', '凡俗',
    '--factions', '铁锚船坞行会,外港私盐帮',
    '--cost', '欠船坞工头 150cp 学徒赎身款',
    '--limit', '5日内须通过工坊学徒考核'
  ]);

  // 2) 检索本地公开设定切片与掷骰检定
  const loreOut = runCli(LOOKUP_SCRIPT, ['lore', '铁锚自由同盟', '--brief']);
  assert.ok(loreOut.includes('铁锚自由同盟'));

  const rollOut = runCli(DICE_SCRIPT, ['1d20+2', '--dc', '12', '--label', '修补魔导绞盘检定']);
  assert.ok(rollOut.includes('1d20+2'));

  // 3) 序章中受伤并执行短休（双文件事务：消耗 1d8 生命骰恢复 + 世界时间推进 1 小时）
  runCli(STATE_SCRIPT, ['update', camp, '--hp', '-2', '--reason', '蒸汽管道烫伤']);
  runCli(STATE_SCRIPT, ['rest', camp, '--short', '--dice', '1', '--heal', '2', '--op-id', 'e2e-l0-short-1']);
  assert.equal(getWorld(camp).calendar.hour, 9, '短休应将世界时间从 08:00 推进至 09:00');

  // 4) 完成序章历练，调用 promote (0 → 1) 转职为 1 级游荡者，并发放学徒津贴 (+80cp)
  const promoteOut = runCli(STATE_SCRIPT, ['promote', camp, '--class', '游荡者', '--con', '2', '--ac', '14']);
  assert.ok(promoteOut.includes('Lv1 游荡者'));
  runCli(STATE_SCRIPT, ['update', camp, '--copper', '+80']);

  const finalState = getState(camp);
  assert.equal(finalState.character.level, 1);
  assert.equal(finalState.character.class, '游荡者');
  assert.equal(finalState.character.hp.max, 10);
  assert.equal(finalState.inventory.copper, 200);
  assert.equal('gold' in finalState.inventory, false);

  const statusOut = runCli(WORLD_SCRIPT, ['status', camp]);
  assert.ok(statusOut.trim().split('\n').length <= 15);
  assert.ok(statusOut.includes('万门海湾三号船坞'));
});

test('phase3 (端到端测试 2：D 类 1 级冒险者开局 + 经典路线一开局双轨对照与续局协议验证)', () => {
  const dCamp = 'p3-e2e-d-level1';
  const classicCamp = 'p3-e2e-classic-route1';
  cleanCampaign(dCamp);
  cleanCampaign(classicCamp);

  const runCli = (scriptPath, args) => {
    const res = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd: os.tmpdir(),
      env: { ...process.env, DND_SESSIONS_DIR: TEMP_SESSIONS_DIR, DND_RNG_SEED: '88' },
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, `CLI 失败 (${path.basename(scriptPath)} ${args.join(' ')}):\n${res.stderr}`);
    assert.equal(/\x1b\[[0-9;]*m/.test(res.stdout), false, 'CLI 输出不得含 ANSI 转义码');
    return res.stdout;
  };

  // A. 路线二（D 类 1 级预设英雄开局 + 自定义/北境地区）：
  runCli(STATE_SCRIPT, ['init', dCamp, '--mode', 'D', '--preset', 'valen,bran', '--copper', '1500', '--location', '拒冬墙三号地堡']);
  runCli(WORLD_SCRIPT, [
    'init', dCamp,
    '--seed', '778899',
    '--region', '北境霜荒',
    '--location', '拒冬墙三号地堡',
    '--tier', '文明',
    '--factions', '黑鸦先锋军,冻原猎团',
    '--cost', '向黑鸦军需官立下军令状借用火钢箭矢',
    '--limit', '暴风雪封山前还有3日补给窗口'
  ]);

  // 传闻打听 + 神谕裁决 + 遭遇战与长休（推进 8h）+ 登记 canon
  runCli(WORLD_SCRIPT, ['rumor', dCamp, '--draw', '--location', '拒冬墙三号地堡']);
  runCli(WORLD_SCRIPT, ['oracle', dCamp, '--question', '冰原斥候是否带回霜狼踪迹？', '--odds', 'likely']);
  runCli(STATE_SCRIPT, ['update', dCamp, '--hp', '-5', '--gold', '-2']); // -2gp 折算扣除 200cp -> 剩 1300cp
  runCli(STATE_SCRIPT, ['rest', dCamp, '--long', '--op-id', 'e2e-l1-long-1']);
  runCli(WORLD_SCRIPT, [
    'canon', dCamp,
    '--add',
    '--id', 'canon:e2e_1',
    '--entity', 'loc:winter_wall_3',
    '--predicate', '守备状态',
    '--value', '击退霜狼先遣群并加固鹿砦'
  ]);

  // 续局检查：先读 state.json 元数据确认 mode === "D"，再跑 world status
  const resumeMeta = JSON.parse(runCli(STATE_SCRIPT, ['show', dCamp, '--json']));
  assert.equal(resumeMeta.meta.mode, 'D');
  assert.equal(resumeMeta.inventory.copper, 1300);
  assert.equal('gold' in resumeMeta.inventory, false);
  const dWorldStatus = runCli(WORLD_SCRIPT, ['status', dCamp]);
  assert.ok(dWorldStatus.includes('拒冬墙三号地堡'));
  assert.equal(getWorld(dCamp).calendar.hour, 16, '长休应将世界时间从 08:00 推进至 16:00');

  // B. 路线一（经典 A/B/C 模式开局）：验证完全不受 D 模式影响，使用 inventory.gold 且无 world.json
  runCli(STATE_SCRIPT, ['init', classicCamp, '--preset', 'valen,bran', '--location', '上厄里村溪口']);
  const modOut = runCli(LOOKUP_SCRIPT, ['module', '秽染溪泉', '--brief']);
  assert.ok(modOut.includes('秽染溪泉'));
  runCli(STATE_SCRIPT, ['update', classicCamp, '--hp', '-4', '--gold', '+10']);
  runCli(STATE_SCRIPT, ['rest', classicCamp, '--long']);

  const classicState = getState(classicCamp);
  assert.equal(classicState.meta, undefined, '经典路线一存档不含 D 模式 meta');
  assert.equal(classicState.inventory.gold, 20);
  assert.equal('copper' in classicState.inventory, false);
  assert.equal(getWorld(classicCamp), null, '经典路线一不创建 world.json');
});
