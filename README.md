# D&D 5e 中文全规则地下城主技能 (B版 / 5echm 不全书版) 🐉

> **全中文、全扩展、集大成版的 D&D 5e (2024/2025 修订版 + 全官方扩展 + DMG 2024 五大完整冒险 + 38 部经典模组附录) 跑团主持技能。**  
> 深度挂载国内最权威的 **《DND 5e 不全书》(5echm)** 规则库（8,953 个精准切片与去重索引条目），具备 UTF-8/GBK 智能双模解码与 Markdown 表格转译、毫秒级词条检索器、跨平台原生骰子引擎、多角色小队状态管理器与战术战况图生成。  
> **2.2.0 架构特性**：确立 **三级收敛分层架构**，内嵌 **2024 核心执裁常驻微胶囊**，确立 **真机物理掷骰铁律**，绑定 **Session 0 官方开局接口** 与 **DM 执裁 8 项分级门禁卡**，兼容任意 AI Agent 运行环境。

---

## 🌟 B 版核心亮点 (Highlights)

- 🏛️ **L0/L1/L2 三级收敛分层架构**：
  - **L0 常驻微胶囊**：2024 八大武器精通、六大核心新规、标准 DC 字典 100% 常驻即时视野；
  - **L1 运行工具与切片**：`session-zero-interface.md`（标准开局）、`roll-dice.js`（物理真骰）、`lookup.js --brief`（紧凑数据卡）、`state.js`（小队与战局状态锁）；
  - **L2 深度宝库**：97.1MB SQLite FTS5 全量库（8,953 词条，含 391 道 2024 法术、352 件 2024 魔法物品、74 项 2024 专长、378 项 2024 职业特性独立切片）按需毫秒级点查。
- 🎲 **真机物理掷骰铁律 (`scripts/roll-dice.js`)**：
  - 严禁 AI 凭空捏造掷骰数字。支持 `--attack --ac <N>` 攻击自动判定（自然 20 必中、自然 1 必失手）、复合算式、优劣势、暴击翻倍与 `--hidden` 纯数字暗骰。
- 📜 **Session 0 官方标准开局接口 (`references/session-zero-interface.md`)**：
  - 一键弹出三步极速启动卡（模式 ➔ 6 套 2024 预制卡 + 随从布兰 ➔ 自创/DMG 2024 官方完整冒险/经典战役），支持“① ① ①”或“随机”即刻开跑。
- 📚 **全量中文规则库直通 (`scripts/lookup.js`)**：
  - 核心三本：**《玩家手册2024》**、**《城主指南2024》**、**《怪物图鉴2025》** 完整中文规则与双语标题检索。
  - 官方核心扩展：**《珊娜萨的万事指南》(XGE)**、**《塔莎的万事坩埚》(TCE)**、**《多元宇宙的怪物》(MPMM)**、**《费资本的巨龙宝库》(FTD)**、**《巨人之荣耀》**、**《万象无常书》**。
- 🏰 **DMG 2024 五大官方完整冒险 + 38 部经典战役模组资源**：
  - 内置《城主指南2024》五部官方教学短篇冒险完整正文与独立 DM 速查包（《秽染溪泉》《矿洞惊魂》《有翼之神》《兽之角冠》《北风舞会》）；
  - 支持调取《凡达林的失落矿坑》《冰塔峰巨龙》《施特拉德的诅咒》等 38 部经典战役的专属怪物、魔法物品附录与三幕沙盒大纲。
- 💾 **多角色小队状态持久化、先攻轮转与 HUD 防漂移引擎 (`scripts/state.js`)**：
  - 支持 `--preset valen,bran` 一键加载预设小队、职业充能资源追踪（回气/引导神力等）、法术专注受击 DC 提示、先攻指针推进 (`next`)、带持续轮数的状态自动递减 (`中毒:2`)、战役结构化笔记簿 (`note`)、遭遇难度 XP 计算器 (`encounter-calc`) 与隐藏敌方精确血量的沉浸迷雾模式 (`--veil`)。

---

## 🚀 极速上手 (Quick Start)

### 1. 开启跑团
在对话中直接对你的 AI Agent 说：
> **“我想跑团”** 或 **“开启一场 D&D 冒险”**

