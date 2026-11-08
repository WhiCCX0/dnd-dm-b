# D&D 5e 中文全规则地下城主技能 (B版 / 5echm 不全书版) 🐉

> **全中文、全扩展、集大成版的 D&D 5e (2024/2025 修订版 + 全官方扩展 + DMG 2024 五大完整冒险 + 38 部经典模组附录) 跑团主持技能。**  
> 深度挂载国内最权威的 **《DND 5e 不全书》(5echm)** 规则库（8,910 个合并去重与来源区分索引条目），具备 UTF-8/GBK 智能双模解码与 Markdown 表格转译、毫秒级词条检索器、跨平台原生骰子引擎、多角色小队状态管理器与战术战况图生成。  
> **2.2.0 架构特性**：确立 **三级收敛分层架构**，内嵌 **2024 核心执裁常驻微胶囊**，确立 **真机物理掷骰铁律**，绑定 **Session 0 官方开局接口** 与 **DM 执裁 8 项分级门禁卡**，兼容任意 AI Agent 运行环境。

---

## 🌟 B 版核心亮点 (Highlights)

- 🏛️ **L0/L1/L2 三级收敛分层架构**：
  - **L0 常驻微胶囊**：2024 八大武器精通、六大核心新规、标准 DC 字典 100% 常驻即时视野；
  - **L1 运行工具与切片**：`session-zero-interface.md`（标准开局）、`roll-dice.js`（物理真骰）、`lookup.js --brief`（紧凑数据卡）、`state.js`（小队与战局状态锁）；
  - **L2 深度宝库**：124.40 MiB SQLite FTS5 无截断全量库（`130,441,216` 字节，8,910 词条，含 391 道 2024 法术、456 项 2024 魔法物品与装备切片、74 项 2024 专长、386 项 2024 职业特性切片；完整正文零截断、全文检索零截断）按需毫秒级点查。
- 🎲 **真机物理掷骰铁律 (`scripts/roll-dice.js`)**：
  - 严禁 AI 凭空捏造掷骰数字。支持 `--attack --ac <N>` 攻击自动判定（自然 20 必中、自然 1 必失手）、复合算式、优劣势、暴击翻倍与 `--hidden` 暗骰（隐藏标签，单行输出总值及 `HIT`/`MISS`/`CRIT`/`AUTO-MISS`/`PASS`/`FAIL`/`NAT20`/`NAT1`）。
- 📜 **Session 0 官方标准开局接口 (`references/session-zero-interface.md`)**：
  - 一键弹出三步极速启动卡（模式 ➔ 6 套 2024 预制卡 + 随从布兰 ➔ 自创/DMG 2024 官方完整冒险/经典战役），支持“① ① ①”或“随机”即刻开跑。
- 📚 **全量中文规则库直通 (`scripts/lookup.js`)**：
  - 核心三本：**《玩家手册2024》**、**《城主指南2024》**、**《怪物图鉴2025》** 完整中文规则与双语标题检索。
  - 官方核心扩展：**《珊娜萨的万事指南》(XGE)**、**《塔莎的万事坩埚》(TCE)**、**《多元宇宙的怪物》(MPMM)**、**《费资本的巨龙宝库》(FTD)**、**《巨人之荣耀》**、**《万象无常书》**。
- 🏰 **DMG 2024 五大官方完整冒险 + 38 部经典战役模组资源**：
  - 内置《城主指南2024》五部官方教学短篇冒险完整正文与独立 DM 速查包（《秽染溪泉》《矿洞惊魂》《有翼之神》《兽之角冠》《北风舞会》，严格区分原文要点与可选 DM 扩展）；
  - 支持调取《凡达林的失落矿坑》《冰塔峰巨龙》《施特拉德的诅咒》等 38 部经典战役的专属怪物、魔法物品附录与三幕沙盒大纲。
