# 剑火纪元（Mode D）开放世界沙盒运行协议 (`MODE.md`)

**谱系定位（西方奇幻风格总锚）**：本世界属于**西方奇幻传统**（《龙与地下城》《指环王》《魔兽世界》一脉）——位面宇宙与多种族共存是它的骨架，魔法作为被社会管理的力量是它的日常，旧秩序崩解的余烬史诗感是它的基调：精灵的长寿与疏离、矮人的石厅与锻炉、兽人的部族与战歌、侏儒的魔导工学、魔族的契约与阶序、王座厅、纹章、挂毯、石砌城堡、公会、法师塔、神殿、集市、酒馆、佣兵——而非任何东方式宫廷、庙堂或武侠修真意象。这个世界有自己的具体质感（浮空城的粮食软肋、侏儒的魔导工学、五道法统的社会位置），一切描写从设定推导，严禁串味。

## 一、裁决优先级与开放框架铁律
1. **裁决四层优先级**：
   - 第一优先：**D&D 2024 官方规则与数值引擎**（动作经济、法术位、护甲熟练、武器精通、死亡豁免与复活法术，严禁发明法术枯竭扣值、铁护手禁施法或法则即死）。
   - 第二优先：**当前战役存档既定事实（`world.json` 的 `canon` 与 `state.json`）**。
   - 第三优先：**剑火纪元按需设定切片（`worlds/jianhuo/lore/*.md` 与 `mapping.md`）**。
   - 第四优先：**主持 DM 与玩家的桌边即兴共创**（一旦定案立即通过 `canon --add` 固化入档）。
2. **框架开放不写死**：
   - 各地区、组织与教会均采用“骨架 / 素材 / 矛盾与钩子 / 留白问题”四段结构。
   - 除骨架定论外，素材、典型人物与留白问题均由 DM 按本局走向自由裁夺。
   - 已知大陆边缘、万门之城门后与位面深处始终留白开放，绝不写死固定答案。

## 二、D 模式开局与续局标准流程
1. **新开局加载顺序（严控上下文体积 ≤ 30 KB）**：
   - 玩家在首屏回复 `D`（路线二：剑火纪元开放沙盒）后，加载 `worlds/jianhuo/MODE.md`、`worlds/jianhuo/capsule.md` 与 `worlds/jianhuo/start-form.md`。
   - 严禁在开局一次性通读 `worlds/jianhuo/lore/*.md` 全卷或 `worlds/jianhuo/secret/gm-dossier.md`。
   - 根据玩家填写的开局表单（地域/地点可取自设定原名，也可完全自定义，绝不写死单一默认城镇），依次执行：
     - `node <SKILL_DIR>/scripts/state.js init <campaign> --mode D --level <0|1> --name "<姓名>" --class "<职业>" --copper <初始铜币> --location "<开局地点>"`
     - `node <SKILL_DIR>/scripts/world.js init <campaign> --seed <种子> --region "<开局大区>" --location "<开局地点>" --factions "<周边势力>" --cost "<★代价>" --limit "<◆限制>"`
   - `world.js init` 自动完成三件事：
     - 在开局地区生成 **3 个“患”级局部问题**（3 个局部威胁时钟 `clk:trouble_1..3` + 3 条账本记录 `led:trouble_1..3`）；
     - 将 **★代价**（`--cost`）与 **◆限制**（`--limit`）转化为账本记录与局部时钟；
     - 在**演化八线**中仅启动与开局地区相关的 **3–4 条**（`active`），其余 4–5 条保持待启动（`paused`）。
2. **续局标准流程（先读元数据，按模式分流）**：
   - 续局时先执行 `node <SKILL_DIR>/scripts/state.js show <campaign> --json` 检查战役元数据 `meta.mode`。
   - 若 `meta.mode === "D"`：
     - 立即加载 `worlds/jianhuo/MODE.md` 与 `worlds/jianhuo/capsule.md`；
     - 运行 `node <SKILL_DIR>/scripts/world.js status <campaign>`（输出严格控制在 15 行以内，玩家视图绝不含 `secret`）；
     - 结合 HUD 与世界态势衔接上一幕继续主持。
   - 若非 D 模式：按经典 A/B/C 流程直接读取 HUD 续局，不加载任何剑火世界文件。

## 三、双状态机职责边界与统一铜币记账
1. **职责严明、零冗余字段**：
   - `state.js`（`state.json`）专管角色生命、AC、法术位、职业资源、先攻轮次、背包与统一铜币 `inventory.copper`。
   - `world.js`（`world.json`）专管标准历法 `calendar`、确定性种子 `rng`、地点 `locations`、势力 `factions`、NPC 生死与态度 `npcs`、局势时钟与演化八线 `clocks`、代价账本 `ledger`、既定事实 `canon` 与传闻 `rumors`。
2. **钱只记一套账（统一铜币 `inventory.copper`）**：
   - D 模式存档仅使用 `inventory.copper`（整数铜币，`1 gp = 10 sp = 100 cp`），绝不同时存储 `inventory.gold`。
   - 执行 `node <SKILL_DIR>/scripts/state.js update <campaign> --copper <+/-N>` 或 `--gold <+/-N>` 时，D 模式均自动换算并作用于 `inventory.copper`，HUD 自动折算展示为 `Xgp Ysp Zcp`。
   - A/B/C 经典模式的 `inventory.gold` 行为保持 100% 原样不变。
