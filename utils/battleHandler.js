const fs = require('fs');
const moves = require('../moves.json');
const { calculateDamage, guardAction, shouldTargetAlly, checkStatusBreakOnDamage, getStatusEffectModifiers } = require('./damageCalculator');
const statusHandler = require('./statusHandler');

// Track battle menu state for active users with automatic cleanup
class BattleMenuManager {
  constructor() {
    this.states = {};
    this.CLEANUP_INTERVAL = 1000 * 60 * 30; // 30 minutes
    
    // Setup periodic cleanup
    setInterval(() => this.cleanupInactiveStates(), this.CLEANUP_INTERVAL);
  }
  
  getState(userId) {
    if (!this.states[userId]) {
      this.states[userId] = {
        currentMenu: 'main',
        lastActivity: Date.now()
      };
    } else {
      // Update last activity timestamp
      this.states[userId].lastActivity = Date.now();
    }
    return this.states[userId];
  }
  
  resetState(userId) {
    if (this.states[userId]) {
      this.states[userId].currentMenu = 'main';
      this.states[userId].lastActivity = Date.now();
    }
  }
  
  cleanupInactiveStates() {
    const currentTime = Date.now();
    const expirationTime = 1000 * 60 * 60; // 1 hour
    
    Object.keys(this.states).forEach(userId => {
      if (currentTime - this.states[userId].lastActivity > expirationTime) {
        delete this.states[userId];
      }
    });
  }
}

// Create a singleton instance
const battleMenuManager = new BattleMenuManager();

/**
 * Helper to format entity display text
 * @param {Object} entity - Player or enemy entity
 * @returns {String} Formatted display text
 */
function getEntityDisplayText(entity) {
  return entity.userId ? `<@${entity.userId}> (${entity.name})` : entity.name;
}

/**
 * Helper to process move execution outcomes
 * @param {Object} attacker - The attacking entity
 * @param {Object} move - The move being used
 * @param {String} message - The message to send
 * @returns {Boolean} Whether the move succeeded
 */
async function processMoveOutcome(attacker, move, message) {
  // Check SP cost
  if (attacker.sp < move.sp) {
    await message.channel.send(`${getEntityDisplayText(attacker)} doesn't have enough SP to use ${move.name}!`);
    return false;
  }
  
  // Deduct SP
  attacker.sp -= move.sp;
  return true;
}

/**
 * Apply damage and status effects 
 * @param {Object} attacker - The attacking entity
 * @param {Object} defender - The defending entity
 * @param {Number} damage - The damage amount
 * @param {Object} move - The move being used
 * @param {Object} message - Discord message object
 */
async function applyDamageAndEffects(attacker, defender, damage, move, message) {
  const attackerText = getEntityDisplayText(attacker);
  const defenderText = getEntityDisplayText(defender);
  
  // Apply damage
  defender.hp -= damage;
  await message.channel.send(`${defenderText} takes ${damage} damage!`);
  
  // Check for broken status effects when hit
  const brokenEffects = checkStatusBreakOnDamage(defender, move.type);
  if (brokenEffects && brokenEffects.length > 0) {
    for (const effect of brokenEffects) {
      await message.channel.send(`${defenderText}'s ${effect} status was broken by the attack!`);
    }
  }
  
  // Check for instakill effects
  if (move.instakill && defender.hp > 0) {
    await statusHandler.checkInstakill(attacker, defender, move, message);
  }
  
  // Check for status effect application from the move
  if (defender.hp > 0) {
    await statusHandler.applyStatusFromSkill(attacker, defender, move, message);
  }
}

