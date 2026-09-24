// WOZ 全部可调数值。数值移植自已验证的规则层（见仓库 woz/WOZ_README.md），集中调参。
export const WOZ = {
  // 回合
  buyTime: 15,
  battleTime: 180,
  roundEndTime: 7,

  // 母体
  motherHp: 3000,
  motherInfectHeal: 500,
  mothersPerFive: 1,

  // 子体
  childHp: 1500,

  // 变异者通用
  mutantSpeed: 1.18,
  nightrunnerSpeed: 0.12,   // 夜行者在基础倍率上再加成
  clawLight: 40,
  clawHeavy: 75,
  clawRange: 1.7,
  clawRate: 0.55,           // 爪击间隔（秒）

  // 技能
  skillChargePerDamage: 1 / 900,
  dashSpeed: 2.6,           // 疾冲期间额外移速倍率
  dashDuration: 0.6,
  blindWailDuration: 3,
  blindWailRange: 18,
  hardenReduction: 0.7,
  hardenDuration: 4,
  axeDamage: 300,           // 猎食者投掷斧头（原作技能：投掷斧头）
  axeSpeed: 30,
  axeLifetime: 2,
  axeGravity: 7,

  // 吞噬进化
  devourHeal: 300,
  devourCapFactor: 1.5,
  devourCooldown: 1.5,
  devourChargeBonus: 0.15,
  evoDamagePerPoint: 0.02,
  evoHpPerPoint: 50,
  // 进化阶段（原作：变异者逐步获得 防御 / 攻击 / 再次变异 / 特殊进化）
  evoStageDevours: [3, 6, 9],  // 一阶攻击 / 二阶防御 / 三阶特殊进化
  evoStageAtk: 1.15,
  evoStageDef: 0.15,
  evoStageSpeed: 1.08,
  evoStageHpBonus: 500,

  // 人类进化
  humanTierSeconds: 45,
  humanKillsPerTier: 3,
  humanMaxTier: 4,
  humanSpeedPerTier: 0.04,
  humanReserveMagPerTier: 1,
  humanDamageReductionPerTier: 0.05,
  // 人类进化进阶（原作：速度/弹药/威力/必杀技）
  humanTier3Damage: 1.1,      // 三档：威力 +10%
  humanUltDamage: 1.5,        // 必杀技期间威力
  humanUltDuration: 5,
  // 人类能量三级技能（V46，百度百科原作：T/F/V 三键，击杀/伤害/时间充能）
  energyPerSecond: 1.5,
  energyPerDamage: 0.06,
  energyPerKill: 25,
  energyCostT: 25,
  energyCostF: 50,
  energyCostV: 100,
  energyFrenzyDuration: 8,

  // 复仇模式
  avengerHp: 1500,
  avengerLight: 500,
  avengerSpeed: 1.2,
  avengerDef: 0.3,          // 复仇者防御被动（原作：超越人类体能极限的防御力）
  avengerSpinRadius: 2.8,   // 旋转清场半径（原作：被包围时原地旋转清除近身敌人）
  avengerHumanThreshold: 2,
  avengerTimeThreshold: 45,
  mutantRevives: 1,
  mutantReviveDelay: 5,
  rebirthHpMul: 1.25,
  rebirthDamageMul: 1.2,
  tideTimeLeft: 60,
  tideCount: 4,

  // 职业
  devourerHp: 4000,
  tanglerHp: 1800,          // 缠绕者：控制型，触须远程拖拽
  entangleRange: 22,
  entangleDamage: 60,
  entangleRootTime: 1.2,
  entangleDragSpeed: 9,
  bomberHp: 2200,           // 爆破者：自爆冲锋
  selfDestructDamage: 700,
  selfDestructRadius: 7,
  selfDestructFuse: 1.2,
  selfDestructSpeed: 1.3,   // 引爆冲锋期间移速加成
  crawlerHp: 3600,          // 爬行者：蜥蜴基因巨躯（调研：2米/400斤，血量惊人，纯属性型无技能）
  crawlerSlow: 0.05,        // 移速低于普通变异体
  crawlerBodyArmor: 0.6,    // 躯体减伤 40%（调研：抗击打强，移动中被射击影响不大）
  crawlerHeadMul: 1.5,      // 爆头额外伤害
  crawlerHeadStop: 0.9,     // 爆头定身时长（调研：被击中头部会停止移动）
  headhunterHp: 2800,       // 断头者：双大刀处刑型（调研：力量型/手持两把大刀/移动慢/时常秒杀对手）
  headhunterSlow: 0.08,     // 比爬行者更迟缓
  headhunterLightMul: 1.75, // 双刀轻击 ×1.75（40→70）
  headhunterHeavyMul: 2.65, // 双刀重击 ×2.65（75→199）：重击近身秒杀满血人类
  sorrowHp: 380,            // 悲惨行者：AI 杂兵特感（调研：对抗/爆破/复仇三模式中出现）
  sorrowDmg: 20,            // 每击固定 20HP（调研：末分钟大批 AI 变异者攻击力每次 20HP）
  sorrowSpeed: 1.3,         // 调研：三模式中速度较快
  sorrowFrenzyHp: 300,      // 末分钟狂潮版血量（HP 低）
  sorrowFrenzyCount: 4,     // 狂潮只数
};