- 💾 **多角色小队状态持久化、先攻轮转与 HUD 防漂移引擎 (`scripts/state.js`)**：
  - 默认存档于技能目录外的用户数据目录（Windows `%APPDATA%\dnd-dm-b\sessions`，Linux/macOS `~/.local/share/dnd-dm-b/sessions`），自动兼容旧目录存档并支持 `DND_SESSIONS_DIR`。支持 `--preset valen,bran` 一键加载预设小队、专注受击 DC 提示（含临时生命吸收伤害）、按行动者 ID 稳定推进先攻 (`next`)、仅在持有者回合初自动递减带轮数状态 (`中毒:2`)、结构化笔记簿 (`note`)、遭遇难度计算 (`encounter-calc`) 与沉浸迷雾 (`--veil`)。

---

## 🚀 极速上手 (Quick Start)

### Node.js 运行环境要求

最低要求为 **Node.js 22.16.0**。CI 已对 Node 22.13.0、22.13.1、22.14.0、22.15.0、22.15.1 与 22.16.0 的内置 `node:sqlite` 执行 FTS5 虚拟表创建实测：前五个版本返回 `no such module: fts5`，22.16.0 首次成功；最新 Node 22.x（实测解析为 22.23.4）也通过。规则库构建与全文检索依赖 SQLite FTS5，因此不能使用不带 FTS5 的运行时。 `setup-db.js` 与 `lookup.js` 启动时会检查该能力，并在不支持时提示所需 Node.js 版本。

> 下方所有命令中的 `<SKILL_DIR>` 指本仓库（即 `SKILL.md` 所在目录）的路径；若你的终端当前已在仓库根目录，也可将 `<SKILL_DIR>` 替换为 `.`。

### 0. 获取规则数据库（首次克隆必做，零 npm 依赖）

为避免超过 GitHub 100 MiB 单文件限制并保证长文与全文索引 100% 完整，`references/rules.db`（`130,441,216` 字节 / `124.40 MiB`）与 `references/topics_index.json`（`2,440,217` 字节 / `2.33 MiB`）不纳入 Git 跟踪。首次克隆后只需执行**一条命令**即可自动就绪：

```bash
# 一键自动获取（优先下载 GitHub Release 预编译包并严格校验 SHA-256；若尚未发布则自动浅拉取上游单提交源码构建）
node <SKILL_DIR>/scripts/setup-db.js

# 也可显式指定获取方式（均不依赖任何第三方 npm 包）：
# 方式 ①：从 GitHub Release 下载预编译压缩包 (66,531,635 字节 / 63.45 MiB) 并校验 SHA-256
node <SKILL_DIR>/scripts/setup-db.js --from-release

# 方式 ②：从 DND5eChm/5echm_web 固定提交 (c1425c8e90804766689a0db7ec416833f3fc3046) 仅浅拉取单提交本地构建
node <SKILL_DIR>/scripts/setup-db.js --from-source
```

#### 离线安装（网络受限环境推荐）
若命令行直连 GitHub 受限，可通过浏览器或其他下载工具自行从 GitHub Releases 下载预编译压缩包 `dnd-dm-b-rules-db-v2.2.0.tar.gz` 到本地磁盘，然后指定本地文件路径完成离线校验与解压：

```bash
node <SKILL_DIR>/scripts/setup-db.js --from-release --url <本地压缩包路径>
```

#### 环境变量与便携部署（非系统盘迁移）
支持通过以下三个环境变量自定义规则数据库与战役存档的位置：
- `DND_DB_DIR`：指定数据库目录（同时供 `setup-db.js` 写入与 `lookup.js` 读取 `rules.db` / `topics_index.json`）。
- `DND_DB_PATH`：指定单个 `rules.db` 文件的完整路径（在 `lookup.js` 中优先级为：`DND_DB_PATH` > `DND_DB_DIR` > 默认 `<SKILL_DIR>/references/rules.db`）。
- `DND_SESSIONS_DIR`：指定战役存档目录（覆盖默认的 Windows `%APPDATA%\dnd-dm-b\sessions` 或 Linux/macOS `~/.local/share/dnd-dm-b/sessions`）。