/**
 * Handle target redirection for charm/brainwash
 * @param {Object} attacker - The attacking entity
 * @param {Object} defender - The defending entity
 * @param {Object} move - The move being used
 * @param {Object} message - Discord message object
 * @returns {Boolean} Whether the attack was redirected
 */
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
    // In a multiplayer scenario, you'd redirect to a different target here
    return true;
  } 
  else if (statusHandler.hasStatusEffect(attacker, 'brainwash')) {
    await message.channel.send(`${attackerText} is brainwashed 🧠 and attempts to heal the enemy!`);
    // Use a consistent healing formula across all moves
    const healAmount = Math.floor((move.power || attacker.strength) / 2);
    defender.hp = Math.min(defender.hp + healAmount, defender.maxHp);
    await message.channel.send(`${defenderText} recovers ${healAmount} HP!`);
    return true;
  }
  
  return false;
}

// Main battle handler module
const battleHandler = {
  /**
   * Prompt user to select a demon
   * @param {Object} message - Discord message object
   * @param {String} userId - User ID
   * @param {Array} caughtDemons - List of caught demons
   * @param {Object} demons - Demons data
   * @returns {Object|null} Selected demon or null
   */
  async promptForDemonSelection(message, userId, caughtDemons, demons) {
    if (!caughtDemons || caughtDemons.length === 0) {
      await message.channel.send(`<@${userId}>, you don't have any demons to select.`);
      return null;
    }
    
    await message.channel.send(
      `<@${userId}>, choose your demon:\n` +
      caughtDemons.map((d, i) => {
        const demon = demons[d];
        const level = demon?.level ?? '?';
        return `${i + 1}. ${d} (Lv ${level})`;
      }).join('\n')
    );

    const filter = m => m.author.id === userId;
    try {
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      const index = parseInt(collected.first().content) - 1;
      
      if (isNaN(index) || index < 0 || index >= caughtDemons.length) {
        await message.channel.send(`<@${userId}>, that's not a valid selection.`);
        return null;
      }
      
      const selectedName = caughtDemons[index];
      const demon = demons[selectedName];
      if (!demon) {
        await message.channel.send(`<@${userId}>, there was an error selecting that demon.`);
        return null;
      }
      
      return demon;
    } catch (error) {
      await message.channel.send(`<@${userId}>, you didn't make a selection in time.`);
      return null;
    }
  },

  /**
   * Execute a demon ability
   * @param {Object} attacker - The attacking entity
   * @param {Object} defender - The defending entity
   * @param {Object} ability - The ability to use
   * @param {Object} message - Discord message object
   * @param {Object} demons - Demons data
   * @param {String} attackerText - Display text for attacker
   * @param {String} defenderText - Display text for defender
   * @returns {Boolean} Whether the ability was executed successfully
   */
  async executeAbility(attacker, defender, ability, message, demons, attackerText, defenderText) {
    if (!ability || !ability.name) return false;
    
    const move = moves[ability.name]; // Get the full move from moves.json
    if (!move) {
      await message.channel.send(`Unknown ability: ${ability.name}`);
      return false;
    }

    // Check if attacker can act due to status effects
    if (!statusHandler.processStatusEffectsStart(attacker, message)) {
      return true; // Turn used, but couldn't act
    }

    // Check SP and deduct it
    if (!await processMoveOutcome(attacker, move, message)) {
      return false;
    }

    // Handle redirected targets (charm/brainwash)
    if (await handleTargetRedirection(attacker, defender, move, message)) {
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }

    // Handle healing moves
    if (move.type === 'Healing') {
      const maxHp = demons[attacker.name]?.hp || attacker.maxHp;
      const baseHeal = move.power || 0;
      const percentHeal = Math.floor(maxHp * (move.healingPercent || 0));
      const totalHeal = baseHeal + percentHeal;
    
      attacker.hp = Math.min(attacker.hp + totalHeal, maxHp);
    
      await message.channel.send(
        `${attackerText} uses ${move.emoji} ${ability.name} and heals ${totalHeal} HP!`
      );

      // Check for status effects from healing move
      if (move.curesAilment) {
        const removed = statusHandler.removeStatusEffect(attacker, move.curesAilment);
        if (removed) {
          await message.channel.send(`${attackerText} is no longer affected by ${move.curesAilment}!`);
        }
      }

      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }
    // Handle pure status/ailment moves
    else if (move.power === 0 || move.isPureStatus) {
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}...`);
      
      // Calculate accuracy with status effect modifiers
      const attackerMods = getStatusEffectModifiers(attacker);
      const defenderMods = getStatusEffectModifiers(defender);
      
      const accuracy = (move.accuracy ?? 100) * 
                      (attackerMods.accuracyMultiplier ?? 1.0) / 
                      (defenderMods.evasionMultiplier ?? 1.0);
                      
      const roll = Math.random() * 100;
      if (roll > accuracy) {
        await message.channel.send(`... but it MISSES!`);
        await statusHandler.processStatusEffectsEnd(attacker, message);
        return true;
      }
      
      // Apply the status effect
      await statusHandler.applyStatusFromSkill(attacker, defender, move, message);
      
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }
    // Handle damage-dealing moves
    else {
      const resist = defender.resistances || {};

      // Calculate accuracy with status effect modifiers
      const attackerMods = getStatusEffectModifiers(attacker);
      const defenderMods = getStatusEffectModifiers(defender);
      
      const accuracy = (move.accuracy ?? 100) * 
                      (attackerMods.accuracyMultiplier ?? 1.0) / 
                      (defenderMods.evasionMultiplier ?? 1.0);
                      
      const roll = Math.random() * 100;
      if (roll > accuracy) {
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it MISSES!`);
        await statusHandler.processStatusEffectsEnd(attacker, message);
        return true;
      }
    
      let context = {
        attackStageMultiplier: attackerMods.strengthMultiplier || attackerMods.magicMultiplier || 1,
        defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
        isGuarding: defender.isGuarding || false
      };
    
      let efficacy = 1;
      let baseDamage = calculateDamage(attacker, defender, move, context);
      
      // Check resistances and apply appropriate multipliers
      const isWeak = resist?.weak?.includes(move.type);
      const isResist = resist?.resist?.includes(move.type);
      const isNull = resist?.null?.includes(move.type);
      const isDrain = resist?.drain?.includes(move.type);
      const isRepel = resist?.repel?.includes(move.type);
      
      // Handle different resistance types
      if (isWeak) {
        efficacy = 1.25; // baseline SMT V multiplier
        baseDamage = Math.floor(baseDamage * efficacy);
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... WEAK! ‼️`);
      } 
      else if (isResist) {
        efficacy = 0.5; // baseline resist multiplier
        baseDamage = Math.floor(baseDamage * efficacy);
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... RESIST! 🛡`);
      }
      else if (isNull) {
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it has no effect! ❌`);
        await statusHandler.processStatusEffectsEnd(attacker, message);
        return true;
      }
      else if (isDrain) {
        const healedAmount = Math.max(0, Math.floor(baseDamage));
        defender.hp = Math.min(defender.maxHp, defender.hp + healedAmount);
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it's drained! ${defenderText} heals ${healedAmount} HP! 💉`);
        await statusHandler.processStatusEffectsEnd(attacker, message);
        return true;
      }
      else if (isRepel) {
        attacker.hp -= baseDamage;
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... it's reflected! ${attackerText} takes ${baseDamage} damage! 🔁`);
        await statusHandler.processStatusEffectsEnd(attacker, message);
        return true;
      }
      else {
        // No special resistances
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}...`);
      }

      // Apply critical hit
      const critChance = move.crit ?? 0.1;
      const isCrit = Math.random() < critChance;

      if (isCrit) {
        baseDamage = Math.floor(baseDamage * 1.5);
        await message.channel.send(`Critical hit! 💥`);
      }
      
      // Apply damage and effects
      await applyDamageAndEffects(attacker, defender, baseDamage, move, message);
      
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }
  },

  /**
   * Execute guard action
   * @param {Object} attacker - The entity guarding
   * @param {Object} message - Discord message object
   * @returns {Boolean} Whether guard was successful
   */
  async executeGuard(attacker, message) {
    // Use the guardAction function from damageCalculator
    guardAction(attacker);
    
    const attackerText = getEntityDisplayText(attacker);
    await message.channel.send(`${attackerText} assumes a defensive stance! 🛡️ `);
    
    await statusHandler.processStatusEffectsEnd(attacker, message);
    return true;
  },

  /**
   * Execute basic attack
   * @param {Object} attacker - The attacking entity
   * @param {Object} defender - The defending entity 
   * @param {Object} message - Discord message object
   * @param {Object} demons - Demons data
   * @param {String} attackerText - Display text for attacker
   * @param {String} defenderText - Display text for defender
   * @returns {Boolean} Whether the attack was successful
   */
  async executeBasicAttack(attacker, defender, message, demons, attackerText, defenderText) {
    // Check if attacker can act due to status effects
    if (!statusHandler.processStatusEffectsStart(attacker, message)) {
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true; // Turn used, but couldn't act
    }

    // Create a basic attack move definition
    const basicAttackMove = {
      name: "Attack",
      type: "Physical", 
      power: 100,
      emoji: "🗡️",
      sp: 0,
      usesStrength: true,
      usesMagic: false,
      accuracy: 95,
      desc: "Basic physical attack."
    };

    // Handle redirected targets from status effects
    if (await handleTargetRedirection(attacker, defender, basicAttackMove, message)) {
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }

    // Calculate accuracy with status effect modifiers
    const attackerMods = getStatusEffectModifiers(attacker);
    const defenderMods = getStatusEffectModifiers(defender);
    
    const accuracy = (basicAttackMove.accuracy) * 
                    (attackerMods.accuracyMultiplier ?? 1.0) / 
                    (defenderMods.evasionMultiplier ?? 1.0);
                    
    const roll = Math.random() * 100;
    if (roll > accuracy) {
      await message.channel.send(`${attackerText} attacks... but it MISSES!`);
      await statusHandler.processStatusEffectsEnd(attacker, message);
      return true;
    }

    // Calculate damage context
    let context = {
      attackStageMultiplier: attackerMods.strengthMultiplier || 1,
      defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
      isGuarding: defender.isGuarding || false
    };

    // Calculate damage
    let baseDamage = calculateDamage(attacker, defender, basicAttackMove, context);
    
    // Apply critical hit chance
    const critChance = 0.1; // 10% chance for critical hit for basic attacks
    const isCrit = Math.random() < critChance;
    if (isCrit) {
      baseDamage = Math.floor(baseDamage * 1.5);
      await message.channel.send(`Critical hit! 💥`);
    }
    
    await message.channel.send(`${attackerText} attacks...`);
    
    // Apply damage and effects
    await applyDamageAndEffects(attacker, defender, baseDamage, basicAttackMove, message);
    
    await statusHandler.processStatusEffectsEnd(attacker, message);
    return true;
  },

  /**
   * Execute AI turn for enemy
   * @param {Object} message - Discord message object
   * @param {Object} battleData - Battle data
   * @param {Object} demons - Demons data
   */
  async executeEnemyTurn(message, battleData, demons) {
    const enemy = battleData.enemy;
    const player = battleData.player;
    
    // Check if enemy can act due to status effects
    if (!statusHandler.processStatusEffectsStart(enemy, message)) {
      await statusHandler.processStatusEffectsEnd(enemy, message);
      return; // Turn used, but couldn't act
    }
    
    // Cache move data for enemy's abilities to improve efficiency
    const enemyMoves = enemy.abilities.map(name => ({
      name,
      move: moves[name]
    })).filter(item => item.move !== undefined);
    
    // AI Strategy: Find healing moves
    const healingMoves = enemyMoves.filter(item => 
      item.move.type === 'Healing' && enemy.sp >= item.move.sp
    );
    
    // AI Strategy: Find status moves
    const statusMoves = enemyMoves.filter(item => 
      (item.move.ailment || item.move.debuff) && enemy.sp >= item.move.sp
    );
    
    // AI Strategy: Find offensive moves
    const offensiveMoves = enemyMoves.filter(item => 
      item.move.type !== 'Healing' && item.move.power > 0 && enemy.sp >= item.move.sp
    );
    
    // Decision making
    
    // If HP is below 30% and we have a healing move, use it
    if (enemy.hp < enemy.maxHp * 0.3 && healingMoves.length > 0) {
      const healingMove = healingMoves[Math.floor(Math.random() * healingMoves.length)];
      await this.executeAbility(
        enemy, 
        player, 
        { name: healingMove.name }, 
        message, 
        demons, 
        enemy.name, 
        player.name
      );
    }
    // 15% chance to guard
    else if (Math.random() < 0.15) {
      await this.executeGuard(enemy, message);
    }
    // Try to use a status effect move if target doesn't have one (40% chance)
    else {
      const hasNoAilment = !player.statusEffects || 
                          !player.statusEffects.some(s => s.type === 'ailment');
                          
      if (hasNoAilment && statusMoves.length > 0 && Math.random() < 0.4) {
        const statusMove = statusMoves[Math.floor(Math.random() * statusMoves.length)];
        await this.executeAbility(
          enemy, 
          player, 
          { name: statusMove.name }, 
          message, 
          demons, 
          enemy.name, 
          player.name
        );
      }
      // Try to use an offensive ability if available
      else if (offensiveMoves.length > 0) {
        const offensiveMove = offensiveMoves[Math.floor(Math.random() * offensiveMoves.length)];
        await this.executeAbility(
          enemy, 
          player, 
          { name: offensiveMove.name }, 
          message, 
          demons, 
          enemy.name, 
          player.name
        );
      } 
      // Fall back to basic attack
      else {
        await this.executeBasicAttack(
          enemy,
          player,
          message,
          demons,
          enemy.name,
          player.name
        );
      }
    }
  },

  /**
   * Display battle status and menus
   * @param {Object} message - Discord message object
   * @param {Object} player - Player entity
   * @param {Object} enemy - Enemy entity
   * @param {Boolean} isPlayerTurn - Whether it's player's turn
   */
  async displayBattleStatus(message, player, enemy, isPlayerTurn = true) {
    const attacker = isPlayerTurn ? player : enemy;
    const userId = attacker.userId;
    
    // Create or update menu state for this user
    const menuState = battleMenuManager.getState(userId);
  
    /**
     * Helper to format entity status display
     * @param {Object} entity - The entity to format
     * @returns {String} Formatted status text
     */
    function formatEntityStatus(entity) {
      const mention = entity.userId ? ` (<@${entity.userId}>)` : '';
      
      let status = `**${entity.name}** Lv${entity.level}${mention}\nHP: ${entity.hp} / ${entity.maxHp} | SP: ${entity.sp} / ${entity.maxSp}`;
      
      // Show guard status if active
      if (entity.isGuarding) {
        status += " 🛡️";
      }
      
      // Show status effects
      if (entity.statusEffects && entity.statusEffects.length > 0) {
        status += " | Status: " + entity.statusEffects.map(s => 
          `${s.emoji} ${s.name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turnsRemaining})`
        ).join(", ");
      }
      
      return status;
    }
    
    const attackerMention = getEntityDisplayText(attacker);
  
    // Build status display
    let battleStatus = formatEntityStatus(player);
    battleStatus += `\n\n${formatEntityStatus(enemy)}`;
  
    if (isPlayerTurn !== null) {
      battleStatus += `\n\n${attackerMention}, it's your turn!`;
      
      // Display appropriate menu based on current state
      if (menuState.currentMenu === 'main') {
        // Main menu
        battleStatus += `\nChoose an action:\n`;
        battleStatus += `1 - 🗡️ Attack\n`;
        battleStatus += `2 - 📜 Skills\n`;
        battleStatus += `3 - 🛡️ Guard\n`;
        battleStatus += `\nType the number of your choice.`;
      } else if (menuState.currentMenu === 'skills') {
        // Build skills submenu
        battleStatus += `\nChoose a skill:\n`;
        
        // Map abilities to their move data for display
        const abilitiesWithMoves = attacker.abilities.map((name, i) => {
          const move = moves[name];
          if (!move) return `${i + 1}. ${name} (Unknown Move)`;
          
          return `${i + 1}. ${move.emoji} ${name} — ${move.type} (${move.sp} SP) \n _${move.desc}_\n`;
        });
        
        battleStatus += abilitiesWithMoves.join('\n');
        battleStatus += `\n0 - ⬅️ Back to main menu`;
      }
    }
  
    await message.channel.send(battleStatus);
  },
  
  /**
   * Process menu input from user
   * @param {Object} message - Discord message object
   * @param {String} input - User input
   * @param {Object} battleData - Battle data
   * @param {Object} demons - Demons data
   * @param {Boolean} isPlayerTurn - Whether it's player's turn
   * @returns {Boolean} Whether action was completed
   */
  async processMenuInput(message, input, battleData, demons, isPlayerTurn) {
    const attacker = isPlayerTurn ? battleData.player : battleData.enemy;
    const defender = isPlayerTurn ? battleData.enemy : battleData.player;
    const userId = attacker.userId;
    
    // Get current menu state for this user
    const menuState = battleMenuManager.getState(userId);
    const choice = parseInt(input);
    
    // Text references for messages
    const attackerText = getEntityDisplayText(attacker);
    const defenderText = getEntityDisplayText(defender);
    
    // Process input based on current menu
    if (menuState.currentMenu === 'main') {
      switch (choice) {
        case 1: // Attack
          return await this.executeBasicAttack(
            attacker, defender, message, demons, attackerText, defenderText
          );
          
        case 2: // Skills - change to submenu
          menuState.currentMenu = 'skills';
          await this.displayBattleStatus(message, battleData.player, battleData.enemy, isPlayerTurn);
          return false; // Action not complete, await new input
          
        case 3: // Guard
          return await this.executeGuard(attacker, message);
          
        default:
          await message.channel.send(`Invalid choice. Please select a number from the menu.`);
          return false; // Action not complete, await new input
      }
    } 
    else if (menuState.currentMenu === 'skills') {
      if (choice === 0) {
        // Return to main menu
        menuState.currentMenu = 'main';
        await this.displayBattleStatus(message, battleData.player, battleData.enemy, isPlayerTurn);
        return false; // Action not complete, await new input
      }
      
      // Use ability
      const abilityIndex = choice - 1;
      if (abilityIndex >= 0 && abilityIndex < attacker.abilities.length) {
        const abilityName = attacker.abilities[abilityIndex];
        const result = await this.executeAbility(
          attacker, defender, { name: abilityName }, message, demons, attackerText, defenderText
        );
        
        // Return to main menu after ability use attempt
        menuState.currentMenu = 'main';
        
        return result; // Action complete if ability was used successfully
      } else {
        await message.channel.send(`Invalid skill selection. Please choose a number from the list.`);
        return false; // Action not complete, await new input
      }
    }
    
    return false;
  },
  
  /**
   * Reset menu state for a user
   * @param {String} userId - User ID
   */
  resetMenuState(userId) {
    battleMenuManager.resetState(userId);
  },
  
  /**
   * End turn and clean up
   * @param {Object} demon - Entity ending turn
   * @param {Object} message - Discord message object
   */
  async endTurn(demon, message) {
    // Reset guard status
    demon.isGuarding = false;
  }
};

module.exports = battleHandler;