// ---- 生化对抗：人类攻方占领战术据点，变异者守方 ----
export const CONFRONT = {
  battleTime: 240,
  captureRate: 100 / 10,   // 单人无阻占领 10 秒
  reinforceFirst: 30,      // 首波浓雾增援（原作：占领越深变异者增援越猛）
  reinforceMin: 12,
  points: [
    { name: 'A', x: 12, z: 0, r: 5 },
    { name: 'B', x: -2, z: 0, r: 5 },
    { name: 'C', x: -16, z: 0, r: 5 },
  ],
  humans: 6,               // 人类攻方（含玩家）
  mutants: 4,              // 变异者守方
  humanRespawn: 6,
  mutantRespawn: 5,
};

// ---- 生化爆破：人类攻入变异者基地安放核弹 ----
export const DEMOL = {
  battleTime: 240,
  plantTime: 4,
  bombTime: 45,
  destroyTime: 8,
  site: { name: '核', x: -30, z: 0, r: 6 },
  humans: 7,
  mutants: 3,
  heroHp: 200,
  heroDamage: 1.25,
  heroSpeed: 1.12,
  mutantRespawns: 1,       // 守方强化：每名变异者可复活次数
  guardHp: 1200,
};

// ---- 生化模式：感染变体，AI 怪物掉落补给/技能 ----
export const BIO = {
  aiInterval: 12,
  aiMax: 8,
  waveFirst: 20,           // 首波 AI 怪物波次（V23 波次化，给人类发育窗口）
  waveInterval: 40,
  aiHp: 300,
  dropHeal: 50,
  dropAmmoMags: 1,
};

// ---- 补给空投（V24）：战斗期周期空投全补给箱 ----
export const AIRDROP = {
  first: 45,
  interval: 60,
  life: 30,
  fallSpeed: 8,
};

export const MutantClass = {
  None: 'none',
  Mother: 'mother',
  Nightrunner: 'nightrunner',
  Souleater: 'souleater',
  Devourer: 'devourer',
  Tangler: 'tangler',
  Bomber: 'bomber',
  Crawler: 'crawler',
  Headhunter: 'headhunter',
};

export const MutantSkill = {
  None: 'none',
  Rage: 'rage',
  Dash: 'dash',
  BlindWail: 'blindWail',
  Harden: 'harden',
  AxeThrow: 'axeThrow',
  Entangle: 'entangle',
  SelfDestruct: 'selfDestruct',
};

export const CLASS_LABEL = {
  [MutantClass.Mother]: '母体变异者',
  [MutantClass.Nightrunner]: '夜行者',
  [MutantClass.Souleater]: '噬魂者',
  [MutantClass.Devourer]: '猎食者',
  [MutantClass.Tangler]: '缠绕者',
  [MutantClass.Bomber]: '爆破者',
  [MutantClass.Crawler]: '爬行者',
  [MutantClass.Headhunter]: '断头者',
};

export const SKILL_LABEL = {
  [MutantSkill.Rage]: '狂暴咆哮',
  [MutantSkill.Dash]: '疾冲',
  [MutantSkill.BlindWail]: '致盲尖啸',
  [MutantSkill.Harden]: '硬化',
  [MutantSkill.AxeThrow]: '投掷斧头',
  [MutantSkill.Entangle]: '缠绕',
  [MutantSkill.SelfDestruct]: '自爆',
};

export function skillOf(cls) {
  if (cls === MutantClass.Mother) return MutantSkill.Rage;
  if (cls === MutantClass.Nightrunner) return MutantSkill.Dash;
  if (cls === MutantClass.Souleater) return MutantSkill.BlindWail;
  if (cls === MutantClass.Devourer) return MutantSkill.AxeThrow;
  if (cls === MutantClass.Tangler) return MutantSkill.Entangle;
  if (cls === MutantClass.Bomber) return MutantSkill.SelfDestruct;
  // 爬行者/断头者：原作纯属性型变异者，无技能（17173 变异者技能解析）
  return MutantSkill.None;
}

// 技能冷却（秒）：各技能独立（调研：缠绕者原作"不需要等待能量槽聚集，可随时使用"→最短；
// 自爆/咆哮属战略级→最长。官方精确数值已随停运失传，此为按时代同类标准的重建值）
const SKILL_COOLDOWNS = {
  [MutantClass.Nightrunner]: 15,  // 疾冲：机动技
  [MutantClass.Souleater]: 25,    // 致盲尖啸：开团技
  [MutantClass.Devourer]: 20,     // 投掷斧头：输出技
  [MutantClass.Tangler]: 6,       // 缠绕：原作"可随时使用"
  [MutantClass.Bomber]: 30,       // 自爆：战略级
  [MutantClass.Mother]: 30,       // 狂暴咆哮：战略级
};

export function skillCooldownSec(cls) {
  return SKILL_COOLDOWNS[cls] || 25;
}

export function skillDuration(cls) {
  if (cls === MutantClass.Mother) return 5;
  if (cls === MutantClass.Nightrunner) return WOZ.dashDuration;
  if (cls === MutantClass.Souleater) return WOZ.blindWailDuration;
  if (cls === MutantClass.Devourer || cls === MutantClass.Tangler || cls === MutantClass.Bomber) return 0.3; // 瞬时技能，短窗口防连发
  return 0;
}
