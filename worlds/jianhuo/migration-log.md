# 剑火纪元设定迁移与母本逐段核销日志 (`migration-log.md`)

- **源仓库**：`https://github.com/WhiCCX0/text-rpg-gm` @ `48f6f5f5e11b8518d5065b1383edca319b7f185a`
- **目标基线**：`WhiCCX0/dnd-dm-b` 阶段 0（`5fa8b4f`）→ 阶段 1 初版（`1ca7a51`，被退回）→ 阶段 1 返工版（本次）
- **返工原则（仓库主人定案）**：世界观**只能扩展，不能缩水或整体替换**；写成**开放框架**，不写死，给实际主持的 DM 留发挥空间。原有内容全部保留为骨架或素材（可改写、合并、重新解释，不能消失）；除方案 v2 第三节必删项（9 类旧机制、十二席）外，信息量不减。
- **统一四段框架**：每个地区、势力、组织均按 **骨架（定论）/ 素材（传说/可选）/ 矛盾与钩子 / 留白问题** 书写；除骨架外 DM 可自由改写，改动记入存档 `canon`。
- **自动保真门禁**：`test/jianhuo-phase1.test.js` 的 W1.6（原仓 233 个标题、519 个加粗、124 个【】专名正向核验 + 删除原因审计）、W1.7（新文件非原文专名反向核验）、W1.8（必留核心内容 + 四段框架 + 地图边缘开放）。原仓专名索引固化于 `test/fixtures/text-rpg-gm-reference-index.json`。
- **不变项**：`mapping.md` 映射表、9 类旧机制清理、十二席处理、W1.1–W1.5 与 T5 门禁均保持不动；不搬 `saves/` 与 `.git/`。

---

## 一、原仓文件全量去向核销表（逐文件：合并 / 新增 / 删除）

