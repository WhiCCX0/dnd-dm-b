# 剑火纪元沙盒（D 模式）阶段 0 先决数据与执行契约 (`SCHEMA.md`)

> **契约版本**：`schemaVersion: 1`（对应融合方案 v2 第二节与第十二节技术选型）
> **基线提交**：`dnd-dm-b` `a4afce3` × `text-rpg-gm` `48f6f5f`
> **最高优先级法则**（冲突时自上而下裁决）：
> `D&D 2024 数值与行动/施法规则 > 本存档已登记的结构化事实（canon） > 剑火纪元静态设定切片（lore/*.md） > 即兴叙事`

---

## 一、文件分工、单一权威与模式识别契约

### 1.1 存档目录与双文件结构

沿用现有战役存档目录（默认用户数据目录或 `DND_SESSIONS_DIR` 指定的 `<SESSIONS_DIR>/<campaign>/`）：

```text
<SESSIONS_DIR>/<campaign>/
├── state.json          # 角色、战斗、库存与货币唯一权威（state.js 管辖）
├── state.json.bak      # state.json 最近一次写前备份
├── world.json          # 日历、世界事实、势力、NPC、时钟、账本、传闻唯一权威（world.js 管辖）
├── world.json.bak      # world.json 最近一次写前备份
└── pending-op.json     # [仅跨文件事务期间存在] 双文件原子提交意图与写前/写后哈希日志
```

### 1.2 单一权威边界（禁止跨文件冗余）

同一类状态只归唯一脚本与唯一文件管辖，契约校验器对越界字段直接报错拒绝：

| 文件 | 管辖脚本 | 允许顶层业务域（唯一权威） | 严禁出现的越界字段 |
| :--- | :--- | :--- | :--- |
| `state.json` | `scripts/state.js` | `meta`、`party`、`combat` / `mobs`、`inventory`（含 D 模式 `copper` 或 A/B/C 模式 `gold`）、`notes` | `calendar`、`clocks`、`canon`、`ledger`、`rumors`、`factions`、`rng` |
| `world.json` | `scripts/world.js` | `meta`、`calendar`、`rng`、`locations`、`factions`、`npcs`、`clocks`、`ledger`、`canon`、`rumors` | `party`、`combat`、`mobs`、`inventory`、`spellSlots`、`resources` |

### 1.3 战役模式显式识别与单向联动

1. **显式元数据识别**：D 类沙盒战役必须在 `state.json.meta` 与 `world.json.meta` 中显式写入：
   ```json
   {
     "mode": "D",
     "worldId": "jianhuo",
     "schemaVersion": 1
   }
   ```
   严禁仅凭存档目录内“是否存在 `world.json`”猜测模式。A/B/C 模式战役保持原有结构不变，**绝不触发世界时间推进或任何 `world.js` 逻辑**。
2. **严格单向调用**：仅允许 `node <SKILL_DIR>/scripts/state.js rest ...` 在检测到 `meta.mode === "D"` 时单向调用世界时间推进（短休推进 `1h`，长休推进 `8h`）；**严禁 `world.js` 反向调用 `state.js`**，从根源杜绝跨进程双向文件锁死。

### 1.4 货币记账契约（已确认：统一铜币方案）

- **D 模式（剑火纪元沙盒）**：`state.json` 的 `inventory.copper` 存储**非负安全整数（以铜币 `cp` 为唯一底层真值）**，D 模式存档严禁同时存储 `inventory.gold` 字段，严格遵循 D&D 2024 标准十进制换算：
  `1 gp = 10 sp = 100 cp`
  - 扣款与收入统一在整数 `copper` 上原子加减（`state.js update` 的 `--copper` 与 `--gold` 在 D 模式下均换算后作用于 `inventory.copper`，零跨档借位误差、严禁负余额或小数）；
  - HUD 与文本展示自动折算为 `Xgp Ysp Zcp`（如 `135 cp` → `1gp 3sp 5cp`）；
  - 设定中的“旧帝国龙纹金币 / 咬铅烂骨银币 / 剪边碎屑 / 劈半铜子 / 铁销”仅作为叙事描写与检定议价情境，不在底层引入多汇率浮点账本；魔晶属于奇物/炼金材料物品，不是施法强制货币成本。
- **A/B/C 模式（经典 D&D）**：完全保持现有整数 `inventory.gold` 字段与行为不变。

---

## 二、双文件跨脚本一致性契约（`pending-op.json` 事务协议）

长休/短休等跨文件操作须同时修改 `state.json` 与 `world.json`，单文件 `.bak` 不足以防止半写状态，必须执行以下 6 步崩溃恢复与幂等协议：

