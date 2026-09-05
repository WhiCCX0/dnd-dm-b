# D&D 5e 中文全规则地下城主技能 (B版 / 5echm 不全书版) 🐉

> **全中文、全扩展、集大成版的 D&D 5e (2024/2025 修订版 + 全官方扩展 + 38 部官方模组) 跑团主持技能。**  
> 深度挂载国内最权威的 **《DND 5e 不全书》(5echm)** 规则库（7,067 篇正文文档、8,356 个目录索引），具备 GBK 自动解码与 Markdown 转译、毫秒级词条检索器、跨平台原生骰子引擎、官方经典模组直连与战术战况图生成。

---

## 🌟 B 版核心亮点 (Highlights)

- 📚 **全量中文规则库直通**：
  - 核心三本：**《玩家手册2024》**、**《城主指南2024》**、**《怪物图鉴2025》** 完整正版中文翻译。
  - 官方核心扩展：**《珊娜萨的万事指南》(XGE)**、**《塔莎的万事坩埚》(TCE)**、**《多元宇宙的怪物》(MPMM)**、**《费资本的巨龙宝库》(FTD)**、**《巨人之荣耀》**、**《万象无常书》**。
  - 战役世界设定：剑湾、艾伯伦、拉尼卡、塞洛斯、鸦阁魔域、荒洲、星界、印记城、龙枪等。
- 🏰 **38 部官方经典战役模组调度能力**：
  - 直接支持主持官方模组（如《凡达林的失落矿坑》《冰塔峰巨龙》《施特拉德的诅咒》《深水城：龙金劫》《坠入阿弗纳斯》等），一键调取专属怪物、特殊道具与地图剧情。
- ⚡ **GBK 自动解码与极速检索器 (`scripts/lookup.js`)**：
  - 零内存浪费，5ms 遍历 8,356 个词条，毫秒级抓取任何怪物属性块、法术详述、武器专精、规则状态或魔法物品，自动剔除 HTML 标签转为优雅 Markdown 输出。
- 🎲 **全平台跨平台骰子引擎 (`scripts/roll-dice.js`)**：
  - 原生支持 Windows / macOS / Linux。支持复合伤害与增益算式（如 `1d8+3+2d8`、`1d20+5+1d4`）、优势/劣势 (`--adv`/`--dis`)、暴击所有伤害骰双倍 (`--crit`)、暗骰静默 (`--hidden`)、DC 判定与 4d6 留最高 3 (`4d6kh3`)。
- 💾 **轻量级战役状态持久化引擎 (`scripts/state.js`)**：
  - 零外部 npm 依赖，原生管理玩家 HP（符合 5e 临时生命优先抵扣与浴血状态自动标记规则）、法术位消耗、金币物资与战报日志，支持一键长休/短休恢复并导出紧凑 HUD。
- 🗺️ **战术战况图 (ASCII) 与 2024 专精呈现**：
  - 战斗轮自动输出战区态势图（远距、中距、近身、交战区），紧扣 2024 八大武器专精 (Graze/Sap/Topple/Vex/Nick/Push/Slow/Cleave) 与新版力竭/倒地/突袭规则。
- ⚡ **敌方回合反应主动触发机制 (Reaction Triggers Prompt)**：
  - 敌方移动离开 5 尺、敌方命中或敌方施法时，DM 自动暂停结算并主动征询玩家是否交反应（借机攻击、护盾术、诡诈闪避、法术反制、截击守护）。
- 👥 **单人随从 (Sidekick) 系统**：
  - 为单人玩家配置忠诚性格随从（如猎人布兰、见习牧师米拉），解决动作经济性失衡，提升对话乐趣。

---

## 🚀 极速上手 (Quick Start)

### 1. 开启跑团
在对话中直接对 Antigravity 说：
> **“我想跑团”** 或 **“使用 B版规则开启一场 D&D 冒险”**

DM 将引导你完成开局三部曲：
1. **模式选择**：冒险沉浸模式（默认，隐藏暗骰与怪血）或 规则调试模式（公开所有公式与属性）。
2. **角色选择**：从 6 名预制 2024 英雄卡中挑选（战士、游荡者、法师、牧师、圣武士、诗人），或现场车卡。
3. **剧本选择**：
   - 挑战官方新手战役《凡达林的失落矿坑》或《冰塔峰巨龙》；
   - 体验自创新手模组《低语地窖与暗影牙痕》；
   - 或使用生成器随机生成未知地下城。

### 2. 即时规则检索命令 (`scripts/lookup.js`)

