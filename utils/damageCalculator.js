/**
 * Calculate level-based correction multiplier for damage
 * @param {Object} attacker - The attacking demon
 * @param {Object} defender - The defending demon
 * @returns {number} - The level correction multiplier
 */
function getLevelCorrectionMultiplier(attacker, defender) {
  const sumLevels = attacker.level + defender.level;
  const sumFactor = (sumLevels <= 30) ? 0 :
    (sumLevels <= 130) ? (sumLevels - 30) / 1000 : 0.1;

  if (defender.level - attacker.level >= 3) {
    const penalty = Math.sqrt(defender.level / attacker.level - 1) *
                    sumFactor * (defender.level - attacker.level - 2);
    return Math.max(1 - penalty, 0.5);
  }

  if (attacker.level - defender.level >= 3) {
    const boost = Math.sqrt(1 - defender.level / attacker.level) *
                  sumFactor * (attacker.level - defender.level - 2) * 1.2;
    return Math.min(1 + boost, 1.5);
  }

  return 1.0;
}

/**
 * Apply guard status to a demon
 * @param {Object} demon - The demon to apply guard to
 */
function guardAction(demon) {
  demon.isGuarding = true;
}

/**
 * Calculate damage for an attack
 * @param {Object} attacker - The attacking demon
 * @param {Object} defender - The defending demon
 * @param {Object} skill - The skill being used
 * @param {Object} context - Additional context for damage calculation
 * @returns {number} - The calculated damage
 */
function calculateDamage(attacker, defender, skill, context = {}) {
  const level = attacker.level;
  const root = (level <= 150) ? level + 10 : (level / 10 + 145);

  let stat = 0;
  if (skill.usesStrength) stat = attacker.strength;
  else if (skill.usesMagic) stat = attacker.magic;
  else if (skill.isMagatsuhi) return skill.power;

  let offense;
  if (stat <= root) {
    offense = stat + root;
  } else {
    offense = Math.sqrt((stat - root) / 2) + stat / 2 + (root * 1.5);
  }

  const vitality = defender.vitality;
  const diff = offense - vitality;
  let base;

  if (diff <= offense / 2) {
    base = (offense * 2 / 3) - (vitality / 3) - Math.sqrt(Math.max(vitality - offense / 2, 0)) / 3;
  } else if (diff <= offense * 3 / 4) {
    base = diff;
  } else {
    base = (offense * 5 / 6) - (vitality / 3) + Math.sqrt(Math.max(offense / 4 - vitality, 0)) / 3;
  }

  base = Math.max(Math.floor(base), 1);

  // Apply multipliers
  let modified = base;
  context.levelCorrectionMultiplier = getLevelCorrectionMultiplier(attacker, defender);
  modified *= skill.power / 100;
  modified *= context.attackStageMultiplier ?? 1;
  modified *= context.defenseStageMultiplier ?? 1;
  modified *= context.chargeMultiplier ?? 1;
  modified *= context.pleromaMultiplier ?? 1;
  modified *= context.zealotMultiplier ?? 1;
  modified *= context.potentialMultiplier ?? 1;
  modified *= context.efficacyMultiplier ?? 1;
  modified *= context.levelCorrectionMultiplier ?? 1;
  modified *= context.difficultyMultiplier ?? 1;
  modified *= context.exploitMultiplier ?? 1;
  
  // Apply guard effect - 20% damage reduction
  modified *= context.isGuarding ? 0.8 : 1;
  
  modified *= context.enemySpecificMultiplier ?? 1;
  modified *= context.innateSkillMultiplier ?? 1;

  // Add randomness
  const A = Math.floor(Math.random() * Math.floor(Math.random() * Math.max(Math.floor(modified / 10), 1)));
    const B = Math.floor(Math.random() * 4); // 0–3
    modified += A + B;

  
    return Math.max(Math.floor(modified), 1);
  }
  
  function basicAttack(attacker, defender) {
    // Use standard 100 power physical attack logic
    const attackData = {
      name: "Attack",
      type: "Physical",
      power: 100,
      usesStrength: true,
      usesMagic: false,
      sp: 0,
    };
  
    return calculateDamage(attacker, defender, attackData);
  }
  
  
  

  module.exports = { calculateDamage, basicAttack, guardAction };

  
  