1. **唯一操作标识**：每次跨文件事务必须携带非空唯一字符串 `opId`（如 `"rest-long-20261107-0001"`）。
2. **幂等短路检查**：执行前先运行启动恢复检查，再读取 `world.json` 的 `meta.completedOpIds`（环形保留最近 128 条已完成 `opId`）。若该 `opId` 已存在，直接返回 `{ skipped: true, reason: "duplicate_op_id" }`，**不重复加血、不重复推进时钟**。
3. **写前备份与意图日志落盘**：
   - 计算当前磁盘 `state.json` 与 `world.json` 的 SHA-256（`preStateSha256`、`preWorldSha256`），并将当前两文件分别原子同步至 `state.json.bak` 与 `world.json.bak`（确保 `.bak` 精确对应本次事务写前版本，绝不误用更早轮次的陈旧 `.bak`）；
   - 计算目标新内容的 SHA-256（`postStateSha256`、`postWorldSha256`，其中新 `world.json` 已将 `opId` 记入 `meta.completedOpIds`）；
   - 通过临时文件 `rename` 原子写入 `pending-op.json`：
     ```json
     {
       "opId": "rest-long-0001",
       "action": "rest:long",
       "createdAt": "2026-11-07T00:00:00.000Z",
       "preStateSha256": "<64-hex>",
       "preWorldSha256": "<64-hex>",
       "postStateSha256": "<64-hex>",
       "postWorldSha256": "<64-hex>"
     }
     ```
4. **顺序原子写盘**：先通过 `tmp + rename` 原子更新 `state.json`，再通过 `tmp + rename` 原子更新 `world.json`。
5. **提交清理**：两文件均落盘成功后，删除 `pending-op.json`。
6. **启动自检与中断恢复（`recoverPendingOp`）**：任一脚本启动时若发现存档目录存在 `pending-op.json`：
   - **已完成仅未删日志（中断点 B）**：若当前 `state.json` 与 `world.json` 的 SHA-256 **同时等于** `postStateSha256` 与 `postWorldSha256`，说明两边均已成功写入新版，直接删除 `pending-op.json` 并报告 `committed_clean`；
   - **半写中断回滚（中断点 A）**：其他任何情形（如 `state.json` 已是新版但 `world.json` 仍是旧版或缺失），校验 `state.json.bak` / `world.json.bak` 与 `preStateSha256` / `preWorldSha256` 一致后，将两边原子回滚至写前版本，删除 `pending-op.json` 并在输出中明确报告 `rolled_back`。

---

## 三、历法、可复现随机源与时钟边界结算契约

### 3.1 历法与时间戳编码（对照设定母本核实）

经核对 `text-rpg-gm` 卷二原文（“一年十二个月，以纪元代年”），定死标准历法如下：

- **纪元 (`era`)**：默认 `"剑火纪"`（七纪元：神启纪 / 古族纪 / 辉法纪 / 列王纪 / 崩渊纪 / 帝国纪 / 剑火纪），`year` 为正整数（`>= 1`）。
- **年月日时换算**：
  - `1 年 = 12 个月 = 4 季（每季 3 个月） = 360 天 = 8,640 小时`
  - `1 个月 = 3 旬 = 30 天 = 720 小时`（`day` 取值 `1..30`：`1..10` 上旬、`11..20` 中旬、`21..30` 下旬）
  - `1 旬 = 10 天 = 240 小时`
  - `1 天 = 24 小时`（`hour` 取值 `0..23`）
- **六时段映射 (`period`)**：
  - `深夜`：`00..03` 时 ｜ `黎明`：`04..07` 时 ｜ `上午`：`08..11` 时
  - `下午`：`12..15` 时 ｜ `黄昏`：`16..19` 时 ｜ `夜`：`20..23` 时
- **规范化时间戳 (`WorldTimestamp`)**：固定格式 `Y0142-M03-D11T04`（年份至少 4 位零填充以便字典序与时间先后同序），与线性总小时数严格双射：
  `totalHours = ((year - 1) * 360 + (month - 1) * 30 + (day - 1)) * 24 + hour`

### 3.2 时钟结构、周期 (`cadence`) 与自然边界对齐

每个时钟对象包含：`id`、`name`、`kind`（`threat` 患难灾劫 / `track` 演化诸线 / `faction` 势力进度 / `npc` 个人目标）、`cadence`、`current`（整数 `0..max`）、`max`（整数 `>= 1`）、`status`（`active | completed | paused | cancelled`）、`nextTick`（下次结算时间戳）、`visibility`（`public | rumor | secret`）。