```bash
# 查询 2025/2014 怪物数值 (--brief 极简紧凑数据卡，极省 Token)
node scripts/lookup.js monster "地精武者" --brief
node scripts/lookup.js monster "黑蜘蛛" --brief
node scripts/lookup.js monster "远古红龙"

# 查询 2024 法术详情
node scripts/lookup.js spell "火球术" --brief
node scripts/lookup.js spell "治愈真言"

# 查询 2024 职业核心招牌机制 (0.1ms 直达)
node scripts/lookup.js rule "偷袭" --brief
node scripts/lookup.js rule "动作如潮" --brief
node scripts/lookup.js rule "狂暴" --brief
node scripts/lookup.js rule "灵巧动作" --brief

# 查询 2024 规则与异常状态
node scripts/lookup.js rule "倒地"
node scripts/lookup.js rule "武器专精"
node scripts/lookup.js rule "力竭"

# 查询魔法物品与武器装备
node scripts/lookup.js item "次元袋"
node scripts/lookup.js item "治疗药水"

# 调取 38 部官方战役模组资源
node scripts/lookup.js module "矿坑"
node scripts/lookup.js module "冰塔峰"
```

### 3. 骰子与状态引擎命令

```bash
# 复合算式与暴击翻倍
node scripts/roll-dice.js 1d8+3+2d8 --label "长剑至圣斩"
node scripts/roll-dice.js 1d8+3+2d8 --crit --label "至圣斩暴击！"
node scripts/roll-dice.js 1d20+5+1d4 --dc 15 --label "祝福术加持攻击"

# 优势 / 劣势掷骰
node scripts/roll-dice.js 1d20+3 --adv --label "优势察觉检定"
node scripts/roll-dice.js 1d20+1 --dis --label "重甲劣势隐匿"

# 战役状态持久化
node scripts/state.js init goblin-cave --name "瓦伦" --class "战士" --hp 12 --ac 16
node scripts/state.js update goblin-cave --hp -5 --location "哨塔前哨" # 自动结算临时生命与浴血
node scripts/state.js update goblin-cave --slot 1 -1 --gold +20
node scripts/state.js show goblin-cave --hud
node scripts/state.js rest goblin-cave --long
```

---

## 📂 技能目录架构 (Architecture)

```text
dnd-dm-b/
├── SKILL.md                          # Antigravity B 版核心指令集
├── README.md                         # B 版技能速查手册 (当前文档)
├── dm-guide.md                       # 2024 中文版 DM 执裁与战术全景指南
├── package.json                      # 命令与脚本定义
├── references/
│   ├── rules.db                      # 原生预编译 SQLite 规则库 (9,284 核心条目)
│   ├── rules_source                  # 目录联结 (Directory Junction，零冗余链接 125MB 不全书)
│   └── topics_index.json             # 预编译全书 8,356 条目高速 JSON 索引
├── scripts/
│   ├── lookup.js                     # 核心点查引擎 (毫秒级提取 2024 规则与职业特性)
│   ├── roll-dice.js                  # 跨平台复合骰子引擎 (纯原生 Node.js)
│   ├── state.js                      # 战役状态持久化与实时 HUD 生成器
│   ├── speak-npc.js                  # 跨平台 NPC 语音朗读工具 (含本地 SAPI/say 降级)
│   └── build-index.js                # 规则库索引构建脚本
├── sessions/                         # 战役历史与玩家状态存档目录
├── test/                             # 自动化单元测试套件 (33 项自动化测试全绿)
│   ├── lookup.test.js
│   ├── roll-dice.test.js
│   ├── state.test.js
│   └── speak-npc.test.js
├── resources/
│   ├── starter-adventure/
│   │   ├── official-modules-guide.md # 官方 38 部经典模组 DM 启动指南 (《矿坑》《冰塔峰》等)
│   │   ├── the-whispering-crypt.md   # 精品自创新手模组《低语地窖与暗影牙痕》
│   │   └── adventure-generator.md    # 随机冒险与地下城生成表
│   └── premade-characters/           # 6 套 2024 中文预设英雄卡
└── templates/
    ├── character-sheet.md            # 中文 2024 标准角色卡模板
    ├── combat-tracker.md             # 战术战况与先攻追踪模板
    ├── hud-status-bar.md             # 极简 Markdown 实时状态栏规范
    ├── campaign-log.md               # 战役历史全量日志模板
    └── campaign-summary.md           # 战役状态单页摘要模板
```

---

## ⚖️ 与 A 版 (`dnd-dm`) 的区别与定位

| 特性维度 | 原 A 版 (`dnd-dm`) | 全新 B 版 (`dnd-dm-b`) |
| :--- | :--- | :--- |
| **底层规则书** | 官方英文版 2024 SRD 5.2.1 Markdown | **DND5e 不全书 (7,067 个 GBK HTML 完整中文资源)** |
| **内容范围** | 核心 12 职业、500 法术、400 怪物 | **核心三本 + 全量扩展 (塔莎/珊娜萨/多元宇宙) + 奇械师等** |
| **模组支持** | 仅含自创新手模组与生成器 | **额外自带 38 部官方经典战役模组资源 (矿坑/冰塔峰/施特拉德等)** |
| **语系与排版** | 纯正英文原版 | **地道中文翻译，中英双语索引对照** |
| **两版本关系** | 保持独立，完全未受修改 | **全新技能目录，双版本并存，可按需随意切换** |