DM 将自动调用 `references/session-zero-interface.md` 输出三步启动卡：
1. **模式选择**：🎭 冒险沉浸模式（默认，隐藏暗骰与怪血）、🌱 萌新保姆模式（带随从导师）或 ⚙️ 规则调试模式。
2. **角色选择**：从 6 名预制 2024 英雄卡中挑选（战士、游荡者、法师、牧师、圣武士、诗人），单人自动获赠矮人随从布兰·铁须，或现场车卡。
3. **剧本选择**：
   - 体验自创新手模组《低语地窖与暗影牙痕》（1–2 级五感沉浸）；
   - 体验 DMG 2024 官方完整五部曲冒险（《秽染溪泉》Lv.1 ～ 《北风舞会》Lv.7）；
   - 体验经典战役沙盒（《凡达林的失落矿坑》《冰塔峰巨龙》《施特拉德的诅咒》）或随机生成地下城！

### 2. 即时规则检索命令 (`scripts/lookup.js`)

```bash
# 查询 2025/2014 怪物数值 (--brief 紧凑数据卡，完整呈现 AC/HP/六维/抗性/动作)
node scripts/lookup.js monster "地精武者" --brief
node scripts/lookup.js monster "邪魔邪教徒" --brief
node scripts/lookup.js monster "黑蜘蛛" --brief
node scripts/lookup.js monster "远古红龙"

# 查询 2024 法术详情 (100% 保留伤害/治疗骰值与升环效应)
node scripts/lookup.js spell "火球术" --brief
node scripts/lookup.js spell "恶言相加" --brief
node scripts/lookup.js spell "炼狱叱喝" --brief

# 查询 2024 职业核心特性与专长 (毫秒级直达精确锚点)
node scripts/lookup.js rule "偷袭" --brief
node scripts/lookup.js rule "动作如潮" --brief
node scripts/lookup.js rule "圣疗" --brief
node scripts/lookup.js feat "警戒" --brief

# 查询 2024 规则、武器精通与异常状态
node scripts/lookup.js rule "武器精通" --brief
node scripts/lookup.js rule "Cleave" --brief
node scripts/lookup.js rule "恐慌" --brief
node scripts/lookup.js rule "力竭" --brief

# 查询魔法物品与冒险装备
node scripts/lookup.js item "次元袋" --brief
node scripts/lookup.js item "治疗药水" --brief
node scripts/lookup.js item "鸦族圣徽" --brief

# 调取 DMG 2024 完整冒险与 5e 模组分类索引
node scripts/lookup.js module "秽染溪泉"
node scripts/lookup.js module "矿坑"
node scripts/lookup.js module "施特拉德"
```

### 3. 骰子与战役状态引擎命令 (`scripts/roll-dice.js` & `scripts/state.js`)

```bash
# 攻击检定 (--attack --ac 自动判定 Nat20 必中 / Nat1 必失手) 与复合暴击伤害
node scripts/roll-dice.js 1d20+5 --attack --ac 15 --label "长剑攻击"
node scripts/roll-dice.js 1d8+3+2d8 --crit --label "长剑至圣斩暴击！"
node scripts/roll-dice.js 1d20+3 --adv --dc 15 --label "优势察觉检定"
node scripts/roll-dice.js 1d20+6 --hidden

# 预设小队一键初始化与多角色状态管理 (可通过 DND_SESSIONS_DIR 自定义存档目录)
node scripts/state.js init crypt-run --preset valen,bran --force
node scripts/state.js update crypt-run --hp -4 --reason "狼爪" --use-resource "回气"
node scripts/state.js update crypt-run --who "布兰" --hp -3 --reason "短弓流矢"
node scripts/state.js show crypt-run --hud --veil

# 遭遇战追踪、先攻回合推进、结构化笔记与难度计算
node scripts/state.js mob-add crypt-run --name "骷髅" --hp 13 --ac 14 --count 2 --init 14
node scripts/state.js next crypt-run
node scripts/state.js mob-hit crypt-run --target "骷髅-1" --damage 8
node scripts/state.js note crypt-run --cat clue --add "石棺背面刻有马拉卡尔的血契符文"
node scripts/state.js encounter-calc --party 1,1 --crs 1/4,1/4,1/4
node scripts/state.js rest crypt-run --long
```

