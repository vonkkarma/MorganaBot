const fs = require('fs');
const moves = require('../moves.json');
const { calculateDamage, guardAction, shouldTargetAlly, checkStatusBreakOnDamage, getStatusEffectModifiers } = require('./damageCalculator');
const statusHandler = require('./statusHandler');

// Track battle menu state for all active users
const battleMenuState = {};

function getEntityDisplayText(entity) {
  return entity.userId ? `<@${entity.userId}> (${entity.name})` : entity.name;
}

async function handleTargetRedirection(attacker, defender, move, message) {
  const attackerText = getEntityDisplayText(attacker);
  const defenderText = getEntityDisplayText(defender);

  // Check if attacker is affected by status that redirects targets
  const redirectTarget = shouldTargetAlly(attacker);

  if (!redirectTarget || (move.type === 'Healing')) {
    return false;
  }

  if (statusHandler.hasStatusEffect(attacker, 'charm')) {
    await message.channel.send(`${attackerText} is charmed 💘 and attacks an ally instead!`);
    return true;
  }
  else if (attacker.statusEffects?.some(effect => effect.name.toLowerCase() === 'brainwash')) {
    await message.channel.send(`${attackerText} is brainwashed 🧠 and heals the enemy instead!`);

    // Calculate heal amount based on the move's power/stats
    let healAmount;
    if (move.power) {
      // If it's a damaging move, heal for ~50% of what the damage would have been
      healAmount = Math.max(1, Math.floor(move.power / 2));
    } else {
      // For basic attacks or moves without power, heal for 15% of max HP
      healAmount = Math.max(1, Math.floor(defender.maxHp * 0.15));
    }

    defender.hp = Math.min(defender.hp + healAmount, defender.maxHp);
    await message.channel.send(`${defenderText} recovers ${healAmount} HP!`);
    return true;
  }

  return false;
}

// Re-export BattleManager functionality for backwards compatibility
const BattleManager = require('./BattleManager');

module.exports = {
    displayBattleStatus: (message, player, enemy, isPlayerTurn) => {
        const manager = new BattleManager(message, { player, enemy }, {});
        return manager.displayBattleStatus(isPlayerTurn);
    },
    processMenuInput: (message, input, battleData, demons, isPlayerTurn) => {
        const manager = new BattleManager(message, battleData, demons);
        return manager.processInput(input, isPlayerTurn);
    },
    executeAbility: (attacker, defender, ability, message, demons, attackerText, defenderText) => {
        const manager = new BattleManager(message, { player: attacker, enemy: defender }, demons);
        return manager.executeAbility(attacker, defender, ability);
    },
    executeBasicAttack: (attacker, defender, message, demons, attackerText, defenderText) => {
        const manager = new BattleManager(message, { player: attacker, enemy: defender }, demons);
        return manager.executeBasicAttack(attacker, defender);
    },
    executeGuard: (attacker, message) => {
        const manager = new BattleManager(message, { player: attacker }, {});
        return manager.executeGuard(attacker);
    },
    executeEnemyTurn: (message, battleData, demons) => {
        const manager = new BattleManager(message, battleData, demons);
        return manager.executeEnemyTurn();
    },
    resetMenuState: (userId) => {
        const manager = new BattleManager({}, {}, {});
        return manager.resetMenuState(userId);
    }
};