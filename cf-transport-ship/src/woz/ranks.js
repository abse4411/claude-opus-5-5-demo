// V104 军衔等级系统 —— 官方 74 级军衔表（叶子猪官方专区 473436 页完整数值；
// 原文准将3区间排版错误按等差 280000 修正为 5144000∼5423999）
// 士兵4 → 军士19 → 尉官15 → 校官15 → 将官20 → 元帅1，经验为累计值，元帅封顶。

// 阈值表手工展开（官方逐级数值，勿改）
export const RANK_XP = [
  0, 600, 1800, 3500, // 士兵：训练兵 二等兵 一等兵 上等兵
  6000, 11000, 16000, 21000, 26000, 33000, 40000, 47000, 54000, // 军士：兵长1-2 下士1-3 中士1-4
  64000, 74000, 84000, 94000, 104000, 124000, 144000, 164000, 184000, 204000, // 上士1-5 元士1-5
  244000, 284000, 324000, 364000, 404000, 484000, 564000, 644000, 724000, 804000, // 尉官：少尉1-5 中尉1-5
  904000, 1004000, 1104000, 1204000, 1304000, // 上尉1-5
  1454000, 1604000, 1754000, 1904000, 2054000, 2254000, 2454000, 2654000, 2854000, 3054000, // 校官：少校 中校
  3304000, 3554000, 3804000, 4054000, 4304000, // 上校1-5
  4584000, 4864000, 5144000, 5424000, 5704000, 6034000, 6364000, 6694000, 7024000, 7354000, // 将官：准将 少将
  7734000, 8114000, 8494000, 8874000, 9254000, 9754000, 10254000, 10754000, 11254000, 11754000, // 中将 上将
  12454000, // 元帅
];

const NAME = (zh, n, s = 1) => Array.from({ length: n }, (_, i) => zh + (n > 1 ? (i + 1) * s : ''));
export const RANK_NAMES = [
  ...['训练兵', '二等兵', '一等兵', '上等兵'],
  ...NAME('兵长', 2), ...NAME('下士', 3), ...NAME('中士', 4), ...NAME('上士', 5), ...NAME('元士', 5),
  ...NAME('少尉', 5), ...NAME('中尉', 5), ...NAME('上尉', 5),
  ...NAME('少校', 5), ...NAME('中校', 5), ...NAME('上校', 5),
  ...NAME('准将', 5), ...NAME('少将', 5), ...NAME('中将', 5), ...NAME('上将', 5),
  '元帅',
];

// 军衔分档（徽章配色）：0-3 士兵 / 4-22 军士 / 23-37 尉官 / 38-52 校官 / 53-72 将官 / 73 元帅
export const RANK_TIERS = [
  { name: '士兵', max: 3, color: '#9aa7b5', chev: '#c8d4e0' },
  { name: '军士', max: 22, color: '#b08a3e', chev: '#ffd98a' },
  { name: '尉官', max: 37, color: '#5f86b8', chev: '#a8d0ff' },
  { name: '校官', max: 52, color: '#c09a2f', chev: '#ffe9a0' },
  { name: '将官', max: 72, color: '#b8452f', chev: '#ffc8a0' },
  { name: '元帅', max: 73, color: '#d4af37', chev: '#fff2b0' },
];

export function rankIdx(xp) {
  if (!(xp > 0)) return 0;
  let lo = 0, hi = RANK_XP.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xp >= RANK_XP[mid]) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function rankOf(xp) {
  const i = rankIdx(xp);
  const tier = RANK_TIERS.findIndex((t) => i <= t.max);
  const t = RANK_TIERS[tier];
  const next = i + 1 < RANK_XP.length ? RANK_XP[i + 1] : null;
  const cur = RANK_XP[i];
  const frac = next ? Math.max(0, Math.min(1, (xp - cur) / (next - cur))) : 1;
  return { idx: i, name: RANK_NAMES[i], tier, tierName: t.name, color: t.color, chev: t.chev,
    cur, next, frac, // 当前档内经验 / 下一档所需（经验条）
    chevrons: 1 + (i - (tier > 0 ? RANK_TIERS[tier - 1].max + 1 : 0)) }; // 档内第几级（V 形纹数量）
}

// 局末经验公式（官方未公开每局经验 → 按成分自定平衡：杀敌/伤害/感染/觉醒/胜负/时长）
export function xpForMatch(st, win, seconds) {
  const kills = st ? (st.kills || 0) : 0;
  const dmg = st ? ((st.humanDamage || 0) + (st.damageDealt || 0)) : 0;
  const inf = st && st.infections ? st.infections : 0;
  const av = st && st.isAvenger ? 1 : 0;
  const mins = Math.max(0, Math.floor((seconds || 0) / 60));
  return Math.round(kills * 25 + dmg / 50 + inf * 40 + av * 100
    + (win === true ? 150 : win === null ? 75 : 0) + mins * 10);
}

const KEY = 'woz_xp_v1';
export function loadXp() {
  try { const v = parseFloat(localStorage.getItem(KEY)); return isFinite(v) && v > 0 ? v : 0; } catch (e) { return 0; }
}
export function saveXp(xp) {
  try { localStorage.setItem(KEY, String(Math.max(0, Math.round(xp)))); } catch (e) { /* 无痕模式忽略 */ }
}