| 原仓路径 (`text-rpg-gm`) | 处置动作 | 目标位置 (`dnd-dm-b`) 与合并、新增、删除情况 |
| :--- | :--- | :--- |
| `SKILL.md` | **不直接复制** | 世界观速览提炼入 `worlds/jianhuo/capsule.md`；沙盒主持协议留待阶段 3 写入 `worlds/jianhuo/MODE.md`；旧门禁 8、法术枯竭与伤势条文属旧机制，废弃 |
| `README.md` | **不迁入** | 原仓保留；待阶段 4 联调收尾并请示仓库主人后再决定停更标注 |
| `references/world-setting.md`（433 行母本） | **逐段比对救回后退役** | 全部独有段落已逐一救回对应切片（见第二节）；第 14 行“西方奇幻谱系总锚”保留于 `capsule.md` 与 `lore/world-rules.md`；**删除**：十二席名录、法术位极限机制、`/状态` `/存档` `/月报` 面板模板（见第四节） |
| `references/world-rules.md` | **全文迁入并改写** | → `lore/world-rules.md`：七律、五层认知、四阶威胁、历法全部保留，标题原文对齐；禁复活与施法限制改写为 2024 合法可用前提下的宗教/社会后果；**新增**：开放框架使用说明；**删除**：无 |
| `references/history-and-eras.md` | **全文迁入并结构化** | → `lore/history-and-eras.md`：七纪元、九大世界奇观、演化八线（含全部阶段刻度）、灾厄原则、传说形成律全保留；**新增**：当代演化实例素材小节；**删除**：无 |
| `references/nations-and-realms.md` | **全文迁入 + 合并初版新编** | → `lore/nations-and-realms.md`：七大国度及其城邦/机构、四大走廊、四条商道、垂直三界全保留并改写为四段框架；**合并**：诺德、卡斯蒂亚、奥术高塔同盟、自由港联盟、瓦尔德、铁炉、腐殖泥沼、渊喉裂谷等初版新编并入原名下作“素材（传说/可选）”；**新增**：翡翠林冠、灰烬荒原诸部（新增候选区域）、战争现实法则、已知大陆之外（方向提示）；工匠“地精”改称 `侏儒` (#544)，“地精精算托拉斯”记为“侏儒精算托拉斯（原称：地精精算托拉斯）”；**删除**：“永冬之王”固定人物（十二席） |
| `references/powers-and-factions.md` | **全文迁入并改写** | → `lore/powers-and-factions.md`：九族、三大远古血脉、权力四极、公会 F–S 评级、货币魔晶、17 岁成年律、五道法统、器物六阶与超凡六道、魔兽五纲、异界五大律全保留；救回巫术四灵、魂法三阶、隐世之境、具名担保、童雏监护连带与部族授刃礼；**删除**：“高阶八元（高阶之门必有不可逆终身侵蚀）”铁律表述（旧机制，改为传言） |
| `references/martial-and-classes.md` | **全文迁入并改写** | → `lore/martial-and-classes.md`：十二职业社会风味与训练习俗全部保留为素材；职业统一 2024 标准译名；**删除**：8 个错译/错配武器精通小标题（旧机制），以 2024 标准译名与正确武器重写 |
| `references/arcane-schools-and-reagents.md` | **重点重写** | → `lore/arcane-schools-and-reagents.md`：八大学派、十七元素、15 行全景交互矩阵、四项工程分支、施法三相、特色原料全保留；十五条高阶价签原句**逐字保留**为“民间传言 · 传说/可选 · 无机制效果”附录；**删除**：第五节法术位生理枯竭三阶段机制及其子标签（旧机制） |
| `references/pantheon-and-cults.md` | **全文迁入并改写** | → `lore/pantheon-and-cults.md`：九大主神（含全部【核心神恩】【神罚价签】专名，改为教会传说风味）、四大跨国地下结社全部保留并改写为四段框架；救回边地**野性与狩猎**信仰；**新增**：渴血裂喉教团、蜕皮长生会、碎链虚空派（新增候选/可选）；**删除**：神恩数值减伤与破戒自动暴毙条款（旧机制，正文已改写） |
| `references/daily-life-and-economy.md` | **全文迁入并改写** | → `lore/daily-life-and-economy.md`：五阶层饮食、行会四准则、行路十大铁律禁忌、5 条酒馆黑话、硬币成色与魔晶汇票全保留；物价按 PHB 2024 重标（全身板甲 `1,500 gp`、战马 `400 gp`）；**删除**：失真旧物价（旧机制） |
| `references/ecology-and-bestiary.md` | **全文迁入并映射重标** | → `lore/ecology-and-bestiary.md`：12 种本土魔兽与 24 项兽材全保留，逐只绑定 2024 数据卡；剥离非同调法术免疫（旧机制）；救回生态失衡与地下城枯竭法则 |
| `references/planes-and-cosmology.md` | **全文迁入并补强** | → `lore/planes-and-cosmology.md`：晶壁、万门之城、深渊十二裂口全表、星界原初之海、妖精原野、阴影位面与梦境边疆、原初以太层全保留；救回魔界三分天下与“一界一律”；**新增**：万门之城的门后与各位面深处的开放方向提示 |
| `references/srd-bestiary-and-planes.md` | **去重纠错迁入** | → `lore/srd-bestiary-and-planes.md`：全部条目保留；纠正拟身怪（实为强酸免疫）、夺心魔、眼魔、凝胶方块战术（旧机制#8）；“三个僭主”人物名属十二席，删除 |
| `references/legends-and-relics.md` | **删十二席留奇物** | → `lore/legends-and-relics.md`：删除整节十二席档案（十二席）；六大奇物全部保留，持有者改为“下落成谜/多方争夺”；融入器灵独立 NPC 规则；**新增**：四件候选奇物（星环断锚罗盘、霜铁失衡半秤、索林焦页孤本、渊喉三叠血契戒） |
| `references/starting-interface.md` | **素材收编 + 留待阶段 3 重构** | 三层建局表单、极速开局、★/◆ 代价律、第一场景硬下锚全部收编入 `lore/powers-and-factions.md` 第六节 3 项作为风味素材；作为阶段 3（W2）`worlds/jianhuo/start-form.md` 设计输入；**删除**：`/状态` `/存档` `/月报` 元指令面板（旧机制，由 `SCHEMA.md` 取代） |
| `references/literary-pipeline-contract.md` | **择优提炼差异** | → `references/writing-craft.md`：西幻防串味守则与感官具象化工艺全保留；**删除**：句长“极差必须 > 15 字”机械教条（旧机制） |
| `references/gm-dossier.md` | **清理对齐迁入** | → `worlds/jianhuo/secret/gm-dossier.md`：威胁四阶、三大劫（冬线南移、渊喉巨脉、苍穹脱缰）作为候选真相保留、隐藏种族真相、开局封锁清单全保留；**新增**：三条候选历史暗线；统一**苍穹之冠**与冬线速度（往年一寸、今年半里）；**删除**：十二席档案表与锁表行（十二席） |
| `scripts/validate-state.js` | **禁止迁入** | 深度耦合旧版 `hp_state / wounds / spell_burnout_stage` 结构，已由 `scripts/world-contract.js` 与 `scripts/state.js` 取代 |
| `scripts/de-ai-scan.js` | **禁止迁入脚本** | CommonJS 与本仓 ES Module 不兼容；网文套话、中式穿帮词与公文腔禁用表已提炼入 `references/writing-craft.md`，剔除机械句长极差教条 |
| `templates/*` | **禁止迁入** | 含旧伤势与法术枯竭废弃字段；已被阶段 0 `worlds/jianhuo/SCHEMA.md` 契约取代 |
| `test/run-tests.js` | **不直接复制** | 旧断言含错误精通译名与枯竭字段；已重写为 ESM 原生测试 `test/world-contract.test.js` 与 `test/jianhuo-phase1.test.js` |
| `saves/`、`.git/` | **严禁搬迁** | 私人存档与旧仓 Git 历史，零文件拷入本仓 |

---

## 二、母本 `world-setting.md`（第 1–433 行）逐段比对与独有内容救回台账

| 母本行号区间 | 母本章节主题 | 与旧分卷比对结论 | 独有段落具体内容与救回落点 |
| :--- | :--- | :--- | :--- |
| 第 1–16 行 | 标题与《使用说明》 | **含母本独有关键锚点** | ①命名定案与拓展即定案原则；②**第 14 行“西方奇幻谱系总锚”**（工匠族按 W1.4 改称“侏儒的魔导工学”）→ **已救回 `capsule.md` 首段与 `lore/world-rules.md` 卷首**；③GM 内档保密原句 → `lore/world-rules.md` 逐字保留 |
| 第 18–56 行 | 卷一·世界七律与历法 | 大部重合，**含 2 处独有句** | ①**节制原则**；②**标准历法定义**（一年十二个月，以纪元代年）→ `lore/world-rules.md` 与 `SCHEMA.md` 3.1 节 |
| 第 58–112 行 | 卷二·七纪元与时代对照 | 纪元表重合，**含独有方法论** | **时代 × 世界状态对照原则** → `lore/history-and-eras.md` |
| 第 113–132 行 | 演化八线与各线阶段刻度 | **母本独有完整刻度表** | 八线全部阶段刻度 → `lore/history-and-eras.md` 第四节（仅删 `/月报` 面板耦合措辞，改由 SCHEMA 世界时钟推进） |
| 第 114–156 行 | 卷三前半·邦域与九族 | 邦域重合，**含 2 处独有设定** | ①**龙裔与真龙关系**；②**种族四原则** → `lore/powers-and-factions.md` 第一节 |
| 第 158–175 行 | 卷三中段·社会与成年律 | **含关键法律与仪式细则** | 通用语源自旧帝国官话；**未满 17 岁童雏庇护与监护宗族连带**；部族**授刃礼** → `lore/powers-and-factions.md` 第二节 |
| 第 177–194 行 | 教会与神明 | **母本含 3 处独有暗线** | ①**教派相对律**；②**神学暗线**（隐道不靠神恩亦能登顶）；③边地古俗**“野性与狩猎”**；④六类神明示例模板 → `lore/pantheon-and-cults.md` 卷首与第一节第 10 条 |
| 第 195–206 行 | 公会与冒险者 F–S 评级 | **含跳级担保细则** | 声誉独立结算；**跨级跳升须公会高层或名宿具名担保（负连带责任）** → `lore/powers-and-factions.md` 第二节 2 |
| 第 207–215 行 | 战争现实 | **母本完全独有段落** | **粮、钱、士气缺一必败；战后往往比战时更危险** → `lore/nations-and-realms.md` “战争现实法则” |
| 第 217–250 行 | 卷五·超凡力量 | **含巫术、魂法、隐道独有定义** | **巫术四灵**、**魂法三阶**（观魂→铸魂→燃魂）、**隐道与隐世之境**、隐世家族 → `lore/powers-and-factions.md` 第三节 |
| 第 251–278 行 | 元素与奥术 | 剔除旧枯竭后，**含独有神学接口** | 浅尝与深修分野、自由兼修、**奥术光明与神术圣光“同名不同源”** → `lore/arcane-schools-and-reagents.md` 第一节 |
| 第 279–290 行 | 传世器物法则 | **含器灵 NPC 定案** | **凡具器灵的觉醒奇物本身作为独立 NPC 建档** → `lore/powers-and-factions.md` 第五节与 `lore/legends-and-relics.md` 卷首 |
| 第 291–304 行 | 魔兽与地下城、异界 | **含生态失衡与异界政治定案** | 生态失衡与地下城枯竭 → `lore/ecology-and-bestiary.md`；**魔界三分天下**与“一界一律” → `lore/planes-and-cosmology.md` 与 `lore/powers-and-factions.md` 第六节 |
| 第 306–341 行 | 卷六·暗线与封锁 | 删除十二席后，**含 2 条核心历史律** | ①**灾厄演化原则**；②**传说形成律** → `lore/history-and-eras.md` 第五节；沉眠的劫级 → `secret/gm-dossier.md` 第二节（候选真相） |
| 第 343–433 行 | 卷七·开局接口 | 叙事素材收编，面板删除 | 三层建局表单与第一场景下锚 → `lore/powers-and-factions.md` 第六节 3；状态面板、存档与续局、月度世界动态模板已被 `SCHEMA.md`（`state.json` + `world.json` + `world status`）取代（旧机制） |

---

## 三、旧机制剥离与设定矛盾修正核销摘要

1. **9 类反 D&D 2024 旧机制清零**（方案 v2 第三节第 3 小节）：法术生理枯竭/禁说法术位/耗时耗材翻倍；额外 V/S/M 门槛与铁护手禁施法；施法失败检定反噬；强制额外烧金币/魔晶耗材；高阶元素必然终身肉体畸变（改为传言）；信徒数值减伤与破戒自动暴毙（改为教会追索）；法则禁止复活（改为 2024 合法可用、仅有宗教政治后果）；怪物弱点与 2024 数据卡冲突（拟身怪等已纠正）；失真物价（按 PHB 2024 重标）。
2. **十二席与矛盾对齐**（方案 v2 第三节第 5 小节）：删除全部十二席名录及人物引用；奇物持有者改为“下落成谜/多方争夺”；极北异象归因于永冬王座待查成因（候选真相，无苏醒王者）；统一浮空孤城名为**苍穹之冠**（对外缓慢下沉两寸 / 内档候选真相为锚链将断、脱钩飘向虚空）；统一冬线南移速度为“往年每年一寸、今年骤然加速至半里”；工匠族统一称 `侏儒` (#544)，“地精”专指 Goblin 怪物。
3. **货币措辞**：统一铜币记账方案仍待仓库主人确认，确认前各切片不作定案表述。

---

## 四、删除项清单

> 仅限两类原因：`十二席` 或 `旧机制`。原仓其余标题、加粗与【】专名均已在新文件中原文出现或以“原称：××”标注（由 W1.6 自动核验）。

| 原文件 | 原标题或加粗专名 | 删除原因 | 说明 |
| :--- | :--- | :--- | :--- |
| arcane-schools-and-reagents.md | 剑火纪元 · 八大奥术学派、元素质料驱动与施法反噬手记 (Arcane Schools, Elemental Substrates & Spell Burnout) | 旧机制 | 卷标题含“施法反噬/Spell Burnout”；新卷标题去掉枯竭机制字样，内容全保留 |
| arcane-schools-and-reagents.md | 五、法术位极限消耗的生理枯竭机制 (Spell Burnout) | 旧机制 | 旧机制#1 法术生理枯竭，按 2024 法术位结算 |
| arcane-schools-and-reagents.md | 阶段 1：轻度疲劳（低阶耗尽，神经灼热） | 旧机制 | 同上，枯竭阶段 |
| arcane-schools-and-reagents.md | 阶段 2：中度枯竭（中阶耗尽，反噬溢出） | 旧机制 | 同上，枯竭阶段 |
| arcane-schools-and-reagents.md | 阶段 3：绝对透支（高阶搏命，触媒炸裂） | 旧机制 | 同上，枯竭阶段 |
| arcane-schools-and-reagents.md | 废除抽象数字，全面转向神经与肉体枯竭 | 旧机制 | 枯竭机制导语 |
| arcane-schools-and-reagents.md | 梯级递进的肉体衰竭、触媒崩毁与高阶侵蚀 | 旧机制 | 枯竭机制导语 |
| arcane-schools-and-reagents.md | 生理表现 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 手势反馈 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 感官异变 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 行动影响 | 旧机制 | 枯竭阶段子标签（数值惩罚） |
| arcane-schools-and-reagents.md | 器物破损 | 旧机制 | 枯竭阶段子标签（触媒强制损毁） |
| arcane-schools-and-reagents.md | 精神痛苦 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 生理崩坏 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 触媒崩毁 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 神魂断裂 | 旧机制 | 枯竭阶段子标签 |
| arcane-schools-and-reagents.md | 高阶双重枷锁 | 旧机制 | 枯竭叠加高阶侵蚀的强制惩罚；十五条价签原句已逐字保留为无机制传言 |
| powers-and-factions.md | 高阶八元（高阶之门必有不可逆终身侵蚀） | 旧机制 | 旧机制#5 强制终身侵蚀；“高阶八元”本身与八元名目全部保留 |
| martial-and-classes.md | 1. 擦掠 (Cleave · 战斧、巨剑、戟) | 旧机制 | 错译/错配武器精通，已按 2024 标准译名重写 |
| martial-and-classes.md | 2. 削击 (Graze · 双手巨剑、重剑、长刀) | 旧机制 | 同上 |
| martial-and-classes.md | 3. 迅击 (Nick · 短剑、弯刀、捕兽匕首) | 旧机制 | 同上 |
| martial-and-classes.md | 4. 推击 (Push · 重锤、长矛、巨棒、骑枪) | 旧机制 | 同上 |
| martial-and-classes.md | 5. 钝击减力 (Sap · 钉头锤、连枷、闷棍) | 旧机制 | 同上 |
| martial-and-classes.md | 6. 缓足 (Slow · 长鞭、短弓、飞斧、投枪) | 旧机制 | 同上 |
| martial-and-classes.md | 7. 绊摔 (Topple · 战斗戟、重型长柄刀、流星锤) | 旧机制 | 同上 |
| martial-and-classes.md | 8. 扰目 (Vex · 细剑、手弩、单手长剑) | 旧机制 | 同上 |
| literary-pipeline-contract.md | 极差必须 > 15 字 | 旧机制 | de-ai-scan 机械句长教条 |
| starting-interface.md | 四、 元指令输出接口 | 旧机制 | 纯文本面板指令，由 `SCHEMA.md` 与 `world status` 取代 |
| starting-interface.md | 1. /状态 (Status Panel) | 旧机制 | 同上 |
| starting-interface.md | 2. /存档 (Save Game) | 旧机制 | 同上，由 `scripts/state.js` 存档取代 |
| starting-interface.md | 3. /月报 (Monthly Chronicle) | 旧机制 | 同上，由 SCHEMA 世界时钟取代 |
| world-setting.md | 存档与续局 | 旧机制 | 面板模板章节 |
| world-setting.md | 月度世界动态 | 旧机制 | 面板模板章节；演化八线刻度本身已保留 |
| world-setting.md | 存档输出模板（照此结构逐段填充，不增删段） | 旧机制 | 面板模板 |
| world-setting.md | 法术位极限机制 | 旧机制 | 旧机制#1 |
| world-setting.md | 各线阶段刻度（GM 沿刻度推进，/月报 按当前阶段输出；跨阶段需世界内事件支撑，不凭空跳档） | 旧机制 | 仅删 `/月报` 面板耦合措辞；刻度表全文保留于 `lore/history-and-eras.md` 第四节 |
| world-setting.md | 这个世界不是对上述任何作品的模仿，它有自己的具体质感（浮空城的粮食软肋、地精的魔导工学、五道法统的社会位置），一切描写从设定集推导，而非从作品记忆里搬 | 旧机制 | 第 14 行总锚**句意完整保留**于 `capsule.md` 与 `lore/world-rules.md`，仅按方案 v2 工匠族更名清理把“地精的魔导工学”改为“侏儒的魔导工学”，故原句字面不再出现 |
| world-setting.md | 当代传奇名录（十二席） | 十二席 | 十二席名录 |
| world-setting.md | 十二席数满，天下太平；数不满，就要出大事。近年来无论怎么数，都数不满 | 十二席 | 十二席世界定律 |
| gm-dossier.md | 二、当代传奇名录（十二席暗流） | 十二席 | 十二席档案 |
| gm-dossier.md | 世界定律 | 十二席 | 十二席“数满/数不满”定律标签 |
| gm-dossier.md | 灰烬圣女 · 薇兰 | 十二席 | 十二席人物 |
| gm-dossier.md | 断岳 · 戈尔姆 | 十二席 | 十二席人物 |
| gm-dossier.md | 九戒 · 奥义斯 | 十二席 | 十二席人物 |
| gm-dossier.md | 白鲸女王 · 玛尔戈 | 十二席 | 十二席人物 |
| gm-dossier.md | 无声王 | 十二席 | 十二席人物 |
| gm-dossier.md | 盲眼先知 · 薇拉 | 十二席 | 十二席人物 |
| gm-dossier.md | 白甲 · 卡莱恩 | 十二席 | 十二席人物 |
| gm-dossier.md | 三个僭主 | 十二席 | 十二席人物 |
| gm-dossier.md | 守泉老人 | 十二席 | 十二席人物 |
| gm-dossier.md | 永冬之王 | 十二席 | 十二席人物；极北异象改为永冬王座候选成因 |
| gm-dossier.md | 数不满的席位 | 十二席 | 十二席锁表行 |
| gm-dossier.md | 十二席名录真伪与空席 | 十二席 | 十二席锁表行 |
| legends-and-relics.md | 剑火纪元 · 十二席当代传奇档案与失落器道账簿 (Legends, Twelve Seats & Artifact Ledgers) | 十二席 | 卷标题含十二席；器道账簿内容全保留 |
| legends-and-relics.md | 一、十二席当代活传奇深度绝密档案 | 十二席 | 十二席档案 |
| legends-and-relics.md | 席位 1：灰烬圣女 · 薇兰 (Weilan the Ash-Saint) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 2：断岳 · 戈尔姆 (Gorm the Peak-Cleaver) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 3：九戒 · 奥义斯 (Auris of the Nine Rings) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 4：白鲸女王 · 玛尔戈 (Queen Margo of the White Whale) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 5：无声王 (The Voiceless King) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 6：盲眼先知 · 薇拉 (Vera the Sightless Seer) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 7：白甲 · 卡莱恩 (Calean the White-Mail) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 8：三个僭主 (The Three Usurpers) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 9：守泉老人 (The Well-Keep Elder) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 10：永冬之王 (The Ever-Winter Sovereign) | 十二席 | 十二席人物 |
| legends-and-relics.md | 席位 11–12：永缺的空席 (The Calamity Void) | 十二席 | 十二席空席 |
| legends-and-relics.md | 外貌体征与感官 | 十二席 | 十二席人物档案子标签 |
| legends-and-relics.md | 现身地点与行踪 | 十二席 | 十二席人物档案子标签 |
| legends-and-relics.md | 深层动机与真面目 | 十二席 | 十二席人物档案子标签 |

---

## 五、新增实体清单

> 新文件中原仓没有的专名。“合并”= 初版新编内容描述同一地方或同类势力，已并入原名下作素材（传说/可选）；“新增”= 描述新空间/新组织/新谜团或新增结构小节，均标为候选/可选。

| 专名 | 处理类型 | 所在新文件 | 并入原名或新增说明 |
| :--- | :--- | :--- | :--- |
| 诺德 | 合并 | lore/nations-and-realms.md、capsule.md | 并入北境霜荒 · 氏族要塞盟军（素材·传说/可选） |
| 卡斯蒂亚 | 合并 | lore/nations-and-realms.md、capsule.md | 并入圣座同盟 · 灰岩十一邦 |
| 灰衣裁判庭 | 合并 | lore/nations-and-realms.md | 并入圣座同盟异端裁判体系 |
| 奥术高塔同盟 | 合并 | lore/nations-and-realms.md | 并入高塔议会 · 埃瑟加德 |
| 星环评议会 | 合并 | lore/nations-and-realms.md | 并入高塔议会 |
| 自由港联盟 | 合并 | lore/nations-and-realms.md | 并入铁锚自由同盟与万门海湾 |
| 碎浪兄弟会 | 合并 | lore/nations-and-realms.md | 并入铁锚自由同盟与万门海湾（外海私掠船主自号） |
| 瓦尔德 | 合并 | lore/nations-and-realms.md、capsule.md | 并入铁锚自由同盟与万门海湾 |
| 金秤商业同盟 | 合并 | lore/nations-and-realms.md | 瓦尔德联省的汇票与船闸商盟，并入铁锚自由同盟与万门海湾 |
| 侏儒精算托拉斯 | 合并 | lore/nations-and-realms.md、capsule.md | 原称：地精精算托拉斯，按工匠族更名 |
| 铁炉 | 合并 | lore/nations-and-realms.md、capsule.md | 并入熔火裂隙与深渊黑铁王宫 |
| 怨恨石册 | 合并 | lore/nations-and-realms.md | 并入熔火裂隙矮人宗族记仇传统 |
| 腐殖泥沼 | 合并 | lore/nations-and-realms.md、capsule.md | 并入沉日绿沼与旧行省自治公社 |
| 渊喉裂谷 | 合并 | lore/nations-and-realms.md | 并入哀嚎铁壁与第九裂口 |
| 翡翠林冠 | 新增 | lore/nations-and-realms.md 等 | 新空间（新增候选区域/可选） |
| 灰烬荒原诸部 | 新增 | lore/nations-and-realms.md 等 | 新空间（新增候选区域/可选） |
| 渴血裂喉教团 | 新增 | lore/pantheon-and-cults.md | 新增候选邪教（可选） |
| 蜕皮长生会 | 新增 | lore/pantheon-and-cults.md | 新增候选邪教（可选） |
| 碎链虚空派 | 新增 | lore/pantheon-and-cults.md | 新增候选邪教（可选） |
| 封灰派 | 合并 | lore/pantheon-and-cults.md、secret/gm-dossier.md | 并入索林教会内部分派（亦称残卷守望会） |
| 残卷守望会 | 合并 | lore/pantheon-and-cults.md | 封灰派别称，并入索林教会 |
| 枯穗派 | 新增 | lore/pantheon-and-cults.md | 泰拉教会内部候选分派（钩子/可选） |
| 零号私井 | 新增 | lore/pantheon-and-cults.md | 深渊升降机行会留白钩子（可选） |
| 星环断锚罗盘 | 新增 | lore/legends-and-relics.md | 候选奇物（可选） |
| 霜铁失衡半秤 | 新增 | lore/legends-and-relics.md | 候选奇物（可选） |
| 索林焦页孤本 | 新增 | lore/legends-and-relics.md | 候选奇物（可选） |
| 渊喉三叠血契戒 | 新增 | lore/legends-and-relics.md | 候选奇物（可选） |
| 星界古锚链 | 新增 | secret/gm-dossier.md | 苍穹脱缰候选真相中的锚链设定（候选） |
| 崩渊虹吸说 | 新增 | secret/gm-dossier.md | 候选历史暗线（可选） |
| 旧帝国绝嗣契约说 | 新增 | secret/gm-dossier.md | 候选历史暗线（可选） |
| 九神沉寂守门说 | 新增 | secret/gm-dossier.md | 候选历史暗线（可选） |
| 战争现实法则 | 新增 | lore/nations-and-realms.md | 结构小节标题，承载母本“战争现实”原文 |
| 已知大陆之外 | 新增 | lore/nations-and-realms.md | 地图边缘开放方向提示小节（不写死） |
| 当代演化实例素材 | 新增 | lore/history-and-eras.md | 结构小节标题，承载演化八线挂接素材 |
| 核心定性与母本细则 | 新增 | lore/powers-and-factions.md | 结构小节标题，承载母本五道细则 |
