#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) 深度索引生成器
 *
 * 核心升级特性:
 * 1. 动态解析 不全书.wcp 获取全库有效基础词条 (过滤空白目录节点)
 * 2. 深度扫描 2024 玩家手册 391 道法术 (0~9环) 单体精准切片
 * 3. 深度扫描 2024 城主指南 351 件魔法物品单体精准切片
 * 4. 深度提取 2024 状态、动作、危害、其他术语及 18 项技能速查
 * 5. 深度提取 2024 武器精通/精通词条 (8大词条双语与多译名映射)
 * 6. 提取 2025 怪物图鉴 600+ 怪物中英文双语对照 (如 地精武者 Goblin Warrior, 巫妖 Lich)
 * 7. 内置高频同义词/别名表，按实际源文件精准标注 2024 与 5e 版本
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function parseWcpContent(wcpText) {
  const lines = String(wcpText).split(/\r?\n/);
  const items = [];
  const lineRegex = /^TitleList\.(Title|Url|Level)\.(\d+)=(.*)$/;

  for (const line of lines) {
    const match = line.match(lineRegex);
    if (!match) continue;
    const [, field, idxStr, rawVal] = match;
    const idx = parseInt(idxStr, 10);
    if (!items[idx]) items[idx] = {};

    if (field === 'Title') {
      items[idx].title = rawVal.trim();
    } else if (field === 'Url') {
      items[idx].url = rawVal.trim().replace(/\\/g, '/');
    } else if (field === 'Level') {
      items[idx].level = parseInt(rawVal.trim(), 10) || 0;
    }
  }

  return items.filter(Boolean);
}