| `cadence` | 适用尺度 | 固定步长 | 自然结算边界（统一对齐黎明 `04:00`） |
| :--- | :--- | ---: | :--- |
| `day` | 局部紧迫危机（追兵搜山、矿道坍塌） | `24h` (`1d`) | 每日 `T04` |
| `tenday` | 地区局势（粮船扣留、浮空塔缺粮） | `240h` (`10d`) | 每月 `D01`、`D11`、`D21` 的 `T04` |
| `month` | 邦国政局、商路更迭 | `720h` (`30d`) | 每月 `D01` 的 `T04` |
| `season` | 大陆级战役或气候异动 | `2,160h` (`90d`) | 每年 `M01`、`M04`、`M07`、`M10` 的 `D01T04` |
| `year` | 纪元暗流（冬线南移、深渊魔潮） | `8,640h` (`360d`) | 每年 `M01-D01T04` |

### 3.3 边界结算、时代烈度与拆分推进等价律

1. **按跨界先后有序结算**：从 `T_start` 推进至 `T_end = T_start + deltaHours` 时，循环找出所有满足 `status === "active"` 且 `toTotalHours(nextTick) <= T_end` 的时钟，严格按 `(toTotalHours(nextTick), clock.id)` 升序逐一结算：
   - 从存档确定性 PRNG（`world.rng`）抽取 1 次 `d6`，按 `world.meta.worldParams.intensity` 查表推进格数：
     - `slow`（慢）：`1–4` → `+0`，`5` → `+1`，`6` → `+2`
     - `standard`（标准，默认）：`1–3` → `+0`，`4–5` → `+1`，`6` → `+2`
     - `fast`（快）：`1–2` → `+0`，`3–4` → `+1`，`5–6` → `+2`
   - 更新 `current = min(max, current + delta)`，并将 `nextTick` 推进一个固定周期步长（`tickHours + cadenceHours`）；
   - 若 `current === max`，立即置 `status = "completed"`（后续边界不再为其掷骰，不空耗随机序列）。
2. **短推进零掷骰与拆分严格等价**：未跨过任何 `nextTick` 的小时级推进（如 1 小时短休）只更新日历、消耗 **0 次**随机数。因任意拆分区间跨过的 `(nextTick, clock.id)` 有序序列完全不变，`--advance 1d` 与连续三次 `--advance 8h`（或二十四次 `--advance 1h`）产出的结算次数、每次骰值、最终日历与 PRNG 状态 **100% 一致**。
3. **可复现随机源 (`world.rng`)**：`{ seed: uint32, state: uint32 }` 采用纯 32 位无符号整数状态算法（Mulberry32 步进），JSON 序列化无精度损失；相同初始 `seed` 与相同操作序列结果恒定一致。
4. **单次推进上限**：首版单次推进时长要求 `0 < deltaHours <= 8640`（即不超过 1 年 / `360d`）；超出 1 年的跨年幕间结算直接报错拒绝（留待 v2）。

---

## 四、结构化世界事实（`canon`）与冲突检测契约

### 4.1 `canon` 记录结构（8 必填字段）

| 字段 | 类型与枚举 | 契约说明 |
| :--- | :--- | :--- |
| `id` | `string` | 存档内唯一编号（如 `"canon-0001"`） |
| `entityId` | `string` | 实体唯一标识（如 `"loc:cangqiong_crown"`、`"kingdom:nord"`、`"npc:duke_val"`） |
| `predicate` | `string` | 属性谓词（如 `"ruler"`、`"status"`、`"location"`、`"anchor_state"`） |
| `value` | `string \| number \| boolean` | 属性值 |
| `validFrom` | `WorldTimestamp \| null` | 生效起点（`null` 表示自创世/历史起点起生效） |
| `validTo` | `WorldTimestamp \| null` | 失效终点（`null` 表示至今仍有效；区间采用**左闭右开 `[validFrom, validTo)`**） |
| `status` | `"定论" \| "传说" \| "候选真相"` | 事实确立状态 |
| `source` | `"设定切片" \| "玩家行动" \| "生成" \| "玩家提出"` | 来源分类 |
| `visibility` | `"public" \| "rumor" \| "secret"` | 玩家视图可见性 |

- **时间更替无死角**：因区间采用左闭右开 `[validFrom, validTo)`，王国在 `Y0142-M06-D10T12` 覆灭时只需将旧统治记录填 `validTo = "Y0142-M06-D10T12"`，新政权记录填 `validFrom = "Y0142-M06-D10T12"`，两区间不重叠、不冲突。若同时指定 `validFrom` 与 `validTo`，必须满足 `validFrom < validTo`。

### 4.2 冲突检测与覆盖关系