**Windows 便携部署示例（PowerShell）**：Windows 默认存档目录位于系统盘（`C:` 盘），为防止重装系统盘丢失跑团存档或重复构建规则库，可在 PowerShell 中将其永久指向非系统盘（如 D 盘下的 `Data\dnd-dm-b`）：

```powershell
[Environment]::SetEnvironmentVariable('DND_SESSIONS_DIR','D:\Data\dnd-dm-b\sessions','User')
[Environment]::SetEnvironmentVariable('DND_DB_DIR','D:\Data\dnd-dm-b\db','User')
```

### 1. 开启跑团
在对话中直接对你的 AI Agent 说：
> **“我想跑团”** 或 **“开启一场 D&D 冒险”**

DM 将自动调用 `references/session-zero-interface.md` 输出三步启动卡：
1. **模式选择**：🎭 冒险沉浸模式（默认，隐藏暗骰与怪血）、🌱 萌新保姆模式（带随从导师）或 ⚙️ 规则调试模式。
2. **角色选择**：从 6 名预制 2024 英雄卡中挑选（战士、游荡者、法师、牧师、圣武士、诗人），单人自动获赠矮人斥候随从布兰·铁须，或现场车卡。
3. **剧本选择**：
   - 体验 DMG 2024 官方完整五部曲冒险（《秽染溪泉》Lv.1 ～ 《北风舞会》Lv.7）；
   - 体验自创新手模组《低语地窖与暗影牙痕》（1–2 级五感沉浸）；
   - 体验经典战役沙盒（《凡达林的失落矿坑》《冰塔峰巨龙》《施特拉德的诅咒》）或随机生成地下城！

### 2. 即时规则检索命令 (`scripts/lookup.js`)

```bash
# 查询 2025/2014 怪物数值 (--brief 紧凑数据卡，完整呈现 AC/HP/六维/抗性/全部攻击与动作)
node <SKILL_DIR>/scripts/lookup.js monster "地精武者" --brief
node <SKILL_DIR>/scripts/lookup.js monster "邪魔邪教徒" --brief
node <SKILL_DIR>/scripts/lookup.js monster "黑蜘蛛" --brief
node <SKILL_DIR>/scripts/lookup.js monster "远古红龙"

# 查询 2024 法术详情 (100% 保留伤害/治疗骰值与升环效应)
node <SKILL_DIR>/scripts/lookup.js spell "火球术" --brief
node <SKILL_DIR>/scripts/lookup.js spell "恶言相加" --brief
node <SKILL_DIR>/scripts/lookup.js spell "炼狱叱喝" --brief

# 查询 2024 职业核心特性与专长 (毫秒级直达精确锚点)
node <SKILL_DIR>/scripts/lookup.js rule "偷袭" --brief
node <SKILL_DIR>/scripts/lookup.js rule "动作如潮" --brief
node <SKILL_DIR>/scripts/lookup.js rule "圣疗" --brief
node <SKILL_DIR>/scripts/lookup.js feat "警戒" --brief

# 查询 2024 规则、武器精通与异常状态
node <SKILL_DIR>/scripts/lookup.js rule "武器精通" --brief
node <SKILL_DIR>/scripts/lookup.js rule "Cleave" --brief
node <SKILL_DIR>/scripts/lookup.js rule "恐慌" --brief
node <SKILL_DIR>/scripts/lookup.js rule "力竭" --brief

# 查询魔法物品与冒险装备
node <SKILL_DIR>/scripts/lookup.js item "次元袋" --brief
node <SKILL_DIR>/scripts/lookup.js item "治疗药水" --brief
node <SKILL_DIR>/scripts/lookup.js item "鸦族圣徽" --brief

# 调取 DMG 2024 完整冒险与 5e 模组分类索引
node <SKILL_DIR>/scripts/lookup.js module "秽染溪泉"
node <SKILL_DIR>/scripts/lookup.js module "矿坑"
node <SKILL_DIR>/scripts/lookup.js module "施特拉德"
```