export function getCategory(title = '', url = '') {
  const lowUrl = String(url).toLowerCase().replace(/\\/g, '/');
  const lowTitle = String(title).toLowerCase();

  if (!lowUrl) return 'general';

  // 1. Spells (法术)
  if (
    lowUrl.includes('/法术') ||
    lowUrl.includes('法术详述') ||
    lowUrl.includes('法术速查') ||
    lowUrl.includes('环.htm')
  ) {
    return 'spell';
  }

  // 2. Feats (专长)
  if (
    lowUrl.includes('/专长') ||
    lowUrl.includes('专长.htm') ||
    lowUrl.includes('新专长')
  ) {
    return 'feat';
  }

  // 3. Origins, Species/Races, Backgrounds (起源/种族/背景 — 必须在怪物书名匹配前判定)
  if (
    lowUrl.includes('角色起源') ||
    lowUrl.includes('/种族') ||
    lowUrl.includes('新种族') ||
    lowUrl.includes('玩家可用种族') ||
    lowUrl.includes('/背景') ||
    lowUrl.includes('新背景') ||
    lowUrl.includes('个性与背景')
  ) {
    return 'origin';
  }

  // 4. Classes & Subclasses (职业与子职 — 必须在 "怪物" 关键词前判定，避免游侠"怪物杀手"误判)
  if (
    lowUrl.includes('角色职业') ||
    lowUrl.includes('/职业') ||
    lowUrl.includes('子职') ||
    lowUrl.includes('角色选项/') ||
    lowUrl.includes('玩家选项/') ||
    lowUrl.includes('/奇械师') ||
    lowUrl.includes('/血猎手') ||
    lowUrl.includes('/拳斗士') ||
    lowUrl.includes('/铳士') ||
    lowUrl.includes('/邪狱使')
  ) {
    return 'class';
  }

  // 5. Weapon Mastery & Weapon Properties rules (武器精通与词条归入规则)
  if (lowUrl.includes('精通词条') || lowUrl.endsWith('装备/词条.htm')) {
    return 'rule';
  }

  // 6. Items, Magic Items, Equipment, Tools (物品与装备工具)
  if (
    lowUrl.includes('魔法物品') ||
    lowUrl.includes('宝藏') ||
    lowUrl.includes('/装备') ||
    lowUrl.includes('万器') ||
    lowUrl.includes('/武器') ||
    lowUrl.includes('/护甲') ||
    lowUrl.includes('/工具') ||
    lowUrl.includes('鞍中珍宝') ||
    lowUrl.includes('奇械锻炉/第五章')
  ) {
    return 'item';
  }

  // 7. Conditions (状态)
  if (lowUrl.includes('状态.htm')) {
    return 'condition';
  }

  // 8. Core Rules, Actions, Hazards, DM Running the Game (核心规则与运作游戏)
  if (
    lowUrl.includes('术语汇编') ||
    lowUrl.includes('规则') ||
    lowUrl.includes('进行游戏') ||
    lowUrl.includes('运作游戏') ||
    lowUrl.includes('地下城主工具') ||
    lowUrl.includes('城主工具') ||
    lowUrl.includes('1.基础/') ||
    lowUrl.includes('动作.htm') ||
    lowUrl.includes('危害.htm') ||
    lowUrl.includes('属性值应用') ||
    lowUrl.includes('冒险之主') ||
    lowUrl.includes('世界之主') ||
    lowUrl.includes('创建冒险') ||
    lowUrl.includes('创作战役') ||
    lowUrl.includes('据点') ||
    lowUrl.includes('宇宙学') ||
    lowUrl.includes('贤者谏言') ||
    lowUrl.includes('创建角色') ||
    lowUrl.includes('创立角色') ||
    lowUrl.includes('角色创建') ||
    lowUrl.includes('/魔法/') ||
    lowUrl.endsWith('/魔法.htm')
  ) {
    return 'rule';
  }

  // 9. Monsters & Statblocks (怪物与生物图鉴)
  if (
    lowUrl.startsWith('怪物图鉴') ||
    lowUrl.includes('/图鉴/') ||
    lowUrl.includes('/生物图鉴/') ||
    lowUrl.includes('/怪物图鉴/') ||
    lowUrl.includes('/荒洲生物图集/') ||
    lowUrl.includes('/怪物/') ||
    lowUrl.includes('/鸦阁怪物') ||
    lowUrl.includes('/德城怪物') ||
    lowUrl.includes('/怪物纲要') ||
    lowUrl.includes('/邪物卷册') ||
    lowUrl.includes('星界怪兽展') ||
    lowUrl.includes('/生物/') ||
    lowUrl.includes('/数据卡/') ||
    lowUrl.includes('/非玩家角色/') ||
    lowUrl.includes('/盟友与敌人/') ||
    lowUrl.includes('/怪物学识/')
  ) {
    return 'monster';
  }

  // 10. Official Modules (官方模组)
  if (lowUrl.startsWith('模组/')) {
    return 'module';
  }

  if (lowTitle.includes('法术')) return 'spell';
  return 'general';
}

function readGbk(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return null;
  const buf = fs.readFileSync(filePath);
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn(`[Encoding Warning] GBK decode failed for ${filePath}, falling back to UTF-8:`, err.message);
    }
    return new TextDecoder('utf-8').decode(buf);
  }
}

function scanDirHtml(dir, relPrefix) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.join(relPrefix, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) {
      files = files.concat(scanDirHtml(full, rel));
    } else if (e.name.endsWith('.htm') || e.name.endsWith('.html')) {
      files.push({ full, rel });
    }
  }
  return files;
}

function inferEdition(url, explicitEdition) {
  if (explicitEdition) return explicitEdition;
  if (url && (url.includes('2024') || url.includes('2025'))) return '2024';
  return '5e';
}

