# D&D 官方完整短冒险与 38 部经典模组 DM 主持指南

本指南将规则库内的模组与冒险资源严格划分为两大类：**【第一部分：DMG 2024 官方完整短冒险（含完整剧情正文与配套主持包）】** 与 **【第二部分：5e 38 部官方模组附录资源（仅含怪物/NPC/魔法物品/手记附录，无章节剧情正文）】**，确保 DM 选本与调取时零幻觉、零错配。

---

## 一、DMG 2024 官方完整短冒险（灰鹰 1→7 级五连战役｜含完整正文）

《城主指南 2024》第四章收录了 **5 篇具有完整区域剧情、遭遇配置、环境互动与宝藏奖励的官方范例短冒险**，本仓库已为全部 5 篇配备了含 ASCII 战术地图与 1/2/4 人动态缩放表的专属主持包：

### 1. 《秽染溪泉》(The Fouled Stream) — 1 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-1-fouled-stream.md`
- **风格与剧情：** 野外追踪 + 洞窟净化。受树人**波罗果芙**委托，逆流调查被异界裂隙与心能灰泥怪污染的林间溪泉，通关奖励魔法物品**《鲜花法杖》**。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "秽染溪泉"
  node scripts/lookup.js monster "树人" --brief
  node scripts/lookup.js monster "枯枝怪" --brief
  node scripts/lookup.js monster "啵灵蛙武者" --brief
  node scripts/lookup.js monster "心能灰泥怪" --brief
  node scripts/lookup.js item "鲜花法杖" --brief
  ```

### 2. 《矿洞惊魂》(Miner Difficulties) — 2 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-2-miner-difficulties.md`
- **风格与剧情：** 幽暗矿井搜救 + 地下城探索。受黑石镇矮人镇长**克里斯崔蒂·裂砧**雇佣，深入被幽暗地域生物侵入的银矿搜救矿工，决战**恐爪怪**，奖励 500 GP 黄玉。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "矿洞惊魂"
  node scripts/lookup.js monster "锈蚀怪" --brief
  node scripts/lookup.js monster "凝胶方块" --brief
  node scripts/lookup.js monster "恐爪怪" --brief
  ```

### 3. 《有翼之神》(The Winged God) — 3 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-3-winged-god.md`
- **风格与剧情：** 营救人质 + 屠龙初体验。潜入地热翻涌的发光洞窟，粉碎狗头人部落的狂热崇拜，击败它们奉为神明的**红龙雏龙**。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "有翼之神"
  node scripts/lookup.js monster "狗头人武者" --brief
  node scripts/lookup.js monster "带翼狗头人" --brief
  node scripts/lookup.js monster "红龙雏龙" --brief
  ```

### 4. 《兽之角冠》(Horns of the Beast) — 5 级官方完整冒险 ⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-4-horns-of-the-beast.md`
- **风格与剧情：** 抢滩登陆 + 恐龙丛林 + 恶魔神庙背叛。护送学者梅尔奇斯登岛探寻遗迹，突破鲨华鱼人、流沙巨鳄与巴弗灭的牛头人防线，最终粉碎梅尔奇斯化身**狂蟾魔**的阴谋，赢取《次元袋》与 3,000 GP 金条。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "兽之角冠"
  node scripts/lookup.js monster "鲨华鱼人祭司" --brief
  node scripts/lookup.js monster "巴弗灭的牛头人" --brief
  node scripts/lookup.js monster "狂蟾魔" --brief
  node scripts/lookup.js item "次元袋" --brief
  ```

### 5. 《北风舞会》(Boreal Ball) — 7 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-5-boreal-ball.md`
- **风格与剧情：** 妖精荒野宫廷社交 + 舞池决斗。在三支舞曲内与半羊人、树精、皮克精、绿鬼婆、魔法师周旋积累 6 点声望，击退闯入挑衅的大地精长官瓦卡，赢取【北风舞会护咒】。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "北风舞会"
  node scripts/lookup.js monster "半羊人欢庆之主" --brief
  node scripts/lookup.js monster "绿鬼婆" --brief
  node scripts/lookup.js monster "大地精长官" --brief
  ```

---

## 二、5e 经典战役模组附录资源指南（⚠️ 仅含怪物/宝物/手记附录，无章节剧情正文）

> **⚠️ 重要诚实声明：** 5echm 规则库中的 `模组/` 目录仅收录了以下 38 部 5e 官方长篇模组的**附录资源（专属怪物/NPC数据卡、专属魔法物品、协力者规则与玩家手记）**，**并未收录各章房间描述与剧情正文**。若玩家选择以下题材，DM 需告知此范围，并结合库内真实怪物/物品数据卡按经典主线框架进行改编主持：

### 1. 《凡达林的失落矿坑》(Lost Mine of Phandelver)
- **库内可用附录：** 专属怪物与 NPC 图鉴（黑蜘蛛那兹纳尔、红标帮恶棍、莫메斯克等 10 项）+ 专属魔法物品（光耀武器、蜘蛛法杖等）。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "矿坑"
  node scripts/lookup.js monster "黑蜘蛛" --brief
  node scripts/lookup.js monster "地精武者" --brief
  ```

### 2. 《冰塔峰巨龙》(Dragon of Icespire Peak)
- **库内可用附录：** 协力者（Sidekick）完整规则与预设卡、模组生物图鉴（石矮人、半兽人锚人等）。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "冰塔峰"
  node scripts/lookup.js monster "青年白龙" --brief
  ```

### 3. 《施特拉德的诅咒》(Curse of Strahd)
- **库内可用附录：** 鸦阁魔域专属生物与 NPC 图鉴（施特拉德、芭芭·丽萨嘎、艾丝美拉达等 25 项）、专属神器与魔法物品（鸦族圣徽/日圣符、太阳剑、血矛等）、施特拉德手记与鬼屋背景。
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "施特拉德"
  node scripts/lookup.js monster "施特拉德" --brief
  node scripts/lookup.js item "鸦族圣徽" --brief
  node scripts/lookup.js item "日圣符" --brief
  ```

### 4. 《深水城：龙金劫》与《博德之门：坠入阿弗纳斯》等其他模组
- **DM 调取指令：**
  ```bash
  node scripts/lookup.js module "龙金劫"
  node scripts/lookup.js module "坠入阿弗纳斯"
  node scripts/lookup.js module "疯法师"
  node scripts/lookup.js module "冰风谷"
  node scripts/lookup.js module "湮灭之墓"
  ```
