# D&D 官方完整短冒险与 38 部经典模组 DM 主持指南

本指南将规则库内的模组与冒险资源严格划分为两大类：**【第一部分：DMG 2024 官方完整短冒险（含完整剧情正文与配套主持包）】** 与 **【第二部分：5e 38 部官方模组附录资源（仅含怪物/NPC/魔法物品/手记附录，无章节剧情正文）】**，确保 DM 选本与调取时零幻觉、零错配。

---

## 一、DMG 2024 官方完整短冒险（灰鹰 1→7 级五连战役｜含完整正文）

《城主指南 2024》第四章收录了 **5 篇具有完整区域剧情、遭遇配置、环境互动与宝藏奖励的官方范例短冒险**，本仓库已为全部 5 篇配备了含 ASCII 战术地图与 1/2/4 人动态缩放表的专属主持包：

### 1. 《秽染溪泉》(The Fouled Stream) — 1 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-1-fouled-stream.md`
- **风格与剧情：** 野外追踪 + 洞窟净化。受上厄里村住民或自由城市灰鹰委托，逆流调查支流污染并偶遇树人**波罗果芙**（获赠魔法橡子），破坏水中外来脑状真菌与**心能灰泥怪**，通关获赠魔法物品**《鲜花法杖》**。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "秽染溪泉"
  node <SKILL_DIR>/scripts/lookup.js monster "树人" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "枯枝怪" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "啵灵蛙武者" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "心能灰泥怪" --brief
  node <SKILL_DIR>/scripts/lookup.js item "鲜花法杖" --brief
  ```

### 2. 《矿洞惊魂》(Miner Difficulties) — 2 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-2-miner-difficulties.md`
- **风格与剧情：** 废弃银矿调查 + 多解法地下城探索。受黑石镇矮人镇长**克里斯崔蒂·裂砧 (Kristryd Splitanvil)** 雇佣，杀掉或驱离迫使矿工弃井的怪物（可清开底层东南角碎石让**恐爪怪**自行返回幽暗地域），奖励 500 GP 黄玉。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "矿洞惊魂"
  node <SKILL_DIR>/scripts/lookup.js monster "锈蚀怪" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "凝胶方块" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "恐爪怪" --brief
  ```

### 3. 《有翼之神》(The Winged God) — 3 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-3-winged-god.md`
- **风格与剧情：** 营救被绑镇民 + 屠龙初体验。在石冢山地追踪狗头人进入地下洞窟，接受厌倦恶龙暴政的狗头人求援，解救人质并击败被奉为“有翼之神”的**红龙雏龙**。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "有翼之神"
  node <SKILL_DIR>/scripts/lookup.js monster "狗头人武者" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "带翼狗头人" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "红龙雏龙" --brief
  ```

### 4. 《兽之角冠》(Horns of the Beast) — 5 级官方完整冒险 ⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-4-horns-of-the-beast.md`
- **风格与剧情：** 抢滩登陆 + 恐龙丛林 + 恶魔遗迹背叛。护送商人梅尔奇斯前往艾美迪奥丛林寻访埃乌兹神殿遗迹，突破鲨华鱼人、丛林恐龙、流沙巨鳄与巴弗灭的牛头人防线，粉碎梅尔奇斯夺取角冠化身**狂蟾魔**的阴谋，赢取《次元袋》与 2,000 GP 贸易金属条等重宝。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "兽之角冠"
  node <SKILL_DIR>/scripts/lookup.js monster "鲨华祭司" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "巴弗灭的牛头人" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "狂蟾魔" --brief
  node <SKILL_DIR>/scripts/lookup.js item "次元袋" --brief
  ```

### 5. 《北风舞会》(Boreal Ball) — 7 级官方完整冒险 ⭐⭐⭐⭐⭐
- **主持包路径：** `resources/starter-adventure/dmg-5-boreal-ball.md`
- **风格与剧情：** 妖精荒野冰之宫殿社交 + 舞池解围。与半羊人欢庆之主、树精、皮克精、绿鬼婆、魔法师比试周旋，击退闯入舞厅挑衅的大地精长官瓦卡，赢取【北风舞会护咒】。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "北风舞会"
  node <SKILL_DIR>/scripts/lookup.js monster "半羊人欢庆之主" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "绿鬼婆" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "大地精长官" --brief
  ```

---

## 二、5e 经典战役模组附录资源指南（⚠️ 仅含怪物/宝物/手记附录，无章节剧情正文）

> **⚠️ 重要诚实声明：** 5echm 规则库中的 `模组/` 目录仅收录了以下 38 部 5e 官方长篇模组的**附录资源（专属怪物/NPC数据卡、专属魔法物品、协力者规则与玩家手记）**，**并未收录各章房间描述与剧情正文**。若玩家选择以下题材，DM 需告知此范围，并结合库内真实怪物/物品数据卡按经典主线框架进行改编主持：

### 1. 《凡达林的失落矿坑》(Lost Mine of Phandelver)
- **库内可用附录：** 专属怪物与 NPC 图鉴（黑蜘蛛那兹纳尔、红标帮恶棍、莫메斯克等 10 项）+ 专属魔法物品（光耀武器、蜘蛛法杖等）。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "矿坑"
  node <SKILL_DIR>/scripts/lookup.js monster "黑蜘蛛" --brief
  node <SKILL_DIR>/scripts/lookup.js monster "地精武者" --brief
  ```

### 2. 《冰塔峰巨龙》(Dragon of Icespire Peak)
- **库内可用附录：** 协力者（Sidekick）完整规则与预设卡、模组生物图鉴（石矮人、半兽人锚人等）。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "冰塔峰"
  node <SKILL_DIR>/scripts/lookup.js monster "青年白龙" --brief
  ```

### 3. 《施特拉德的诅咒》(Curse of Strahd)
- **库内可用附录：** 鸦阁魔域专属生物与 NPC 图鉴（施特拉德、芭芭·莱萨迦、艾丝美拉达等 25 项）、专属神器与魔法物品（鸦族圣徽/日圣符、太阳剑、血矛等）、施特拉德手记与鬼屋背景。
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "施特拉德"
  node <SKILL_DIR>/scripts/lookup.js monster "施特拉德" --brief
  node <SKILL_DIR>/scripts/lookup.js item "鸦族圣徽" --brief
  node <SKILL_DIR>/scripts/lookup.js item "日圣符" --brief
  ```

### 4. 《深水城：龙金劫》与《博德之门：坠入阿弗纳斯》等其他模组
- **DM 调取指令：**
  ```bash
  node <SKILL_DIR>/scripts/lookup.js module "龙金劫"
  node <SKILL_DIR>/scripts/lookup.js module "坠入阿弗纳斯"
  node <SKILL_DIR>/scripts/lookup.js module "疯法师"
  node <SKILL_DIR>/scripts/lookup.js module "冰风谷"
  node <SKILL_DIR>/scripts/lookup.js module "湮灭之墓"
  ```