1. **硬冲突直接拒绝**：同一 `entityId + predicate` 在重叠时间区间内出现两条 `status === "定论"` 且 `value` 不同的记录，校验器直接返回硬冲突错误并拒绝写入。
2. **软冲突（疑似冲突）提示**：以下无法单靠键值断言但存在叙事张力的情形，校验器放行写入但在返回结果的 `suspectedConflicts` 数组中列出，交由 GM 裁断（不虚报 100% 语义理解）：
   - 同一 `entityId + predicate` 在重叠时间内，`传说` / `候选真相` 与既有 `定论` 的 `value` 不一致；
   - 同一 `entityId` 已有 `status === "定论"` 宣告存亡终结（如 `predicate: "存亡"` 且值为 `"灭亡"` / `"已毁灭"` / `"已死亡"`），后续时间段又为其新增其他活跃属性定论。
3. **存档覆盖静态切片**：本存档 `world.json` 中的 `canon` 始终优先于 `worlds/jianhuo/lore/*.md`；世界变化严禁反向修改仓库内的静态 Markdown 设定切片，防止跨存档污染。

---

## 五、统一账本（`ledger`）、NPC 与地点认知层级契约

### 5.1 统一账本（`ledger`）

取消散落的 `hooks` / `aftermaths` 重复表，统一收归 `world.ledger` 数组：

- `id`：唯一字符串 ID
- `type`：`"机会" | "线索" | "承诺" | "债" | "仇怨" | "秘密" | "余波"`（当 `type === "债"` 时可选填 `debtKind: "契约" | "人情" | "神恩"`）
- `summary`：事项简述
- `source`：来源说明
- `relatedNpcIds`：`string[]`
- `relatedFactionIds`：`string[]`
- `trigger`：`{ time: WorldTimestamp | null, locationId: string | null, event: string | null }`
- `dueAt`：`WorldTimestamp | null`（到期时间戳）
- `overdueConsequence`：`string`（逾期未处理的演化后果）
- `status`：`"未动" | "推进中" | "搁置" | "了结"`
- `visibility`：`"public" | "rumor" | "secret"`

### 5.2 地点认知层级与 NPC 死亡保护

- **地点 `tier`**：必须属于五层认知门槛之一：`["凡俗", "文明", "超凡", "异界", "诸界"]`，用于约束场景可打听传闻的上限。
- **NPC 档案**：含 `id`、`name`、`voice`（声线特征）、`desire`（诉求）、`fear`（恐惧）、`secret`（秘密）、`attitude`（整数 `-3..+3`）、`locationId`、`alive`（布尔值）、`visibility`。**一旦 `alive === false`，普通更新操作严禁将其改回 `true`**（唯有显式依据 D&D 2024 合法复活法术登记的专用事件方可变更，并留存政治/宗教余波账本）。
- **序章底板锚点**：0 级人生模拟序章以 2024 数据卡 `平民` (`#1623`) 为底板（PB `+2`，`1d8` 生命骰，最大 HP `max(4, 4 + CON调整值)`），具体建卡与 `promote` 转换命令在阶段 3 实现。

---

## 六、秘密边界（坦白版）与行为红线

1. **存放位置（第十二节已确认决策）**：GM 内档保留在仓库内 `worlds/jianhuo/secret/gm-dossier.md`。
2. **工具层默认过滤**：玩家态视图（`status`、`rumor`、默认 `lore` 检索及契约函数 `filterPlayerVisible`）一律剔除 `visibility === "secret"` 的记录与 NPC `secret` 字段；仅显式传入 `--gm` 时返回。
3. **坦白局限说明**：本仓库公开，且宿主 Agent 的终端调用输出在多数客户端可被玩家展开查看，宿主模型亦具备读取本地文件的底层能力——因此该机制**只防 AI 误读剧透与玩家无意瞥见，不构成密码学或物理隔离意义上的绝对保密**。
4. **主持协议红线（写入阶段 3 `MODE.md`）**：
   - 严禁对 `worlds/jianhuo/secret/` 目录执行全文搜索（grep）或整文件读取；
   - 仅允许在剧情确需核实幕后候选真相时，通过 `node <SKILL_DIR>/scripts/lookup.js lore <关键词> --gm` 按小节受控读取；
   - 严禁让处于较低认知层级的凡俗/不知情 NPC 说出 `secret` 级信息。

---

## 七、生成分工契约

- **脚本职责（100% 确定性）**：抽随机表、校验字段契约、分配唯一 ID、计算日历与时钟边界推进、执行 `canon` 冲突检查、完成原子写盘与崩溃恢复。脚本不拼装伪深度长文。
- **宿主 AI 职责（受控创作）**：依据抽表结果与切片语境撰写具象场景、人物言行与事件细节，生成后调用契约接口校验无冲突再落盘为 `canon` / `ledger` / `npcs` 记录。
