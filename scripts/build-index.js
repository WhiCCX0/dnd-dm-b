#!/usr/bin/env node

/**
 * D&D 5e 中文全规则库 (不全书 5echm) 深度索引生成器
 *
 * 核心升级特性:
 * 1. 解析 不全书.wcp 获取 8,356 条全库基础词条
 * 2. 深度扫描 2024 玩家手册 391 道法术 (0~9环) 单体精准切片
 * 3. 深度扫描 2024 城主指南 351 件魔法物品单体精准切片
 * 4. 深度提取 2024 状态 (14种)、动作 (12种)、危害 (5种)、其他术语 (108条)
 * 5. 深度提取 2024 武器精通/精通词条 (8大词条双语与多译名映射)
 * 6. 提取 2025 怪物图鉴 600+ 怪物中英文双语对照 (如 地精武者 Goblin Warrior, 巫妖 Lich)
 * 7. 内置高频同义词/别名表 (如 哥布林 <-> 地精, 武器专精 <-> 精通词条, 双持 <-> 双武器战斗)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.resolve(__dirname, '../references/rules_source'),
  path.resolve(__dirname, '../../DND_5e_Rules/rules_source')
];

let rulesRoot = candidates.find(p => fs.existsSync(p));
if (!rulesRoot) {
  console.error('Error: rules_source directory not found in candidates:', candidates);
  process.exit(1);
}

const wcpPath = path.join(rulesRoot, '不全书.wcp');
if (!fs.existsSync(wcpPath)) {
  console.error('Error: 不全书.wcp not found at:', wcpPath);
  process.exit(1);
}

const targetJson = path.resolve(__dirname, '../references/topics_index.json');

console.log(`Starting deep indexing from rules_source: ${rulesRoot}`);
console.time('TotalDeepIndex');

// Helper to decode GBK file
function readGbk(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch (_) {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// 1. Parse WCP
console.log('1/7. Parsing 不全书.wcp baseline topics...');
const wcpBuf = fs.readFileSync(wcpPath);
const wcpText = wcpBuf.toString('utf16le');
const lines = wcpText.split(/\r?\n/);

const items = [];
for (let i = 128; i < lines.length; i++) {
  const line = lines[i];
  if (!line || line.startsWith('[')) break;

  if (line.startsWith('TitleList.Title.')) {
    const idx = parseInt(line.substring(16, line.indexOf('=')), 10);
    const title = line.substring(line.indexOf('=') + 1).trim();
    if (!items[idx]) items[idx] = {};
    items[idx].title = title;
  } else if (line.startsWith('TitleList.Url.')) {
    const idx = parseInt(line.substring(14, line.indexOf('=')), 10);
    const url = line.substring(line.indexOf('=') + 1).trim().replace(/\\/g, '/');
    if (!items[idx]) items[idx] = {};
    items[idx].url = url;
  } else if (line.startsWith('TitleList.Level.')) {
    const idx = parseInt(line.substring(16, line.indexOf('=')), 10);
    const level = parseInt(line.substring(line.indexOf('=') + 1), 10);
    if (!items[idx]) items[idx] = {};
    items[idx].level = level;
  }
}

function getCategory(title, url) {
  const lowUrl = url.toLowerCase();
  const lowTitle = title.toLowerCase();

  if (lowUrl.includes('怪物') || lowUrl.includes('多元宇宙的怪物') || lowUrl.includes('万兽') || lowUrl.includes('生物') || lowUrl.includes('众敌卷册') || lowUrl.includes('瓦罗')) {
    return 'monster';
  }
  if (lowUrl.includes('法术') || lowTitle.includes('法术') || lowUrl.includes('环.htm')) {
    return 'spell';
  }
  if (lowUrl.includes('魔法物品') || lowUrl.includes('宝藏') || lowUrl.includes('装备') || lowUrl.includes('万器') || lowUrl.includes('武器') || lowUrl.includes('护甲')) {
    return 'item';
  }
  if (lowUrl.includes('角色职业') || lowUrl.includes('职业') || lowUrl.includes('子职')) {
    return 'class';
  }
  if (lowUrl.includes('术语汇编') || lowUrl.includes('规则') || lowUrl.includes('进行游戏') || lowUrl.includes('状态') || lowUrl.includes('动作.htm') || lowUrl.includes('危害.htm') || lowUrl.includes('精通词条')) {
    return 'rule';
  }
  if (lowUrl.includes('模组/')) {
    return 'module';
  }
  if (lowUrl.includes('专长')) {
    return 'feat';
  }
  if (lowUrl.includes('角色起源') || lowUrl.includes('种族') || lowUrl.includes('背景')) {
    return 'origin';
  }
  return 'general';
}

const allEntries = [];
let nextId = 1;

for (let i = 0; i < items.length; i++) {
  const it = items[i];
  if (it && it.title) {
    allEntries.push({
      id: nextId++,
      title: it.title,
      titleEn: '',
      aliases: [],
      url: it.url || '',
      anchor: '',
      level: it.level || 0,
      category: getCategory(it.title, it.url || ''),
      edition: it.url && (it.url.includes('2024') || it.url.includes('2025')) ? '2024' : '5e'
    });
  }
}

// 2. Enhance 2025 Monsters with bilingual names
console.log('2/7. Extracting bilingual titles for 2025 Monsters...');
for (const entry of allEntries) {
  if (entry.url && entry.url.includes('怪物图鉴2025') && entry.url.endsWith('.htm')) {
    const full = path.join(rulesRoot, entry.url);
    const html = readGbk(full);
    if (html) {
      // Find header like: <H5>地精武者Goblin Warrior</H5> or <title>地精武者</title> or <h2>地精武者 Goblin Warrior</h2>
      const m = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
      if (m) {
        const rawTitle = m[1].replace(/<[^>]+>/g, '').trim();
        // Check if there is an English name in rawTitle, e.g. "地精武者 Goblin Warrior" or "巫妖 Lich"
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
function scanDirHtml(dir, relPrefix) {
  let files = [];
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
    // Split Chinese and English: e.g. "次元袋 Bag of Holding" or "炼金壶 Alchemy Jug"
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

// 5. Extract 2024 Conditions, Actions, Hazards, Other Terms
console.log('5/7. Extracting 2024 Conditions, Actions, Hazards & Rules...');

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
    const enMatch = raw.match(/^([\u4e00-\u9fa5\·\s\d]+)\s+([A-Za-z\s\-'’]+)$/);
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

// 6. High-Frequency Community Aliases & Module Shortcuts
console.log('6/7. Registering high-frequency aliases & synonyms...');
const aliasEntries = [
  // Monsters
  { title: '哥布林', titleEn: 'Goblin', aliases: ['地精', '哥布林武者', 'Goblin'], url: '怪物图鉴2025/妖精/地精/地精武者.htm', category: 'monster' },
  { title: '地精', titleEn: 'Goblin', aliases: ['哥布林', 'Goblin', '地精武者'], url: '怪物图鉴2025/妖精/地精/地精武者.htm', category: 'monster' },
  { title: '巫妖', titleEn: 'Lich', aliases: ['Lich'], url: '怪物图鉴2025/亡灵/巫妖.htm', category: 'monster' },
  { title: '吸血鬼', titleEn: 'Vampire', aliases: ['Vampire', '施特拉德'], url: '怪物图鉴2025/亡灵/吸血鬼.htm', category: 'monster' },
  { title: '眼魔', titleEn: 'Beholder', aliases: ['Beholder'], url: '怪物图鉴2025/异怪/眼魔.htm', category: 'monster' },
  { title: '夺心魔', titleEn: 'Mind Flayer', aliases: ['Mind Flayer', 'Illithid', '灵能食脑者'], url: '怪物图鉴2025/异怪/夺心魔.htm', category: 'monster' },
  { title: '远古红龙', titleEn: 'Ancient Red Dragon', aliases: ['Red Dragon', '红龙'], url: '怪物图鉴2025/龙/红龙/远古红龙.htm', category: 'monster' },
  { title: '黑蜘蛛', titleEn: 'The Black Spider', aliases: ['那兹纳尔', 'Nezznar'], url: '模组/矿坑/第4章：波浪音洞/黑蜘蛛.htm', category: 'monster' },
  
  // Rules & Actions
  { title: '武器专精', titleEn: 'Weapon Mastery', aliases: ['武器精通', '精通词条'], url: '玩家手册2024/装备/精通词条.htm', category: 'rule' },
  { title: '双持', titleEn: 'Two-Weapon Fighting', aliases: ['双武器战斗', '双持武器', '双武器', 'Two-Weapon Fighting'], url: '玩家手册2024/装备/词条.htm', anchor: '轻型', category: 'rule' },
  { title: '双武器战斗', titleEn: 'Two-Weapon Fighting', aliases: ['双持', '双武器', 'Two-Weapon Fighting'], url: '玩家手册2024/装备/词条.htm', anchor: '轻型', category: 'rule' },
  { title: '突袭', titleEn: 'Surprise', aliases: ['惊奇', '偷袭先攻', 'Surprise'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '突袭', category: 'rule' },
  { title: '掩护', titleEn: 'Cover', aliases: ['掩体', '半身掩护', '四分之三掩护', '全身掩护', 'Cover'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '掩护', category: 'rule' },
  { title: '借机攻击', titleEn: 'Opportunity Attacks', aliases: ['借机', '藉机攻击', 'Opportunity Attack'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '借机攻击', category: 'rule' },
  { title: '专注', titleEn: 'Concentration', aliases: ['维持专注', '专注断裂', 'Concentration'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '专注', category: 'rule' },
  { title: '英雄激励', titleEn: 'Heroic Inspiration', aliases: ['灵感', '英雄灵感', '激励', 'Heroic Inspiration'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '英雄激励', category: 'rule' },
  { title: '徒手打击', titleEn: 'Unarmed Strike', aliases: ['拳击', '徒手', 'Unarmed Strike'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '徒手打击', category: 'rule' },
  { title: '短休', titleEn: 'Short Rest', aliases: ['休息', '短休息'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '短休', category: 'rule' },
  { title: '长休', titleEn: 'Long Rest', aliases: ['长休息'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '长休', category: 'rule' },
  { title: '死亡豁免', titleEn: 'Death Saving Throw', aliases: ['死亡豁免检定', '濒死'], url: '玩家手册2024/术语汇编/其他术语.htm', anchor: '死亡豁免检定', category: 'rule' },

  // Items
  { title: '次元袋', titleEn: 'Bag of Holding', aliases: ['储物袋', 'Bag of Holding'], url: '城主指南2024/7.宝藏/魔法物品详述/奇物/其他物品/非普通.htm', anchor: 'Bag_of_Holding', category: 'item' },
  { title: '治疗药水', titleEn: 'Potion of Healing', aliases: ['红药水', '生命药水', 'Healing Potion'], url: '城主指南2024/7.宝藏/魔法物品详述/药水/药水.htm', anchor: '治疗药水', category: 'item' },

  // Modules
  { title: '凡达林的失落矿坑', titleEn: 'Lost Mine of Phandelver', aliases: ['矿坑', '失落矿坑', 'LMoP'], url: '模组/矿坑/凡达林的失落矿坑.htm', category: 'module' },
  { title: '冰塔峰巨龙', titleEn: 'Dragon of Icespire Peak', aliases: ['冰塔峰', 'DoIP'], url: '模组/冰塔峰/介绍.htm', category: 'module' },
  { title: '施特拉德的诅咒', titleEn: 'Curse of Strahd', aliases: ['施特拉德', '鸦阁', 'CoS', '鸦阁魔域'], url: '模组/施特拉德的诅咒/介绍.htm', category: 'module' },
  { title: '深水城：龙金劫', titleEn: 'Waterdeep: Dragon Heist', aliases: ['龙金劫', '深水城龙金劫', 'WDH'], url: '模组/深水城：龙金劫/深水城：龙金劫.htm', category: 'module' },
  { title: '博德之门：坠入阿弗纳斯', titleEn: 'Baldur\'s Gate: Descent into Avernus', aliases: ['阿弗纳斯', '坠入阿弗纳斯', '博德之门', 'DiA'], url: '模组/坠入阿弗纳斯/博德之门：坠入阿弗纳斯.htm', category: 'module' },
  { title: '深水城：疯法师的地牢', titleEn: 'Waterdeep: Dungeon of the Mad Mage', aliases: ['疯法师', '疯法师地牢', 'DotMM'], url: '模组/深水城：疯法师/深水城：疯法师.htm', category: 'module' },
  { title: '冰风谷：霜霜之女的严寒', titleEn: 'Icewind Dale: Rime of the Frostmaiden', aliases: ['冰风谷', '霜霜之女', 'RotF'], url: '模组/冰风谷/冰风谷：霜霜之女的严寒.htm', category: 'module' },
  { title: '湮灭之墓', titleEn: 'Tomb of Annihilation', aliases: ['太姆', '湮灭', 'ToA'], url: '模组/湮灭之墓/湮灭之墓.htm', category: 'module' }
];

for (const a of aliasEntries) {
  allEntries.push({
    id: nextId++,
    title: a.title,
    titleEn: a.titleEn || '',
    aliases: a.aliases || [],
    url: a.url,
    anchor: a.anchor || a.title,
    level: 1,
    category: a.category,
    edition: '2024'
  });
}

// 7. Write to JSON
console.log('7/7. Writing enriched JSON index to disk...');
fs.writeFileSync(targetJson, JSON.stringify(allEntries, null, 2), 'utf8');
console.timeEnd('TotalDeepIndex');

const sizeKB = (fs.statSync(targetJson).size / 1024).toFixed(1);
console.log(`Successfully compiled ${targetJson}`);
console.log(`Total indexed topics: ${allEntries.length} entries (${sizeKB} KB)`);

