// WOZ 规则层断言测试：node src/woz/rules.test.mjs （零依赖，直接跑）
import { WozRules } from './rules.js';
import { WOZ, MutantClass, MutantSkill, skillOf } from './config.js';
import { RANK_XP, RANK_NAMES, rankOf, xpForMatch } from './ranks.js';

let passed = 0, failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name); }
}

class RecordingHost {
  constructor() { this.events = []; this.tideCount = 0; this.result = null; }
  onMutantConverted(id, cls, isMother, rebirth) {
    this.events.push(`convert:${id}:${cls}:${isMother ? 'mother' : rebirth ? 'rebirth' : 'child'}`);
  }
  onMutantClassChanged(id, cls) { this.events.push(`class:${id}:${cls}`); }
  onInfected(v, a) { this.events.push(`infected:${v}:by:${a}`); }
  onSkillFired(id, skill) { this.events.push(`skill:${id}:${skill}`); }
  onAvengerTransformed(id) { this.events.push(`avenger:${id}`); }
  onDevoured(m, c) { this.events.push(`devour:${m}:of:${c}`); }
  onMutantKilledByHuman(v, k) { this.events.push(`mkilled:${v}:by:${k}`); }
  onHumanTierUp(id, tier) { this.events.push(`tier:${id}:${tier}`); }
  onHumanUltimate(id) { this.events.push(`ult:${id}`); }
  onCorpseTide(count) { this.tideCount += count; this.events.push(`tide:${count}`); }
  onResult(result) { this.result = result; this.events.push(`result:${result}`); }
  has(prefix) { return this.events.some((e) => e.startsWith(prefix)); }
}