function main() {
  const candidates = [
    process.env.RULES_SOURCE_DIR,
    path.resolve(__dirname, '../references/rules_source'),
    path.resolve(__dirname, '../../DND_5e_Rules/rules_source')
  ].filter(Boolean);

  const rulesRoot = candidates.find(p => fs.existsSync(p));
  const targetJson = path.resolve(__dirname, '../references/topics_index.json');
  const isForce = process.argv.includes('--force') || process.argv.includes('-f');

  if (!rulesRoot) {
    if (fs.existsSync(targetJson)) {
      const stat = fs.statSync(targetJson);
      console.log(`\x1b[33m🛡️ [Index 构建保护锁]\x1b[0m 未检测到 rules_source 原始 HTML 目录。`);
      console.log(`现有的预编译索引 \x1b[32m${targetJson}\x1b[0m (${(stat.size / (1024 * 1024)).toFixed(1)} MB) 完好无损，已受写保护。`);
      console.log(`如需重新从 HTML 构建，请挂载 rules_source 目录并使用 --force 运行。`);
      process.exit(0);
    } else {
      console.error('\x1b[31mError: rules_source directory not found in candidates:\x1b[0m', candidates);
      process.exit(1);
    }
  }

  if (fs.existsSync(targetJson) && !isForce) {
    console.log(`\x1b[33m[Index Warning]\x1b[0m ${targetJson} 已存在。若需全量覆盖重建，请添加 --force 参数。`);
    process.exit(0);
  }

  const wcpPath = path.join(rulesRoot, '不全书.wcp');
  if (!fs.existsSync(wcpPath)) {
    console.error('Error: 不全书.wcp not found at:', wcpPath);
    process.exit(1);
  }

  console.log(`Starting deep indexing from rules_source: ${rulesRoot}`);
  console.time('TotalDeepIndex');

  // 1. Parse WCP dynamically (without magic line numbers)
  console.log('1/7. Parsing 不全书.wcp baseline topics...');
  const wcpBuf = fs.readFileSync(wcpPath);
  const wcpText = wcpBuf.toString('utf16le');
  const items = parseWcpContent(wcpText);

  const allEntries = [];
  let nextId = 1;

  for (const it of items) {
    if (!it || !it.title || !it.url) continue;
    if (it.url === '分隔符.htm' || it.url.startsWith('空白页模板')) continue;
    const fullPath = path.join(rulesRoot, it.url);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;

    allEntries.push({
      id: nextId++,
      title: it.title,
      titleEn: '',
      aliases: [],
      url: it.url,
      anchor: '',
      level: it.level || 0,
      category: getCategory(it.title, it.url),
      edition: inferEdition(it.url)
    });
  }

  // 2. Enhance 2025 Monsters with bilingual names
  console.log('2/7. Extracting bilingual titles for 2025 Monsters...');
  for (const entry of allEntries) {
    if (entry.url && entry.url.includes('怪物图鉴2025') && entry.url.endsWith('.htm')) {
      const full = path.join(rulesRoot, entry.url);
      const html = readGbk(full);
      if (html) {
        const m = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        if (m) {
          const rawTitle = m[1].replace(/<[^>]+>/g, '').trim();
          const enMatch = rawTitle.match(/^([\u4e00-\u9fa5\·\s]+)\s+([A-Za-z\s\-'’]+)$/);
          if (enMatch) {
            entry.title = enMatch[1].trim();
            entry.titleEn = enMatch[2].trim();
          }
        }
      }
    }
  }

  // 3. Extract 2024 Spells from 0环.htm to 9环.htm
  console.log('3/7. Extracting 2024 PHB Spells (0~9环)...');
  for (let r = 0; r <= 9; r++) {
    const rel = `玩家手册2024/法术详述/${r}环.htm`;
    const full = path.join(rulesRoot, rel);
    const html = readGbk(full);
    if (html) {
      const spellRegex = /<h4[^>]*>([^｜|<]+)｜([^<]+)<\/h4>/gi;
      let match;
      while ((match = spellRegex.exec(html)) !== null) {
        const zh = match[1].trim();
        const en = match[2].trim();
        allEntries.push({
          id: nextId++,
          title: zh,
          titleEn: en,
          aliases: [en],
          url: rel,
          anchor: zh,
          level: 4,
          category: 'spell',
          edition: '2024'
        });
      }
    }
  }

  // 4. Extract 2024 Magic Items from DMG 2024
  console.log('4/7. Extracting 2024 DMG Magic Items...');
  const dmgItemFiles = scanDirHtml(
    path.join(rulesRoot, '城主指南2024/7.宝藏/魔法物品详述'),
    '城主指南2024/7.宝藏/魔法物品详述'
  );

  for (const { full, rel } of dmgItemFiles) {
    const html = readGbk(full);
    if (!html) continue;

    const h6Regex = /<h6(?:\s+id="([^"]*)")?[^>]*>([\s\S]*?)<\/h6>/gi;
    let match;
    while ((match = h6Regex.exec(html)) !== null) {
      const anchorId = match[1] || '';
      const rawText = match[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
      const enMatch = rawText.match(/^([\u4e00-\u9fa5\·\s]+)\s+([A-Za-z\s\-'’]+)$/);
      let zh = rawText;
      let en = '';
      if (enMatch) {
        zh = enMatch[1].trim();
        en = enMatch[2].trim();
      }
      allEntries.push({
        id: nextId++,
        title: zh,
        titleEn: en,
        aliases: en ? [en] : [],
        url: rel,
        anchor: anchorId || zh,
        level: 4,
        category: 'item',
        edition: '2024'
      });
    }
  }

  // 5. Extract 2024 Conditions, Actions, Hazards, Other Terms, Skills, Tools
  console.log('5/7. Extracting 2024 Conditions, Actions, Hazards, Skills & Rules...');

  // 5.1 Conditions
  const condHtml = readGbk(path.join(rulesRoot, '玩家手册2024/术语汇编/状态.htm'));
  if (condHtml) {
    const condRegex = /<h3[^>]*>([^【|\s]+)\s+([A-Za-z]+)【状态】<\/h3>/gi;
    let m;
    while ((m = condRegex.exec(condHtml)) !== null) {
      const zh = m[1].trim();
      const en = m[2].trim();
      allEntries.push({
        id: nextId++,
        title: zh,
        titleEn: en,
        aliases: [en],
        url: '玩家手册2024/术语汇编/状态.htm',
        anchor: zh,
        level: 3,
        category: 'condition',
        edition: '2024'
      });
    }
  }

  // 5.2 Actions
  const actionHtml = readGbk(path.join(rulesRoot, '玩家手册2024/术语汇编/动作.htm'));
  if (actionHtml) {
    const actRegex = /<h3[^>]*>([^【|\s]+)\s+([A-Za-z]+)【动作】<\/h3>/gi;
    let m;
    while ((m = actRegex.exec(actionHtml)) !== null) {
      const zh = m[1].trim();
      const en = m[2].trim();
      allEntries.push({
        id: nextId++,
        title: zh,
        titleEn: en,
        aliases: [en, `${zh}动作`],
        url: '玩家手册2024/术语汇编/动作.htm',
        anchor: zh,
        level: 3,
        category: 'rule',
        edition: '2024'
      });
    }
  }

  // 5.3 Hazards
  const hazardHtml = readGbk(path.join(rulesRoot, '玩家手册2024/术语汇编/危害.htm'));
  if (hazardHtml) {
    const hazRegex = /<h3[^>]*>([^【|\s]+)\s+([A-Za-z]+)【危害】<\/h3>/gi;
    let m;
    while ((m = hazRegex.exec(hazardHtml)) !== null) {
      const zh = m[1].trim();
      const en = m[2].trim();
      allEntries.push({
        id: nextId++,
        title: zh,
        titleEn: en,
        aliases: [en],
        url: '玩家手册2024/术语汇编/危害.htm',
        anchor: zh,
        level: 3,
        category: 'rule',
        edition: '2024'
      });
    }
  }

  // 5.4 Other Terms in PHB 2024
  const termsHtml = readGbk(path.join(rulesRoot, '玩家手册2024/术语汇编/其他术语.htm'));
  if (termsHtml) {
    const termRegex = /<h3(?:\s+id="([^"]*)")?[^>]*>([\s\S]*?)<\/h3>/gi;
    let m;
    while ((m = termRegex.exec(termsHtml)) !== null) {
      const anchorId = m[1] || '';
      const raw = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
      const enMatch = raw.match(/^([\u4e00-\u9fa5\·\s\dA-Za-z]+?)\s+([A-Za-z0-9\s\-'’]+)$/);
      if (enMatch) {
        const zh = enMatch[1].trim();
        const en = enMatch[2].trim();
        allEntries.push({
          id: nextId++,
          title: zh,
          titleEn: en,
          aliases: [en],
          url: '玩家手册2024/术语汇编/其他术语.htm',
          anchor: anchorId || zh,
          level: 3,
          category: 'rule',
          edition: '2024'
        });
      }
    }
  }

  // 5.5 2024 Weapon Masteries (精通词条)
  const masteries = [
    { zh: '横扫', en: 'Cleave', aliases: ['顺劈', 'Cleave', '横扫'], anchor: '横扫' },
    { zh: '擦掠', en: 'Graze', aliases: ['擦伤', 'Graze', '擦掠'], anchor: '擦掠' },
    { zh: '迅击', en: 'Nick', aliases: ['迅捷', 'Nick', '迅击'], anchor: '迅击' },
    { zh: '推离', en: 'Push', aliases: ['推撞', 'Push', '推离'], anchor: '推离' },
    { zh: '削弱', en: 'Sap', aliases: ['削弱', 'Sap'], anchor: '削弱' },
    { zh: '缓速', en: 'Slow', aliases: ['减速', 'Slow', '缓速'], anchor: '缓速' },
    { zh: '失衡', en: 'Topple', aliases: ['击倒', 'Topple', '失衡'], anchor: '失衡' },
    { zh: '侵扰', en: 'Vex', aliases: ['扰乱', 'Vex', '侵扰'], anchor: '侵扰' },
    { zh: '武器精通', en: 'Weapon Mastery', aliases: ['武器专精', '精通词条', 'Weapon Mastery', '专精词条'], anchor: '精通词条' }
  ];

  masteries.forEach(m => {
    allEntries.push({
      id: nextId++,
      title: m.zh,
      titleEn: m.en,
      aliases: m.aliases,
      url: '玩家手册2024/装备/精通词条.htm',
      anchor: m.anchor,
      level: 3,
      category: 'rule',
      edition: '2024'
    });
  });

  // 5.6 2024 Weapon Properties (武器基础词条)
  const weaponProps = [
    { zh: '轻型', en: 'Light', aliases: ['双持', '双武器战斗', 'Light', '轻型武器'], anchor: '轻型' },
    { zh: '灵巧', en: 'Finesse', aliases: ['敏捷武器', 'Finesse', '灵巧武器'], anchor: '灵巧' },
    { zh: '重型', en: 'Heavy', aliases: ['双手巨刃', 'Heavy', '重型武器'], anchor: '重型' },
    { zh: '两用', en: 'Versatile', aliases: ['双用', 'Versatile', '两用武器'], anchor: '两用' },
    { zh: '触及', en: 'Reach', aliases: ['长柄', '长触及', 'Reach', '触及武器'], anchor: '触及' },
    { zh: '投掷', en: 'Thrown', aliases: ['投掷武器', 'Thrown'], anchor: '投掷' },
    { zh: '弹药', en: 'Ammunition', aliases: ['弹药', 'Ammunition'], anchor: '弹药' },
    { zh: '装填', en: 'Loading', aliases: ['装填', 'Loading'], anchor: '装填' },
    { zh: '双手', en: 'Two-Handed', aliases: ['双手武器', 'Two-Handed'], anchor: '双手' }
  ];

  weaponProps.forEach(p => {
    allEntries.push({
      id: nextId++,
      title: p.zh,
      titleEn: p.en,
      aliases: p.aliases,
      url: '玩家手册2024/装备/词条.htm',
      anchor: p.anchor,
      level: 3,
      category: 'rule',
      edition: '2024'
    });
  });

  // 5.7 2024 Core 18 Skills (18项技能规则直达)
  const skills2024 = [
    { zh: '特技', en: 'Acrobatics', aliases: ['体操', '翻滚', 'Acrobatics'] },
    { zh: '驯兽', en: 'Animal Handling', aliases: ['动物驯养', 'Animal Handling'] },
    { zh: '奥秘', en: 'Arcana', aliases: ['Arcana'] },
    { zh: '运动', en: 'Athletics', aliases: ['Athletics', '攀爬', '游泳'] },
    { zh: '欺瞒', en: 'Deception', aliases: ['说谎', '骗人', 'Deception'] },
    { zh: '历史', en: 'History', aliases: ['History'] },
    { zh: '洞悉', en: 'Insight', aliases: ['察言观色', '辨谎', '测谎', 'Insight'] },
    { zh: '威吓', en: 'Intimidation', aliases: ['恐吓', 'Intimidation'] },
    { zh: '调查', en: 'Investigation', aliases: ['Investigation'] },
    { zh: '医药', en: 'Medicine', aliases: ['急救', '包扎', '验尸', 'Medicine'] },
    { zh: '自然', en: 'Nature', aliases: ['Nature'] },
    { zh: '察觉', en: 'Perception', aliases: ['侦察', '感知检定', 'Perception'] },
    { zh: '表演', en: 'Performance', aliases: ['Performance'] },
    { zh: '游说', en: 'Persuasion', aliases: ['说服', '交涉', '嘴炮', 'Persuasion'] },
    { zh: '说服', en: 'Persuasion', aliases: ['游说', '交涉', '嘴炮', 'Persuasion'] },
    { zh: '宗教', en: 'Religion', aliases: ['Religion'] },
    { zh: '巧手', en: 'Sleight of Hand', aliases: ['扒窃', 'Sleight of Hand'] },
    { zh: '隐匿', en: 'Stealth', aliases: ['Stealth'] },
    { zh: '求生', en: 'Survival', aliases: ['生存', '追踪', 'Survival'] },
    { zh: '生存', en: 'Survival', aliases: ['求生', '追踪', 'Survival'] }
  ];

  skills2024.forEach(s => {
    allEntries.push({
      id: nextId++,
      title: s.zh,
      titleEn: s.en,
      aliases: s.aliases,
      url: '玩家手册2024/进行游戏/熟练.htm',
      anchor: '技能熟练',
      level: 3,
      category: 'rule',
      edition: '2024'
    });
  });

  // 6. High-Frequency Community Aliases & Module Shortcuts (Verified Real URLs & Accurate Editions)
  console.log('6/7. Registering high-frequency aliases & synonyms...');
  const aliasEntries = [
    // Monsters (2024/2025 & 5e Module Bosses)
    { title: '哥布林', titleEn: 'Goblin', aliases: ['地精', '哥布林武者', 'Goblin'], url: '怪物图鉴2025/妖精/地精/地精武者.htm', category: 'monster', edition: '2024' },
    { title: '地精', titleEn: 'Goblin', aliases: ['哥布林', 'Goblin', '地精武者'], url: '怪物图鉴2025/妖精/地精/地精武者.htm', category: 'monster', edition: '2024' },
    { title: '巫妖', titleEn: 'Lich', aliases: ['Lich'], url: '怪物图鉴2025/亡灵/巫妖.htm', category: 'monster', edition: '2024' },
    { title: '吸血鬼', titleEn: 'Vampire', aliases: ['Vampire', '施特拉德'], url: '怪物图鉴2025/多类型/吸血鬼/吸血鬼.htm', category: 'monster', edition: '2024' },
    { title: '眼魔', titleEn: 'Beholder', aliases: ['Beholder', '大眼怪'], url: '怪物图鉴2025/多类型/眼魔/眼魔.htm', category: 'monster', edition: '2024' },
    { title: '夺心魔', titleEn: 'Mind Flayer', aliases: ['Mind Flayer', 'Illithid', '灵能食脑者', '章鱼头'], url: '怪物图鉴2025/异怪/夺心魔/夺心魔.htm', category: 'monster', edition: '2024' },
    { title: '远古红龙', titleEn: 'Ancient Red Dragon', aliases: ['Red Dragon', '红龙'], url: '怪物图鉴2025/龙类/红龙/远古红龙.htm', category: 'monster', edition: '2024' },
    { title: '黑蜘蛛', titleEn: 'The Black Spider', aliases: ['那兹纳尔', 'Nezznar', '“黑蜘蛛”那兹纳尔'], url: '模组/矿坑/图鉴/黑蜘蛛.htm', category: 'monster', edition: '5e' },

    // Rules & Actions (2024)
    { title: '武器专精', titleEn: 'Weapon Mastery', aliases: ['武器精通', '精通词条'], url: '玩家手册2024/装备/精通词条.htm', anchor: '精通词条', category: 'rule', edition: '2024' },
    { title: '双持', titleEn: 'Two-Weapon Fighting', aliases: ['双武器战斗', '双持武器', '双武器', 'Two-Weapon Fighting'], url: '玩家手册2024/装备/词条.htm', anchor: '轻型', category: 'rule', edition: '2024' },
    { title: '双武器战斗', titleEn: 'Two-Weapon Fighting', aliases: ['双持', '双武器', 'Two-Weapon Fighting'], url: '玩家手册2024/装备/词条.htm', anchor: '轻型', category: 'rule', edition: '2024' },
    { title: '突袭', titleEn: 'Surprise', aliases: ['惊奇', '偷袭先攻', 'Surprise'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '突袭', category: 'rule', edition: '2024' },
    { title: '掩护', titleEn: 'Cover', aliases: ['掩体', '半身掩护', '四分之三掩护', '全身掩护', 'Cover'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '掩护', category: 'rule', edition: '2024' },
    { title: '借机攻击', titleEn: 'Opportunity Attacks', aliases: ['借机', '藉机攻击', 'Opportunity Attack'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '借机攻击', category: 'rule', edition: '2024' },
    { title: '专注', titleEn: 'Concentration', aliases: ['维持专注', '专注断裂', 'Concentration'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '专注', category: 'rule', edition: '2024' },
    { title: '英雄激励', titleEn: 'Heroic Inspiration', aliases: ['灵感', '英雄灵感', '激励', '鼓舞', 'Heroic Inspiration'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '英雄激励', category: 'rule', edition: '2024' },
    { title: '徒手打击', titleEn: 'Unarmed Strike', aliases: ['拳击', '徒手', 'Unarmed Strike'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '徒手打击', category: 'rule', edition: '2024' },
    { title: '短休', titleEn: 'Short Rest', aliases: ['休息', '短休息'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '短休', category: 'rule', edition: '2024' },
    { title: '长休', titleEn: 'Long Rest', aliases: ['长休息'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '长休', category: 'rule', edition: '2024' },
    { title: '死亡豁免', titleEn: 'Death Saving Throw', aliases: ['死亡豁免检定', '濒死', '生死豁免'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '死亡豁免检定', category: 'rule', edition: '2024' },

    // Items & Tools (2024)
    { title: '盗贼工具', titleEn: "Thieves' Tools", aliases: ['开锁', '撬锁工具', '拆陷阱', "Thieves' Tools"], url: '玩家手册2024/装备/其他工具.htm', anchor: '盗贼工具', category: 'item', edition: '2024' },
    { title: '次元袋', titleEn: 'Bag of Holding', aliases: ['储物袋', '空间袋', 'Bag of Holding'], url: '城主指南2024/7.宝藏/魔法物品详述/奇物/其他物品/非普通.htm', anchor: 'Bag_of_Holding', category: 'item', edition: '2024' },
    { title: '治疗药水', titleEn: 'Potion of Healing', aliases: ['红药水', '血瓶', '生命药水', 'Healing Potion', 'Potions of Healing'], url: '城主指南2024/7.宝藏/魔法物品详述/药水/多种稀有度.htm', anchor: '治疗药水', category: 'item', edition: '2024' },
    { title: '高等治疗药水', titleEn: 'Potion of Greater Healing', aliases: ['高级治疗药水', '大红', '治疗药水（高等）', 'Greater Healing Potion'], url: '城主指南2024/7.宝藏/魔法物品详述/药水/多种稀有度.htm', anchor: '治疗药水', category: 'item', edition: '2024' },

    // Official Modules (5e)
    { title: '凡达林的失落矿坑', titleEn: 'Lost Mine of Phandelver', aliases: ['矿坑', '失落矿坑', 'LMoP'], url: '模组/矿坑/魔法物品.htm', category: 'module', edition: '5e' },
    { title: '冰塔峰巨龙', titleEn: 'Dragon of Icespire Peak', aliases: ['冰塔峰', 'DoIP'], url: '模组/冰塔峰/协力者.html', category: 'module', edition: '5e' },
    { title: '施特拉德的诅咒', titleEn: 'Curse of Strahd', aliases: ['施特拉德', '鸦阁', 'CoS', '鸦阁魔域'], url: '模组/施特拉德的诅咒/施特拉德手记.htm', category: 'module', edition: '5e' },
    { title: '深水城：龙金劫', titleEn: 'Waterdeep: Dragon Heist', aliases: ['龙金劫', '深水城龙金劫', 'WDH'], url: '模组/深水城：龙金劫/怪物和NPC们.htm', category: 'module', edition: '5e' },
    { title: '博德之门：坠入阿弗纳斯', titleEn: "Baldur's Gate: Descent into Avernus", aliases: ['阿弗纳斯', '坠入阿弗纳斯', '博德之门', 'DiA'], url: '模组/坠入阿弗纳斯/邪恶交易/邪恶交易.htm', category: 'module', edition: '5e' },
    { title: '深水城：疯法师的地牢', titleEn: 'Waterdeep: Dungeon of the Mad Mage', aliases: ['疯法师', '疯法师地牢', 'DotMM'], url: '模组/深水城：疯法师/生物/疯法师_海拉斯特黑袍.htm', category: 'module', edition: '5e' },
    { title: '冰风谷：霜脉之女的严寒', titleEn: 'Icewind Dale: Rime of the Frostmaiden', aliases: ['冰风谷', '霜霜之女', '冰风谷：霜霜之女的严寒', 'RotF'], url: '模组/冰风谷/角色秘密.htm', category: 'module', edition: '5e' },
    { title: '湮灭之墓', titleEn: 'Tomb of Annihilation', aliases: ['太姆', '湮灭', 'ToA'], url: '模组/湮灭之墓/人类学家.htm', category: 'module', edition: '5e' }
  ];

  for (const a of aliasEntries) {
    const full = path.join(rulesRoot, a.url);
    if (!fs.existsSync(full)) {
      throw new Error(`Alias entry "${a.title}" references missing file: ${a.url}`);
    }
    allEntries.push({
      id: nextId++,
      title: a.title,
      titleEn: a.titleEn || '',
      aliases: a.aliases || [],
      url: a.url,
      anchor: a.anchor || a.title,
      level: 1,
      category: a.category,
      edition: inferEdition(a.url, a.edition)
    });
  }

  // 7. Write atomically to JSON
  console.log('7/7. Writing enriched JSON index to disk...');
  const tmpJson = `${targetJson}.${process.pid}.tmp`;
  fs.writeFileSync(tmpJson, JSON.stringify(allEntries, null, 2), 'utf8');
  fs.renameSync(tmpJson, targetJson);
  console.timeEnd('TotalDeepIndex');

  const sizeKB = (fs.statSync(targetJson).size / 1024).toFixed(1);
  console.log(`Successfully compiled ${targetJson}`);
  console.log(`Total indexed topics: ${allEntries.length} entries (${sizeKB} KB)`);
}

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'build-index.js')
);

if (isMain) {
  main();
}
