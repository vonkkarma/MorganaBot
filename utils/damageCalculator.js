const fs = require('fs');
const statusHandler = require('./statusHandler');
const statusEffects = require('../statusEffects.json');

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
 * Get modified stats based on status effects
 * @param {Object} demon - The demon to get modified stats for
 * @returns {Object} - Object containing stat multipliers
 */
function getStatusEffectModifiers(demon) {
  return statusHandler.getStatusMultipliers(demon);
}

/**
 * Check if attacker should target allies due to status effects
 * @param {Object} attacker - The attacking demon
 * @returns {boolean} - Whether the attacker should target allies
 */
function shouldTargetAlly(attacker) {
  // Check for charm status effect
  if (statusHandler.hasStatusEffect(attacker, 'charm')) {
    const charmEffect = statusHandler.getStatusEffect(attacker, 'charm');
    return Math.random() * 100 < charmEffect.targetAllyChance;
  }
  
  // Check for brainwash status effect
  if (statusHandler.hasStatusEffect(attacker, 'brainwash')) {
    const brainwashEffect = statusHandler.getStatusEffect(attacker, 'brainwash');
    return Math.random() * 100 < brainwashEffect.healEnemyChance;
  }
  
  return false;
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

  // Get status effect modifiers
  const attackerModifiers = getStatusEffectModifiers(attacker);
  const defenderModifiers = getStatusEffectModifiers(defender);

  let stat = 0;
  if (skill.usesStrength) {
    stat = attacker.strength * (attackerModifiers.strengthMultiplier || 1.0);
  } else if (skill.usesMagic) {
    stat = attacker.magic * (attackerModifiers.magicMultiplier || 1.0);
  } else if (skill.isMagatsuhi) {
    return skill.power;
  }

  let offense;
  if (stat <= root) {
    offense = stat + root;
  } else {
    offense = Math.sqrt((stat - root) / 2) + stat / 2 + (root * 1.5);
  }

  // Apply defender's modified vitality based on status effects
  const vitality = defender.vitality * (defenderModifiers.defenseMultiplier || 1.0);
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
  
  // Apply status effect multipliers if not already provided in context
  const attackStageMultiplier = context.attackStageMultiplier || 
                               (skill.usesStrength ? attackerModifiers.strengthMultiplier : 
                                skill.usesMagic ? attackerModifiers.magicMultiplier : 1.0);
  
  const defenseStageMultiplier = context.defenseStageMultiplier || 
                                defenderModifiers.defenseMultiplier || 1.0;
  
  modified *= attackStageMultiplier;
  modified *= defenseStageMultiplier;
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
  
  // Apply vulnerability modifiers from status effects
  if (skill.type === "Physical" || skill.usesStrength) {
    modified *= defenderModifiers.physicalVulnerability || 1.0;
  } else if (skill.usesMagic) {
    modified *= defenderModifiers.magicalVulnerability || 1.0;
  }
  
  modified *= context.enemySpecificMultiplier ?? 1;
  modified *= context.innateSkillMultiplier ?? 1;

  // Add randomness
  const A = Math.floor(Math.random() * Math.floor(Math.random() * Math.max(Math.floor(modified / 10), 1)));
  const B = Math.floor(Math.random() * 4); // 0–3
  modified += A + B;

  // Apply accuracy and evasion modifiers for hit calculation
  // This is separate from damage but useful to expose
  context.finalAccuracy = (skill.accuracy || 100) * 
                         (attackerModifiers.accuracyMultiplier || 1.0) / 
                         (defenderModifiers.evasionMultiplier || 1.0);

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

// Check if demon should be affected by status effects that break on damage
function checkStatusBreakOnDamage(demon, damageType) {
  return statusHandler.handleStatusBreakOnDamage(demon, damageType);
}

module.exports = { 
  calculateDamage, 
  basicAttack, 
  guardAction, 
  shouldTargetAlly,
  checkStatusBreakOnDamage,
  getStatusEffectModifiers
};