// 轻量战斗走廊：人类远程输出，变异者追击爪击（把规则层每个分支真实跑一遍）
class ArenaSim {
  constructor(mode, seed) {
    this.host = new RecordingHost();
    this.rules = new WozRules(mode, 10, this.host);
    this.rng = new (Object.getPrototypeOf(this.rules.rng).constructor)(seed);
    this.pos = Array(10).fill(25);
    this.humanHp = Array(10).fill(100);
    this.corpse = Array(10).fill(false);
    this.clawTimer = 0;
  }
  runRound(humanDps = 45, mutantSpeed = 6, maxSeconds = 600) {
    this.rules.beginRound(this.rng.next());
    const dt = 0.1;
    let elapsed = 0, separated = false;
    while (this.rules.phase === 'buy') { this.rules.tick(dt); elapsed++; }
    while (this.rules.phase === 'outbreak' || (this.rules.phase === 'battle' && elapsed < maxSeconds * 10)) {
      if (!separated && this.rules.phase === 'battle') {
        separated = true;
        for (let i = 0; i < 10; i++) {
          this.pos[i] = this.rules.state(i).side === 'mutant' ? 45 : 10;
          if (this.rules.state(i).side === 'human') this.humanHp[i] = 100;
        }
      }
      this.stepCombat(dt, humanDps, mutantSpeed);
      this.rules.tick(dt);
      elapsed++;
      if (this.rules.result) break;
    }
  }
  stepCombat(dt, humanDps, mutantSpeed) {
    this.clawTimer += dt;
    const clawReady = this.clawTimer >= WOZ.clawRate;
    if (clawReady) this.clawTimer = 0;
    for (let h = 0; h < 10; h++) {
      const sh = this.rules.state(h);
      if (!sh.alive || sh.side !== 'human') continue;
      const t = this.nearestMutant(h);
      if (t >= 0 && Math.abs(this.pos[t] - this.pos[h]) < 35) {
        this.applyDamage(h, t, humanDps * dt);
      }
    }
    for (let m = 0; m < 10; m++) {
      const sm = this.rules.state(m);
      if (!sm.alive || sm.side !== 'mutant') continue;
      const speed = mutantSpeed * this.rules.mutantSpeedMultiplier(m);
      const t = this.nearestHuman(m);
      if (t < 0) return;
      if (Math.abs(this.pos[t] - this.pos[m]) > WOZ.clawRange) {
        this.pos[m] += Math.sign(this.pos[t] - this.pos[m]) * speed * dt;
      } else if (clawReady) {
        this.applyDamage(m, t, this.rules.clawDamage(m, false));
      }
    }
  }
  applyDamage(attacker, victim, dmg) {
    const st = this.rules.state(victim);
    this.rules.reportDamage(attacker, victim, dmg);
    if (st.side === 'mutant') {
      st.hp -= dmg;
      if (st.hp <= 0 && st.alive) {
        this.corpse[victim] = true;
        this.rules.reportDeath(victim, attacker);
      }
    } else {
      this.humanHp[victim] -= dmg;
      if (this.humanHp[victim] <= 0) {
        this.humanHp[victim] = 100;
        this.rules.reportDeath(victim, attacker);
      }
    }
  }
  nearestHuman(from) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < 10; i++) {
      const s = this.rules.state(i);
      if (s.alive && s.side === 'human') {
        const d = Math.abs(this.pos[i] - this.pos[from]);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
  nearestMutant(from) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < 10; i++) {
      const s = this.rules.state(i);
      if (s.alive && s.side === 'mutant') {
        const d = Math.abs(this.pos[i] - this.pos[from]);
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }
}

function skipBuy(sim) {
  sim.rules.tick(0.1);
  while (sim.rules.phase === 'buy') sim.rules.tick(0.1);
  sim.rules.tick(0.1); // outbreak -> battle
}
function firstNonMother(sim) {
  for (let i = 0; i < 10; i++) if (!sim.rules.state(i).isMother) return i;
  return -1;
}
function firstMother(sim) {
  for (let i = 0; i < 10; i++) if (sim.rules.state(i).isMother) return i;
  return -1;
}

console.log('== WOZ 规则层断言 ==');

// 1. 感染模式：全员被感染 → 变异者胜
{
  const sim = new ArenaSim('infection', 12345);
  sim.runRound(5, 20);
  check(sim.rules.result === 'allInfected', '感染: 全员感染 → allInfected');
  check(sim.rules.humansAlive() === 0, '感染: 无存活人类');
}

// 2. 感染模式：人类火力压制 → 时间耗尽人类胜
{
  const sim = new ArenaSim('infection', 777);
  sim.runRound(400, 1.5);
  check(sim.rules.result === 'humansSurvived', '感染: 人类存活 → humansSurvived');
  check(sim.rules.humansAlive() >= 1, '感染: 结束时有人类存活');
}

// 3. 母体数量与确定性
{
  const a = new ArenaSim('infection', 42);
  a.rules.beginRound(999); skipBuy(a);
  const mothers = a.rules.players.filter((p) => p.isMother).length;
  check(mothers === 2, `母体: 10 人局 2 名母体 (实际 ${mothers})`);
  const b = new ArenaSim('infection', 42);
  b.rules.beginRound(999); skipBuy(b);
  const same = a.rules.players.every((p, i) => p.isMother === b.rules.state(i).isMother);
  check(same, '母体: 同种子选取一致（确定性）');
}

// 4. 吞噬：回血 + 进化点 + 冷却 + 拒绝条件
{
  const sim = new ArenaSim('infection', 7);
  sim.rules.beginRound(1); skipBuy(sim);
  sim.rules.setMutantClass(2, MutantClass.Devourer);
  const m2 = sim.rules.state(2);
  m2.side = 'mutant'; m2.alive = true; m2.maxHp = 4000; m2.hp = 1000;
  const m3 = sim.rules.state(3);
  m3.side = 'mutant'; m3.alive = false;
  check(sim.rules.tryDevour(2, 3), '吞噬: 有效吞噬成功');
  check(Math.abs(m2.hp - 1300) < 0.01, `吞噬: +300 回血 (实际 ${m2.hp})`);
  check(m2.evoPoints === 1 && m2.devourCount === 1, '吞噬: 进化点+1');
  check(!sim.rules.tryDevour(2, 3), '吞噬: 冷却中拒绝');
  check(sim.rules.tryDevour(2, 4) === false, '吞噬: 非变异者尸体拒绝');
  check(Math.abs(sim.rules.effectiveMaxHp(m2) - (4000 + 50)) < 0.01, '吞噬: 上限血量随进化点提升');
}

// 5. 技能：充能 → 释放 → 不可连放 → 到期失效
{
  const sim = new ArenaSim('infection', 8);
  sim.rules.beginRound(2); skipBuy(sim);
  const id = firstNonMother(sim);
  const m = sim.rules.state(id);
  m.side = 'mutant'; m.alive = true;
  check(sim.rules.setMutantClass(id, MutantClass.Souleater), '技能: 转化后自选噬魂者');
  check(!sim.rules.tryUseSkill(id), '技能: 未充满拒绝');
  sim.rules.reportDamage(id, 0, 950);
  check(m.skillCharge >= 1, '技能: 伤害充能充满');
  check(sim.rules.tryUseSkill(id), '技能: 充满后释放成功');
  check(sim.host.has(`skill:${id}:blindWail`), '技能: 噬魂者触发致盲尖啸');
  check(!sim.rules.tryUseSkill(id), '技能: 激活期间不可再放');
  for (let i = 0; i < 35; i++) sim.rules.tick(0.1);
  check(!sim.rules.isSkillActive(id), '技能: 3.5s 后失效');
}

// 6. 复仇模式：复仇者禁复活 + 普通复活再变异（全程保持战斗期）
{
  const sim = new ArenaSim('revenge', 99);
  sim.rules.beginRound(5); skipBuy(sim);
  const mother = firstMother(sim);
  check(mother >= 0, '复仇: 存在母体');
  const keep = [], targets = [];
  for (let i = 0; i < 10; i++) {
    if (sim.rules.state(i).side !== 'human') continue;
    (keep.length < 3 ? keep : targets).push(i);
  }
  for (const i of targets) {
    sim.humanHp[i] = 100;
    sim.rules.reportDeath(i, mother);
  }
  check(sim.rules.humansAlive() === 3 && sim.rules.phase === 'battle',
    `复仇: 构造完成（转化 ${targets.length}，存活人类 ${sim.rules.humansAlive()}，仍在战斗期）`);
  const child = targets[0], child2 = targets[1], human = keep[0];
  const victim = sim.rules.state(child);
  victim.hp = 100; victim.revivesLeft = 1; victim.canRevive = true;
  sim.rules.state(human).isAvenger = true;
  sim.rules.reportDeath(child, human);
  check(victim.canRevive === false && victim.revivesLeft === 1, '复仇: 复仇者击杀 → 禁止复活');
  check(sim.host.has(`mkilled:${child}:by:${human}`), '复仇: 复仇者击杀事件上报');
  const victim2 = sim.rules.state(child2);
  victim2.hp = 100; victim2.revivesLeft = 1; victim2.canRevive = true;
  const before = victim2.maxHp;
  sim.rules.reportDeath(child2, keep[1]);
  check(victim2.revivesLeft === 0 && victim2.reviveTimer > 0, '复仇: 普通击杀 → 进入复活倒计时');
  for (let i = 0; i < 60; i++) sim.rules.tick(0.1);
  check(victim2.alive, '复仇: 复活倒计时结束后复活');
  check(victim2.rebirths === 1 && victim2.maxHp > before, '复仇: 再变异 HP 强化');
}

// 7. 尸潮：最后 60 秒触发一次
{
  const sim = new ArenaSim('revenge', 11);
  sim.rules.beginRound(6); skipBuy(sim);
  check(sim.rules.phase === 'battle', '尸潮: 进入战斗期');
  for (let i = 0; i < 1211 && sim.host.tideCount === 0; i++) sim.rules.tick(0.1);
  check(sim.host.tideCount === WOZ.tideCount, `尸潮: 最后 60 秒生成 ${WOZ.tideCount} 只 AI (实际 ${sim.host.tideCount})`);
}

// 8. 子体自选职业
{
  const sim = new ArenaSim('infection', 21);
  sim.rules.beginRound(8); skipBuy(sim);
  const id = firstNonMother(sim);
  const s = sim.rules.state(id);
  check(s.side === 'human', '职业: 开局为人类');
  const mother = firstMother(sim);
  sim.humanHp[id] = 100;
  sim.rules.reportDeath(id, mother);
  check(s.side === 'mutant' && s.cls === MutantClass.Nightrunner, '职业: 感染后默认夜行者');
  check(sim.rules.setMutantClass(id, MutantClass.Souleater), '职业: 自选噬魂者成功');
  check(s.cls === MutantClass.Souleater, '职业: 职业已切换');
  check(Math.abs(s.maxHp - WOZ.childHp) < 0.01, '职业: 血量池按新职业重置');
  let motherLocked = true;
  for (let i = 0; i < 10; i++) {
    if (sim.rules.state(i).isMother && sim.rules.setMutantClass(i, MutantClass.Devourer)) motherLocked = false;
  }
  check(motherLocked, '职业: 母体不可变身');
}

// 9. 人类进化档位
{
  const sim = new ArenaSim('infection', 31);
  sim.rules.beginRound(9); skipBuy(sim);
  check(sim.rules.humanSpeedMultiplier(9) === 1, '进化: 初始无移速加成');
  sim.rules.state(9).humanSurviveTime = 46;
  check(sim.rules.humanSpeedMultiplier(9) > 1, '进化: 45s 后获得移速加成');
  check(sim.rules.humanDamageReduction(9) > 0, '进化: 减伤随档位提升');
}

// 10. 移速与爪击倍率
{
  const sim = new ArenaSim('infection', 55);
  sim.rules.beginRound(4); skipBuy(sim);
  const id = firstNonMother(sim);
  const m = sim.rules.state(id);
  m.side = 'mutant'; m.alive = true;
  sim.rules.setMutantClass(id, MutantClass.Nightrunner);
  const base = sim.rules.mutantSpeedMultiplier(id);
  check(base > WOZ.mutantSpeed, '移速: 夜行者快于基础倍率');
  m.skillCharge = 1;
  sim.rules.tryUseSkill(id);
  check(sim.rules.mutantSpeedMultiplier(id) > base * 1.3, '移速: 疾冲期间大幅提速');
  check(Math.abs(sim.rules.clawDamage(id, true) - WOZ.clawHeavy) < 0.01, '爪击: 无进化点时基础伤害');
  m.evoPoints = 3;
  check(sim.rules.clawDamage(id, false) > WOZ.clawLight * 1.05, '爪击: 进化点提升伤害');
}

// 11. 母体狂暴咆哮
{
  const sim = new ArenaSim('infection', 77);
  sim.rules.beginRound(3); skipBuy(sim);
  const mid = sim.rules.players.findIndex((p) => p.isMother);
  const m = sim.rules.state(mid);
  m.skillCharge = 1;
  check(sim.rules.tryUseSkill(mid), 'V8: 母体充满后可释放咆哮');
  check(sim.rules.motherRageActive(), 'V8: 狂暴咆哮激活');
  const other = sim.rules.players.findIndex((p) => !p.isMother && p.side === 'human');
  sim.rules.state(other).side = 'mutant';
  const base = sim.rules.mutantSpeedMultiplier(other);
  check(base > WOZ.mutantSpeed, `V8: 咆哮期间变异者加速 (${base.toFixed(2)})`);
}

// 12. V14 变异者进化阶段（攻击/防御/特殊进化）
{
  const sim = new ArenaSim('infection', 91);
  sim.rules.beginRound(5); skipBuy(sim);
  const mid = sim.rules.players.findIndex((p) => !p.isMother && p.side === 'human');
  const st = sim.rules.state(mid);
  st.side = 'mutant'; st.alive = true;
  check(sim.rules.evoStage(st) === 0, 'V14: 初始为基础形态');
  st.devourCount = 3;
  check(sim.rules.evoStage(st) === 1, 'V14: 3 吞噬 → 一阶攻击进化');
  check(Math.abs(sim.rules.damageMultiplier(st) / (1 + st.evoPoints * WOZ.evoDamagePerPoint) - WOZ.evoStageAtk) < 1e-6, 'V14: 一阶攻击 +15%');
  st.devourCount = 6;
  check(sim.rules.evoStage(st) === 2, 'V14: 6 吞噬 → 二阶防御进化');
  check(Math.abs(sim.rules.evoDamageReduction(st) - WOZ.evoStageDef) < 1e-6, 'V14: 二阶减伤 15%');
  st.devourCount = 9;
  check(sim.rules.evoStage(st) === 3, 'V14: 9 吞噬 → 三阶特殊进化');
  check(sim.rules.effectiveMaxHp(st) === st.maxHp + st.evoPoints * WOZ.evoHpPerPoint + WOZ.evoStageHpBonus, 'V14: 三阶 HP 上限 +500');
  const spd = sim.rules.mutantSpeedMultiplier(mid);
  check(spd > WOZ.mutantSpeed * 1.07, `V14: 三阶移速加成 (${spd.toFixed(2)})`);
  st.devourCount = 2;
  check(Math.abs(sim.rules.evoDamageReduction(st)) < 1e-6, 'V14: 阶段判定严格按吞噬数');
}

// 13. V46 人类能量三级技能（T/F/V，击杀/伤害/时间充能）
{
  const sim = new ArenaSim('infection', 77);
  sim.rules.beginRound(5); skipBuy(sim);
  const hid = sim.rules.players.findIndex((p) => !p.isMother && p.side === 'human');
  const h = sim.rules.state(hid);
  check(sim.rules.humanEnergy(hid) === 0, 'V46: 初始能量 0');
  check(!sim.rules.tryEnergySkill(hid, 'T'), 'V46: 能量不足释放拒绝');
  // 伤害充能：500 伤害 ×0.06 = +30
  sim.rules.reportDamage(hid, 0, 500);
  check(Math.abs(sim.rules.humanEnergy(hid) - 30) < 0.01, 'V46: 500 伤害充能 +30');
  // 击杀充能 +25
  sim.rules.addEnergy(hid, WOZ.energyPerKill);
  check(Math.abs(sim.rules.humanEnergy(hid) - 55) < 0.01, 'V46: 击杀充能 +25');
  // [T] 战术装填（25）
  check(sim.rules.tryEnergySkill(hid, 'T'), 'V46: T 战术装填释放成功');
  check(Math.abs(sim.rules.humanEnergy(hid) - 30) < 0.01, 'V46: T 消耗 25 能量');
  // 时间充能 20s → +30 = 60；[F] 战地狂热（50）
  sim.rules.tickHuman(h, 20);
  check(sim.rules.tryEnergySkill(hid, 'F'), 'V46: F 战地狂热释放成功（60≥50）');
  check(h.frenzyT > 0, 'V46: 狂热计时激活');
  const spd = sim.rules.humanSpeedMultiplier(hid);
  check(spd > 1, `V46: 狂热移速 +10% (${spd.toFixed(2)})`);
  sim.rules.tickHuman(h, WOZ.energyFrenzyDuration);
  check(h.frenzyT === 0, 'V46: 狂热到时结束');
  // [V] 必杀技（100）
  sim.rules.addEnergy(hid, 100);
  check(sim.rules.tryEnergySkill(hid, 'V'), 'V46: V 必杀技释放成功');
  check(h.ultActiveT > 0, 'V46: 狂暴激活');
  check(Math.abs(sim.rules.humanDamageBoost(hid) - WOZ.humanUltDamage) < 1e-6, 'V46: 伤害 ×1.5');
}

// V51 爬行者：纯属性型新变异体（蜥蜴巨躯）
{
  const sim = new ArenaSim('infection', 777);
  skipBuy(sim);
  const id = firstNonMother(sim);
  const st = sim.rules.state(id);
  st.side = 'mutant'; st.alive = true; // 转化为子体后再选职业
  check(WOZ.crawlerHp > WOZ.devourerHp - 800 && WOZ.crawlerHp === 3600, 'V51: 爬行者 3600HP 血池');
  check(sim.rules.setMutantClass(id, MutantClass.Crawler), 'V51: 可切换为爬行者');
  check(st.cls === MutantClass.Crawler, 'V51: 爬行者职业生效');
  check(sim.rules.baseHp(st) === WOZ.crawlerHp, 'V51: baseHp 取爬行者血池');
  check(skillOf(MutantClass.Crawler) === MutantSkill.None, 'V51: 纯属性型无技能');
  check(sim.rules.tryUseSkill(id) === false, 'V51: 爬行者无法释放技能');
  const crawlSpd = sim.rules.mutantSpeedMultiplier(id);
  check(crawlSpd < WOZ.mutantSpeed, `V51: 爬行者移速低于普通变异体 (${crawlSpd.toFixed(3)} < ${WOZ.mutantSpeed})`);
  const baseSpd = WOZ.mutantSpeed;
  check(Math.abs(crawlSpd - (baseSpd - WOZ.crawlerSlow)) < 1e-6, 'V51: 减速量 = crawlerSlow');
  // 换回其他职业仍可用
  check(sim.rules.setMutantClass(id, MutantClass.Nightrunner), 'V51: 爬行者可换回夜行者');
  check(skillOf(MutantClass.Nightrunner) === MutantSkill.Dash, 'V51: 夜行者技能保留');
}

// V52 断头者：双大刀处刑型（纯属性型无技能/最迟缓/近战倍率）
{
  const sim = new ArenaSim('infection', 778);
  skipBuy(sim);
  const id = firstNonMother(sim);
  const st = sim.rules.state(id);
  st.side = 'mutant'; st.alive = true;
  check(sim.rules.setMutantClass(id, MutantClass.Headhunter), 'V52: 可切换为断头者');
  check(sim.rules.baseHp(st) === WOZ.headhunterHp && WOZ.headhunterHp === 2800, 'V52: 断头者 2800HP 血池');
  check(skillOf(MutantClass.Headhunter) === MutantSkill.None, 'V52: 纯属性型无技能');
  check(sim.rules.tryUseSkill(id) === false, 'V52: 断头者无法释放技能');
  const hhSpd = sim.rules.mutantSpeedMultiplier(id);
  const nrSpd = WOZ.mutantSpeed;
  check(hhSpd < nrSpd - WOZ.crawlerSlow, `V52: 断头者比爬行者更迟缓 (${hhSpd.toFixed(3)})`);
  check(Math.abs(hhSpd - (nrSpd - WOZ.headhunterSlow)) < 1e-6, 'V52: 减速量 = headhunterSlow');
  check(WOZ.headhunterLightMul * 40 === 70 && Math.round(WOZ.headhunterHeavyMul * 75) >= 195, 'V52: 双刀倍率 轻击70/重击秒杀≈199');
}
// ================= V104 军衔等级系统（官方 74 级表，叶子猪 473436） =================
{
  check(RANK_XP.length === 74 && RANK_NAMES.length === 74, 'V104: 军衔表 74 级完整');
  let mono = true;
  for (let i = 1; i < RANK_XP.length; i++) if (RANK_XP[i] <= RANK_XP[i - 1]) mono = false;
  check(mono, 'V104: 经验阈值严格递增');
  check(RANK_XP[1] === 600 && RANK_XP[4] === 6000 && RANK_XP[23] === 244000, 'V104: 关键锚点 二等兵600/兵长1·6000/少尉1·244000');
  check(RANK_XP[73] === 12454000 && RANK_NAMES[73] === '元帅', 'V104: 元帅封顶 12454000');
  check(rankOf(0).name === '训练兵' && rankOf(599).name === '训练兵' && rankOf(600).name === '二等兵', 'V104: 训练兵/二等兵边界');
  check(rankOf(243999).name === '元士5' && rankOf(244000).name === '少尉1', 'V104: 军士→尉官边界');
  check(rankOf(12453999).name === '上将5' && rankOf(12454000).name === '元帅' && rankOf(99999999).name === '元帅', 'V104: 元帅封顶钳制');
  const rk = rankOf(1000);
  check(rk.frac === 400 / 1200 && rk.next === 1800, 'V104: 档内进度 1000→1800 档');
  check(rankOf(12454000).next === null && rankOf(12454000).frac === 1, 'V104: 元帅无下一档');
  check(rankOf(0).tierName === '士兵' && rankOf(100000).tierName === '军士' && rankOf(500000).tierName === '尉官'
    && rankOf(2000000).tierName === '校官' && rankOf(5000000).tierName === '将官' && rankOf(12454000).tierName === '元帅', 'V104: 六档分色 士兵/军士/尉官/校官/将官/元帅');
  check(rankOf(0).chevrons === 1 && rankOf(26000).chevrons === 5 && rankOf(12454000).chevrons === 1, 'V104: V形纹 = 档内第几级');
  check(xpForMatch({ kills: 8, humanDamage: 4000, damageDealt: 0, infections: 0, isAvenger: false }, true, 180) === 460, 'V104: 经验公式 杀25/伤÷50/胜150/分×10');
  check(xpForMatch({ kills: 1, humanDamage: 0, infections: 3, isAvenger: true }, false, 0) === 25 + 120 + 100, 'V104: 感染×40 + 复仇者觉醒×100');
  check(xpForMatch(null, false, 0) === 0 && xpForMatch({}, false, 0) === 0, 'V104: 空状态/败局零时长无经验');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
