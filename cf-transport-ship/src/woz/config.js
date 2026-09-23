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
  skillChargeSeconds: 45,
  skillChargePerDamage: 1 / 900,
  dashSpeed: 2.6,           // 疾冲期间额外移速倍率
  dashDuration: 0.6,
  blindWailDuration: 3,
  blindWailRange: 18,
  hardenReduction: 0.7,
  hardenDuration: 4,

  // 吞噬进化
  devourHeal: 300,
  devourCapFactor: 1.5,
  devourCooldown: 1.5,
  devourChargeBonus: 0.15,
  evoDamagePerPoint: 0.02,
  evoHpPerPoint: 50,

  // 人类进化
  humanTierSeconds: 45,
  humanKillsPerTier: 3,
  humanMaxTier: 4,
  humanSpeedPerTier: 0.04,
  humanReserveMagPerTier: 1,
  humanDamageReductionPerTier: 0.05,

  // 复仇模式
  avengerHp: 1500,
  avengerLight: 500,
  avengerSpeed: 1.2,
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
};

// ---- 生化对抗：人类攻方占领战术据点，变异者守方 ----
export const CONFRONT = {
  battleTime: 240,
  captureRate: 100 / 10,   // 单人无阻占领 10 秒
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
  aiHp: 300,
  dropHeal: 50,
  dropAmmoMags: 1,
};

export const MutantClass = {
  None: 'none',
  Mother: 'mother',
  Nightrunner: 'nightrunner',
  Souleater: 'souleater',
  Devourer: 'devourer',
};

export const MutantSkill = {
  None: 'none',
  Dash: 'dash',
  BlindWail: 'blindWail',
  Harden: 'harden',
};

export const CLASS_LABEL = {
  [MutantClass.Mother]: '母体变异者',
  [MutantClass.Nightrunner]: '夜行者',
  [MutantClass.Souleater]: '噬魂者',
  [MutantClass.Devourer]: '暴食者',
};

export const SKILL_LABEL = {
  [MutantSkill.Dash]: '疾冲',
  [MutantSkill.BlindWail]: '致盲尖啸',
  [MutantSkill.Harden]: '硬化',
};

export function skillOf(cls) {
  if (cls === MutantClass.Nightrunner) return MutantSkill.Dash;
  if (cls === MutantClass.Souleater) return MutantSkill.BlindWail;
  if (cls === MutantClass.Devourer) return MutantSkill.Harden;
  return MutantSkill.None;
}

export function skillDuration(cls) {
  if (cls === MutantClass.Nightrunner) return WOZ.dashDuration;
  if (cls === MutantClass.Souleater) return WOZ.blindWailDuration;
  if (cls === MutantClass.Devourer) return WOZ.hardenDuration;
  return 0;
}