3. **休息与时间双文件事务**：
   - 在 D 模式下执行 `node <SKILL_DIR>/scripts/state.js rest <campaign> --short`（推进 `1h`）或 `--long`（推进 `8h`）时，底层自动通过 `pending-op.json` 双文件事务协议联动推进 `world.json` 历法与到期时钟。
   - 旅途、潜伏或跨日等待时，显式运行 `node <SKILL_DIR>/scripts/world.js time <campaign> --advance <1h|8h|1d|1tenday|1m>`。

## 四、序章 0 级平民模式与 0→1 阶晋升
1. **0 级凡人序章（可选）**：
   - 玩家若选择 0 级微末开局，使用 `--level 0` 初始化角色（底层绑定 `#1623` **平民 Commoner** 基底：`HP = max(4, 4 + CON调整值)`、基础 `AC = 10`、`1d8` 生命骰、无职业法术位）。
   - 序章聚焦凡俗生存、行会学徒试炼或边镇危机，遭遇战使用 `node <SKILL_DIR>/scripts/state.js encounter-calc --party 0 --crs <CR>` 严格把控低烈度威胁（单次遭遇 XP 预算：简单 25 / 中等 50 / 困难 75）。
2. **生死蜕变与正式晋升（仅限 `0 → 1`）**：
   - 当角色渡过序章高潮（如立下契约、觉醒血脉、通过行会授印或死里逃生），运行：
     - `node <SKILL_DIR>/scripts/state.js promote <campaign> --class "<正式职业>" [--hp <Lv1最大HP>] [--ac <新AC>] [--slots <法术位>]`
   - `promote` 严格只处理 `0 → 1` 级晋升，自动授予 Lv1 职业生命骰与生命上限；1 级之后的常规升级仍走标准属性更新流程。

## 五、按需设定检索、演化八线唤醒与保密纪律
1. **按需切片检索（`lookup.js lore`）**：
   - 当玩家踏入新国度、接触特定教会/结社或追查民俗黑话时，运行：
     - `node <SKILL_DIR>/scripts/lookup.js lore "<关键词>" --brief`
   - 默认模式严禁读取 `worlds/jianhuo/secret/`；仅当 DM 在幕后推演深层异变诱因且确需核对候选真相时，才在内部运行 `node <SKILL_DIR>/scripts/lookup.js lore "<关键词>" --gm`，且严禁将内档原词直接输出给玩家。
2. **演化八线与跨区唤醒**：
   - 开局仅启动与所在区域直接相关的 3–4 条演化线；当玩家跨区远行抵达新国度，或某条活跃演化线触发跨线联动波及待启动线时，使用 `node <SKILL_DIR>/scripts/world.js clock <campaign> --resume --id <trackId>` 唤醒对应演化线（恢复时 `nextTick` 自动对齐至当前时间之后，绝不补掷历史漏骰）。
3. **传闻认知过滤与神谕表抽取**：
   - 街巷打听运行 `node <SKILL_DIR>/scripts/world.js rumor <campaign> --draw --location "<当前地点>"`（自动按地点 `凡俗/文明/超凡/异界/诸界` 门槛过滤）。
   - 开放式未知悬念或随机风味事件运行 `node <SKILL_DIR>/scripts/world.js oracle <campaign> --question "<问题>" --odds <unlikely|even|likely> [--table <omen|travel|tavern|settlement_trouble>]`。
4. **NPC 真实生死与定论登记**：
   - 重要人物通过 `node <SKILL_DIR>/scripts/world.js npc <campaign> --generate --location "<当前地点>"` 生成；一旦阵亡必须执行 `--update --alive false`，除非施展 2024 合法复活法术并带 `--revive`，严禁无故返场。
   - 桌边新确立的聚落、契约或领主更替，随时执行 `node <SKILL_DIR>/scripts/world.js canon <campaign> --add --entity "<实体>" --predicate "<属性>" --value "<定论>"` 记入正典。

## 六、每回合主持自检清单（6 步闭环）
1. **查状态**：涉及战斗、资源或跨日时，先核对 `state.js` HUD 与 `world.js status`。
2. **明代价**：动用违禁法统、贵族人情、高利贷或神殿特赦时，通过 `world.js ledger --add` 记入未结账本。
3. **推时间**：短休/长休走 `state.js rest`，长途跋涉或等待走 `world.js time --advance`，关注到期时钟与逾期账本回响。
4. **定事实**：桌边新出现的地名、重要 NPC 生死或政治定论，立即写入 `world.js canon --add`。
5. **守视角**：向玩家呈现的永远是可感知的表象、物价、征兆与酒馆传闻，绝不剧透内档候选大劫名称。
6. **给钩子**：每幕结尾结合当前地点“患”级时钟、未结账本或演化八线风声，给出 2–3 个有分量、有代价的行动方向。
 
### 附：常用 D 模式世界指令速查
- 查看世界态势摘要（≤15行）：`node <SKILL_DIR>/scripts/world.js status <campaign>`
- 新增局部威胁/机遇时钟：`node <SKILL_DIR>/scripts/world.js clock <campaign> --add --id clk:x --name "<名称>" --cadence <day|tenday|month> --max 4`
- 登记人情/债务/代价/把柄：`node <SKILL_DIR>/scripts/world.js ledger <campaign> --add --id led:x --type <人情|债务|代价|把柄|线索> --summary "<内容>"`
- 核查实体既定正典事实：`node <SKILL_DIR>/scripts/world.js canon <campaign> --check --entity "<实体ID>"`
- 按需检索剑火设定切片：`node <SKILL_DIR>/scripts/lookup.js lore "<设定关键词>" --brief`