### 3. 骰子与战役状态引擎命令 (`scripts/roll-dice.js` & `scripts/state.js`)

```bash
# 攻击检定 (--attack --ac 自动判定 Nat20 必中 / Nat1 必失手)、复合暴击伤害与暗骰
node <SKILL_DIR>/scripts/roll-dice.js 1d20+5 --attack --ac 15 --label "长剑攻击"
node <SKILL_DIR>/scripts/roll-dice.js 1d8+3+2d8 --crit --label "长剑至圣斩暴击！"
node <SKILL_DIR>/scripts/roll-dice.js 1d20+3 --adv --dc 15 --label "优势察觉检定"
node <SKILL_DIR>/scripts/roll-dice.js 1d20+6 --attack --ac 15 --hidden

# 预设小队一键初始化与多角色状态管理 (默认写入用户数据目录，可通过 DND_SESSIONS_DIR 自定义)
node <SKILL_DIR>/scripts/state.js init crypt-run --preset valen,bran --force
node <SKILL_DIR>/scripts/state.js update crypt-run --hp -4 --reason "狼爪" --use-resource "回气"
node <SKILL_DIR>/scripts/state.js update crypt-run --who "布兰" --hp -3 --reason "短弓流矢"
node <SKILL_DIR>/scripts/state.js show crypt-run --hud --veil

# 休息规则：长休完成后至少经过 16 小时游戏时间，才可开始下一次长休；非 D 模式用 time 命令推进时间，D 模式用 world.js time。
# 遭遇战追踪、先攻回合推进、结构化笔记与难度计算
node <SKILL_DIR>/scripts/state.js mob-add crypt-run --name "骷髅" --hp 13 --ac 14 --count 2 --init 14
node <SKILL_DIR>/scripts/state.js next crypt-run
node <SKILL_DIR>/scripts/state.js mob-hit crypt-run --target "骷髅-1" --damage 8
node <SKILL_DIR>/scripts/state.js note crypt-run --cat clue --add "石棺背面刻有马拉卡尔的血契符文"
node <SKILL_DIR>/scripts/state.js encounter-calc --party 1,1 --crs 1/4,1/4,1/4
node <SKILL_DIR>/scripts/state.js rest crypt-run --long
node <SKILL_DIR>/scripts/state.js time crypt-run --advance 16  # 推进 16 小时游戏时间后，才可再次开始长休
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
│   ├── db-manifest.json              # 预编译库版本、上游 40 位提交 SHA 与 SHA-256 校验清单
│   ├── session-zero-interface.md     # 官方 Session 0 极速开局三步引导接口
│   ├── rules.db                      # [setup-db 生成, gitignore] SQLite FTS5 规则库 (8,910 词条, 124.40 MiB)
│   ├── topics_index.json             # [setup-db 生成, gitignore] 全书双语 JSON 索引 (8,910 条目, 2.33 MiB)
│   └── dedup-report.json             # [setup-db 生成, gitignore] 同书去重合并审计报告
├── scripts/
│   ├── setup-db.js                   # 规则库一键获取工具 (Release 下载校验 SHA-256 / 5echm_web 本地构建)
│   ├── sqlite-capability.js          # 启动时检查原生 SQLite FTS5 能力与最低 Node.js 版本
│   ├── lookup.js                     # 核心点查引擎 (支持双语/别名/职业特性/模组分类)
│   ├── roll-dice.js                  # 跨平台复合骰子引擎 (支持攻击/AC/优劣势/暗骰判定/可控随机种子)
│   ├── state.js                      # 多角色小队状态、按 ID 先攻轮转、笔记与遭遇计算引擎
│   ├── build-db.js                   # SQLite FTS5 数据库预编译、怪物动作保留与去重构建器
│   └── build-index.js                # 规则库 HTML/WCP 全量扫描与子章节切片脚本
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
│   └── premade-characters/           # 6 套 2024 中文预设英雄卡 + 矮人斥候布兰 + presets.json
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