---

## 📂 技能目录架构 (Architecture)

```text
dnd-dm-b/
├── SKILL.md                          # 核心指令集 (L0 微胶囊 + 分级 8 项门禁)
├── README.md                         # B 版技能速查手册 (当前文档)
├── dm-guide.md                       # 2024 中文版 DM 执裁与战术全景指南
├── package.json                      # 命令与脚本定义 (零外部依赖)
├── docs/
│   └── adr/
│       └── 001-rpg-experience-and-code-hardening.md # 架构决策记录 (ADR 001)
├── references/
│   ├── rules.db                      # 原生预编译 SQLite FTS5 规则库 (8,953 词条, 97.1MB)
│   ├── session-zero-interface.md     # 官方 Session 0 极速开局三步引导接口
│   └── topics_index.json             # 预编译全书高速双语 JSON 索引 (8,953 条目)
├── scripts/
│   ├── lookup.js                     # 核心点查引擎 (支持双语/别名/职业特性/模组分类)
│   ├── roll-dice.js                  # 跨平台复合骰子引擎 (支持攻击/AC/优劣势/暗骰/批量)
│   ├── state.js                      # 多角色小队状态、先攻轮转、笔记与遭遇计算引擎
│   ├── build-db.js                   # SQLite FTS5 数据库预编译与分类摘要构建器
│   └── build-index.js                # 规则库 HTML/WCP 全量扫描与子章节切片脚本
├── sessions/                         # 战役历史与玩家状态存档目录 (支持 DND_SESSIONS_DIR)
├── test/                             # 自动化单元与集成测试套件 (npm test)
│   ├── lookup.test.js
│   ├── roll-dice.test.js
│   ├── skill-gate.test.js
│   └── state.test.js
├── resources/
│   ├── starter-adventure/
│   │   ├── official-modules-guide.md # DMG 2024 完整冒险与 5e 经典模组 DM 启动指南
│   │   ├── the-whispering-crypt.md   # 自创新手模组《低语地窖与暗影牙痕》
│   │   ├── dmg-1-fouled-stream.md    # DMG 2024 官方教学冒险 1《秽染溪泉》(Lv.1)
│   │   ├── dmg-2-miner-difficulties.md # DMG 2024 官方教学冒险 2《矿洞惊魂》(Lv.2)
│   │   ├── dmg-3-winged-god.md       # DMG 2024 官方教学冒险 3《有翼之神》(Lv.3)
│   │   ├── dmg-4-horns-of-the-beast.md # DMG 2024 官方教学冒险 4《兽之角冠》(Lv.5)
│   │   ├── dmg-5-boreal-ball.md      # DMG 2024 官方教学冒险 5《北风舞会》(Lv.7)
│   │   └── adventure-generator.md    # 随机冒险与地下城生成表
│   └── premade-characters/           # 6 套 2024 中文预设英雄卡 + 随从布兰 + presets.json
└── templates/
    ├── character-sheet.md            # 中文 2024 标准角色卡模板
    ├── combat-tracker.md             # 战术战况与先攻追踪模板
    ├── hud-status-bar.md             # 极简 Markdown 实时状态栏规范
    ├── novice-cheat-sheet.md         # 萌新冒险者一页纸速查卡
    ├── campaign-log.md               # 战役历史全量日志模板
    └── campaign-summary.md           # 战役状态单页摘要模板
```

---

## 📜 开源协议与版权免责声明 (License & Copyright Disclaimer)

- **引擎与工具代码**：本仓库的检索引擎、骰子引擎、状态管理器、测试套件及模板遵循 [MIT License](LICENSE) 开源许可。
- **规则内容与译本归属**：《龙与地下城》(Dungeons & Dragons) 规则、专有名词、怪物、法术与模组版权归 **Wizards of the Coast LLC (威世智)** 所有；中文译本内容整理自国内跑团爱好者社区维护的 **《DND 5e 不全书》(5echm)**。
- **非商业个人学习用途**：预编译规则库 (`references/rules.db`) 仅供个人规则研究、学习与非商业 TRPG 跑团辅助使用，严禁用于任何商业用途。
