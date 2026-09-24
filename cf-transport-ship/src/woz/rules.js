// WOZ 规则状态机：纯逻辑、零渲染依赖，可在 node 下直接断言测试。
// 阵营约定：人类侧 = 'GR'（保卫者），变异者侧 = 'BL'（潜伏者）。
import { WOZ, MutantClass, MutantSkill, skillOf, skillDuration , skillCooldownSec } from './config.js';

// xorshift32 确定性随机（同种子同结果，供测试与回放）
export class WozRng {
  constructor(seed) {
    this.s = seed === 0 ? 0x9e3779b9 : seed >>> 0;
    this.next();
  }
  next() {
    let s = this.s;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this.s = s;
    return s;
  }
  int(maxExclusive) { return this.next() % maxExclusive; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

export class WozRules {
  /**
   * @param mode 'infection' | 'revenge'
   * @param playerCount 参战人数（不含尸潮 AI）
   * @param host 宿主回调对象（onMutantConverted/onInfected/onSkillFired/onAvengerTransformed/
   *             onDevoured/onMutantKilledByHuman/onHumanTierUp/onCorpseTide/onResult）
   */
  constructor(mode, playerCount, host) {
    this.mode = mode;
    this.playerCount = playerCount;
    this.host = host;
    this.players = [];
    for (let i = 0; i < playerCount; i++) {
      this.players.push({
        id: i,
        side: 'human',          // 'human' | 'mutant'
        alive: true,
        isMother: false,
        cls: MutantClass.None,
        hp: 0,                  // 变异者血池（人类血量由引擎 100 体系表达）
        maxHp: 0,
        skillCharge: 0,
        skillActive: false,
        skillTimeLeft: 0,
        evoPoints: 0,
        devourCount: 0,
        devourCooldown: 0,
        damageDealt: 0,         // 变异者伤害累计（充能）
        humanDamage: 0,         // 人类伤害累计（复仇者人选）
        infections: 0,
        kills: 0,
        humanSurviveTime: 0,
        tierNotified: 0,
        ultActiveT: 0,          // 人类必杀技剩余时间（V15）
        ultCooldown: 0,
        energy: 0,              // 人类能量 0-100（V46：T/F/V 三级技能）
        frenzyT: 0,             // 战地狂热剩余时间
        revivesLeft: mode === 'revenge' ? WOZ.mutantRevives : 0,
        canRevive: true,
        reviveTimer: 0,
        rebirths: 0,
        isAvenger: false,
      });
    }
    this.phase = 'idle';        // buy | outbreak | battle | roundend | idle
    this.phaseTimeLeft = 0;
    this.result = null;         // 'humansSurvived' | 'allInfected'
    this.avengerUsed = false;
    this.tideSpawned = false;
    this.rng = new WozRng(1);
  }

  state(id) { return this.players[id]; }

  beginRound(seed) {
    this.rng = new WozRng(seed);
    this.avengerUsed = false;
    this.tideSpawned = false;
    this.result = null;
    this.phase = 'buy';
    this.phaseTimeLeft = WOZ.buyTime;
    for (const p of this.players) {
      p.side = 'human';
      p.alive = true;
      p.isMother = false;
      p.cls = MutantClass.None;
      p.hp = 0;
      p.maxHp = 0;
      p.skillCharge = 0;
      p.skillActive = false;
      p.skillTimeLeft = 0;
      p.evoPoints = 0;
      p.devourCount = 0;
      p.devourCooldown = 0;
      p.damageDealt = 0;
      p.humanDamage = 0;
      p.infections = 0;
      p.kills = 0;
      p.humanSurviveTime = 0;
      p.tierNotified = 0;
      p.revivesLeft = this.mode === 'revenge' ? WOZ.mutantRevives : 0;
      p.canRevive = true;
      p.reviveTimer = 0;
      p.rebirths = 0;
      p.isAvenger = false;
    }
  }

  tick(dt) {
    switch (this.phase) {
      case 'buy':
        this.phaseTimeLeft -= dt;
        if (this.phaseTimeLeft <= 0) this.startOutbreak();
        break;
      case 'outbreak':
        this.phase = 'battle';
        this.phaseTimeLeft = WOZ.battleTime;
        break;
      case 'battle':
        this.tickBattle(dt);
        break;
      case 'roundend':
        this.phaseTimeLeft -= dt;
        if (this.phaseTimeLeft <= 0) this.phase = 'idle';
        break;
    }
  }

  tickBattle(dt) {
    this.phaseTimeLeft -= dt;
    if (this.phaseTimeLeft <= 0) {
      this.phaseTimeLeft = 0;
      this.finishRound('humansSurvived');
      return;
    }
    // 变异者全灭且无人等待复活 → 人类立即获胜
    if (this.mutantsAlive() === 0 && !this.players.some((p) => p.side === 'mutant' && p.reviveTimer > 0)) {
      this.finishRound('humansSurvived');
      return;
    }
    for (const p of this.players) {
      if (!p.alive) {
        this.tickRevive(p, dt);
        continue;
      }
      if (p.side === 'mutant') this.tickMutant(p, dt);
      else this.tickHuman(p, dt);
    }
    if (this.mode === 'revenge' && !this.avengerUsed) this.tryTriggerAvenger();
    if (this.mode === 'revenge' && !this.tideSpawned && this.phaseTimeLeft <= WOZ.tideTimeLeft) {
      this.tideSpawned = true;
      this.host.onCorpseTide(WOZ.tideCount);
    }
  }

  tickMutant(p, dt) {
    p.devourCooldown = Math.max(0, p.devourCooldown - dt);
    if (!p.skillActive) {
      p.skillCharge = Math.min(1, p.skillCharge + dt / skillCooldownSec(p.cls)); // 各技能独立冷却
    } else {
      p.skillTimeLeft -= dt;
      if (p.skillTimeLeft <= 0) p.skillActive = false;
    }
  }

  tickHuman(p, dt) {
    p.humanSurviveTime += dt;
    p.ultActiveT = Math.max(0, p.ultActiveT - dt);
    p.ultCooldown = Math.max(0, p.ultCooldown - dt);
    p.frenzyT = Math.max(0, (p.frenzyT || 0) - dt);
    p.energy = Math.min(100, p.energy + dt * WOZ.energyPerSecond); // 时间充能（V46）
    const tier = this.humanTier(p.id);
    if (tier > p.tierNotified) {
      p.tierNotified = tier;
      this.host.onHumanTierUp(p.id, tier);
    }
  }

  // 人类能量三级技能（V46，原作 T/F/V）：T 战术装填 / F 战地狂热 / V 必杀技·狂暴
  humanEnergy(id) {
    return this.players[id]?.energy || 0;
  }

  addEnergy(id, amount) {
    const p = this.players[id];
    if (p && p.side === 'human') p.energy = Math.min(100, p.energy + amount);
  }

  tryEnergySkill(id, level) {
    const p = this.players[id];
    if (this.phase !== 'battle' || !p || p.side !== 'human' || !p.alive || p.isAvenger) return false;
    const cost = level === 'T' ? WOZ.energyCostT : level === 'F' ? WOZ.energyCostF : WOZ.energyCostV;
    if (p.energy < cost) return false;
    if (level === 'F' && p.frenzyT > 0) return false;
    p.energy -= cost;
    if (level === 'F') p.frenzyT = WOZ.energyFrenzyDuration;
    if (level === 'V') p.ultActiveT = WOZ.humanUltDuration;
    return true;
  }

  // 人类伤害倍率：三档威力 + 必杀技期间狂暴
  humanDamageBoost(id) {
    const p = this.players[id];
    if (!p || p.side !== 'human') return 1;
    if (p.ultActiveT > 0) return WOZ.humanUltDamage;
    return this.humanTier(id) >= 3 ? WOZ.humanTier3Damage : 1;
  }

  tickRevive(p, dt) {
    if (p.reviveTimer <= 0) return;
    p.reviveTimer -= dt;
    if (p.reviveTimer <= 0) {
      p.rebirths++;
      p.alive = true;
      p.maxHp = this.baseHp(p.cls) * Math.pow(WOZ.rebirthHpMul, p.rebirths);
      p.hp = p.maxHp;
      p.skillCharge = 0.5;
      this.host.onMutantConverted(p.id, p.cls, false, true);
    }
  }

  baseHp(p) {
    if (p.cls === MutantClass.Mother) return WOZ.motherHp;
    if (p.cls === MutantClass.Devourer) return WOZ.devourerHp;
    if (p.cls === MutantClass.Tangler) return WOZ.tanglerHp;
    if (p.cls === MutantClass.Bomber) return WOZ.bomberHp;
    if (p.cls === MutantClass.Crawler) return WOZ.crawlerHp;
    return WOZ.childHp;
  }

  startOutbreak() {
    this.phase = 'outbreak';
    const mothers = Math.max(1, Math.floor(this.playerCount * WOZ.mothersPerFive / 5));
    const candidates = this.players.map((_, i) => i);
    this.rng.shuffle(candidates);
    for (let i = 0; i < mothers; i++) this.convertToMutant(candidates[i], MutantClass.Mother, true);
  }

  effectiveMaxHp(p) {
    return p.side === 'mutant'
      ? p.maxHp + p.evoPoints * WOZ.evoHpPerPoint + (this.evoStage(p) >= 3 ? WOZ.evoStageHpBonus : 0)
      : 100;
  }

  // 进化阶段：0 基础 / 1 攻击进化 / 2 防御进化 / 3 特殊进化
  evoStage(p) {
    const n = p.devourCount || 0;
    let stage = 0;
    for (const k of WOZ.evoStageDevours) if (n >= k) stage++;
    return stage;
  }

  convertToMutant(id, cls, isMother, rebirth = false) {
    const p = this.players[id];
    p.side = 'mutant';
    p.cls = cls;
    p.isMother = isMother;
    p.alive = true;
    p.skillActive = false;
    p.skillTimeLeft = 0;
    p.skillCharge = 1; // 感染/再变异后技能立即可用（原作：使用后进入冷却，槽满再放）
    p.devourCooldown = 0;
    if (!rebirth) {
      p.maxHp = this.baseHp(p);
      p.hp = p.maxHp;
    }
    this.host.onMutantConverted(id, cls, isMother, rebirth);
  }

  // 子体自选职业（母体不可改）。已变身者可重选，血池按新职业重置。
  setMutantClass(id, cls) {
    const p = this.players[id];
    if (p.side !== 'mutant' || p.isMother) return false;
    if (cls === MutantClass.None || cls === MutantClass.Mother) return false;
    if (p.cls === cls) return false;
    p.cls = cls;
    p.maxHp = this.baseHp(p) * Math.pow(WOZ.rebirthHpMul, p.rebirths);
    p.hp = Math.min(p.hp, p.maxHp);
    this.host.onMutantClassChanged(id, cls);
    return true;
  }

  // 引擎上报死亡。attackerId 为 -1 表示无归属（环境伤害）。
  reportDeath(victimId, attackerId) {
    if (this.phase !== 'battle' && this.phase !== 'outbreak') return;
    const victim = this.players[victimId];
    const attacker = attackerId >= 0 && attackerId < this.playerCount ? this.players[attackerId] : null;
    const attackerMutantSide = attackerId >= 0 && this.isMutantSide(attackerId);
    const attackerAvenger = attacker !== null && attacker.isAvenger;

    victim.alive = false;
    victim.skillActive = false;

    if (victim.side === 'human') {
      if (attackerMutantSide && attacker) {
        attacker.infections++;
        if (attacker.isMother) {
          attacker.hp = Math.min(this.effectiveMaxHp(attacker), attacker.hp + WOZ.motherInfectHeal);
          attacker.skillCharge = Math.min(1, attacker.skillCharge + WOZ.devourChargeBonus);
        } else {
          attacker.skillCharge = Math.min(1, attacker.skillCharge + WOZ.devourChargeBonus * 0.5);
        }
      }
      this.convertToMutant(victimId, MutantClass.Nightrunner, false);
      this.host.onInfected(victimId, attackerId);
    } else {
      if (attackerAvenger) victim.canRevive = false;
      if (this.mode === 'revenge' && victim.canRevive && victim.revivesLeft > 0) {
        victim.revivesLeft--;
        victim.reviveTimer = WOZ.mutantReviveDelay;
      }
      if (attacker && attacker.side === 'human') {
        attacker.kills++;
        this.host.onMutantKilledByHuman(victimId, attackerId);
      }
    }

    if (this.humansAlive() === 0 && this.result === null) this.finishRound('allInfected');
  }

  // 引擎上报实际伤害（用于充能/复仇者人选统计）
  reportDamage(attackerId, victimId, amount) {
    if (this.phase !== 'battle' || amount <= 0 || attackerId < 0 || attackerId >= this.playerCount) return;
    const p = this.players[attackerId];
    if (p.side === 'mutant') {
      p.damageDealt += amount;
      p.skillCharge = Math.min(1, p.skillCharge + amount * WOZ.skillChargePerDamage);
    } else {
      p.humanDamage += amount;
      p.energy = Math.min(100, p.energy + amount * WOZ.energyPerDamage); // 伤害充能（V46）
    }
  }

  tryDevour(mutantId, corpseId) {
    const p = this.players[mutantId];
    if (this.phase !== 'battle' || !p.alive || p.side !== 'mutant') return false;
    if (p.devourCooldown > 0 || corpseId < 0 || corpseId >= this.playerCount || corpseId === mutantId) return false;
    const corpse = this.players[corpseId];
    if (corpse.alive || corpse.side !== 'mutant') return false; // 原作：只吞同伴尸体
    const cap = this.effectiveMaxHp(p) * WOZ.devourCapFactor;
    p.hp = Math.min(cap, p.hp + WOZ.devourHeal);
    p.evoPoints++;
    p.devourCount++;
    p.devourCooldown = WOZ.devourCooldown;
    p.skillCharge = Math.min(1, p.skillCharge + WOZ.devourChargeBonus);
    this.host.onDevoured(mutantId, corpseId);
    return true;
  }

  tryUseSkill(id) {
    const p = this.players[id];
    if (this.phase !== 'battle' || !p.alive || p.side !== 'mutant') return false;
    if (p.cls === MutantClass.None) return false;
    if (skillOf(p.cls) === MutantSkill.None) return false; // 纯属性型（爬行者）无技能
    if (p.skillActive || p.skillCharge < 1) return false;
    p.skillCharge = 0;
    p.skillActive = true;
    p.skillTimeLeft = skillDuration(p.cls);
    this.host.onSkillFired(id, skillOf(p.cls));
    return true;
  }

  // ---- 查询 ----

  humansAlive() {
    return this.players.filter((p) => p.alive && p.side === 'human').length;
  }

  mutantsAlive() {
    return this.players.filter((p) => p.alive && p.side === 'mutant').length;
  }

  isMutantSide(id) {
    if (id >= 0 && id < this.playerCount) return this.players[id].side === 'mutant';
    return true; // 尸潮 AI 视作变异者侧
  }

  isAvenger(id) {
    return id >= 0 && id < this.playerCount && this.players[id].isAvenger;
  }

  avengerId() {
    return this.players.findIndex((p) => p.isAvenger);
  }

  clawDamage(id, heavy) {
    let dmg = heavy ? WOZ.clawHeavy : WOZ.clawLight;
    if (id >= 0 && id < this.playerCount) dmg *= this.damageMultiplier(this.players[id]);
    return dmg;
  }

  damageMultiplier(p) {
    let m = 1 + p.evoPoints * WOZ.evoDamagePerPoint;
    if (this.evoStage(p) >= 1) m *= WOZ.evoStageAtk; // 一阶：攻击进化
    if (p.rebirths > 0) m *= Math.pow(WOZ.rebirthDamageMul, p.rebirths);
    return m;
  }

  // 二阶：防御进化（受到伤害减免）
  evoDamageReduction(p) {
    return this.evoStage(p) >= 2 ? WOZ.evoStageDef : 0;
  }

  isSkillActive(id) {
    return id >= 0 && id < this.playerCount && this.players[id].skillActive;
  }

  // 变异者移速倍率（职业 + 疾冲 + 母体狂暴咆哮）
  motherRageActive() {
    return this.players.some((p) => p.isMother && p.alive && p.skillActive);
  }

  mutantSpeedMultiplier(id) {
    const p = this.players[id];
    if (!p) return WOZ.mutantSpeed; // 尸潮 AI 等非规则层角色
    let m = WOZ.mutantSpeed;
    if (p.cls === MutantClass.Nightrunner) m += WOZ.nightrunnerSpeed;
    if (p.cls === MutantClass.Crawler) m -= WOZ.crawlerSlow; // 巨躯迟缓
    if (p.skillActive && p.cls === MutantClass.Nightrunner) m *= WOZ.dashSpeed * 0.55;
    if (this.motherRageActive() && p.cls !== MutantClass.Mother) m *= 1.25;
    if (p.skillActive && p.cls === MutantClass.Mother) m *= 1.35;
    if (this.evoStage(p) >= 3) m *= WOZ.evoStageSpeed; // 三阶：特殊进化移速
    return m;
  }

  humanSpeedMultiplier(id) {
    const p = this.players[id];
    if (!p) return 1;
    let m = 1 + this.humanTier(id) * WOZ.humanSpeedPerTier;
    if (p.frenzyT > 0) m *= 1.1; // 战地狂热（V46）
    if (p.isAvenger) m += WOZ.avengerSpeed - 1;
    return m;
  }

  humanTier(id) {
    const p = this.players[id];
    if (p.side !== 'human') return 0;
    const byTime = Math.floor(p.humanSurviveTime / WOZ.humanTierSeconds);
    const byKills = Math.floor(p.kills / WOZ.humanKillsPerTier);
    return Math.min(WOZ.humanMaxTier, byTime + byKills);
  }

  humanDamageReduction(id) {
    return this.humanTier(id) * WOZ.humanDamageReductionPerTier;
  }

  // ---- 内部 ----

  tryTriggerAvenger() {
    if (this.avengerUsed || this.mode !== 'revenge') return;
    const lowHumans = this.humansAlive() <= WOZ.avengerHumanThreshold;
    const lowTime = this.phaseTimeLeft <= WOZ.avengerTimeThreshold;
    if (!lowHumans && !lowTime) return;
    let best = -1;
    let bestScore = -Infinity;
    this.players.forEach((p, i) => {
      if (p.alive && p.side === 'human') {
        const score = p.humanDamage * 1000 + p.humanSurviveTime;
        if (score > bestScore) { bestScore = score; best = i; }
      }
    });
    if (best < 0) return;
    this.avengerUsed = true;
    const a = this.players[best];
    a.isAvenger = true;
    a.maxHp = WOZ.avengerHp;
    a.hp = WOZ.avengerHp;
    this.host.onAvengerTransformed(best);
  }

  finishRound(result) {
    this.result = result;
    this.phase = 'roundend';
    this.phaseTimeLeft = WOZ.roundEndTime;
    this.host.onResult(result);
  }
}
