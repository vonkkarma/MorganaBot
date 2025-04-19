const fs = require('fs');
const moves = require('../moves.json');
const { calculateDamage, guardAction, shouldTargetAlly, checkStatusBreakOnDamage, getStatusEffectModifiers } = require('./damageCalculator');
const statusHandler = require('./statusHandler');

// Track battle menu state for all active users
const battleMenuState = {};

module.exports = {
  async promptForDemonSelection(message, userId, caughtDemons, demons) {
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
        return null;
      }
      
      const selectedName = caughtDemons[index];
      const demon = demons[selectedName];
      if (demon) {
        return demon;
      }
    } catch (error) {
      return null;
    }

    return null;
  },

  async executeAbility(attacker, defender, ability, message, demons, attackerText, defenderText) {
    if (!ability) return false;
    const move = moves[ability.name]; // Get the full move from moves.json
    if (!move) return false;

    // Check if attacker can act due to status effects
    if (!statusHandler.processStatusEffectsStart(attacker, message)) {
      return true; // Turn used, but couldn't act
    }

    // Check SP cost
    if (attacker.sp < move.sp) {
      await message.channel.send(`${attackerText} doesn't have enough SP to use ${ability.name}!`);
      return false;
    }

    // Deduct SP
    attacker.sp -= move.sp;

    // Charm/Brainwash status effects can redirect targets
    const redirectTarget = shouldTargetAlly(attacker);
    if (redirectTarget && move.type !== 'Healing') {
      if (statusHandler.hasStatusEffect(attacker, 'charm')) {
        // For charm, target allies instead
        await message.channel.send(`${attackerText} is charmed 💘 and attacks an ally instead!`);
        // In a multiplayer scenario, you'd redirect to a different target here
      } else if (statusHandler.hasStatusEffect(attacker, 'brainwash')) {
        // For brainwash, heal enemies instead of attacking
        await message.channel.send(`${attackerText} is brainwashed 🧠 and attempts to heal the enemy!`);
        const healAmount = Math.floor(move.power / 2);
        defender.hp = Math.min(defender.hp + healAmount, defender.maxHp);
        await message.channel.send(`${defenderText} recovers ${healAmount} HP!`);
        return true;
      }
    }

    // Handle healing moves
    if (move.type === 'Healing') {
      const maxHp = demons[attacker.name]?.hp || attacker.maxHp;
      const baseHeal = move.power;
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

      return true;
    }
    else {
      const resist = defender.resistances;

      // Calculate accuracy with status effect modifiers
      const attackerMods = getStatusEffectModifiers(attacker);
      const defenderMods = getStatusEffectModifiers(defender);
      
      const accuracy = (move.accuracy ?? 100) * 
                      (attackerMods.accuracyMultiplier ?? 1.0) / 
                      (defenderMods.evasionMultiplier ?? 1.0);
                      
      const roll = Math.random() * 100;
      if (roll > accuracy) {
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it MISSES!`);
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
        return true;
      }
      else if (isDrain) {
        const healedAmount = Math.max(0, Math.floor(baseDamage));
        defender.hp = Math.min(defender.maxHp, defender.hp + healedAmount);
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it's drained! ${defenderText} heals ${healedAmount} HP! 💉`);
        return true;
      }
      else if (isRepel) {
        attacker.hp -= baseDamage;
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... it's reflected! ${attackerText} takes ${baseDamage} damage! 🔁`);
        return true;
      }
      else {
        // No special resistances
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}...`);
      }

      const critChance = move.crit ?? 0.1;
      const isCrit = Math.random() < critChance;

      if (isCrit) {
        baseDamage = Math.floor(baseDamage * 1.5);
        await message.channel.send(`Critical hit! 💥`);
      }
      
      // Apply damage
      defender.hp -= baseDamage;
      await message.channel.send(`${defenderText} takes ${baseDamage} damage!`);
      
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
      
      return true;
    }
  },

  // Proper implementation of guard action
  async executeGuard(attacker, message) {
    // Use the guardAction function from damageCalculator
    guardAction(attacker);
    
    const attackerText = attacker.userId ? `<@${attacker.userId}> (${attacker.name})` : attacker.name;
    await message.channel.send(`${attackerText} assumes a defensive stance! 🛡️ `);
    
    return true;
  },

  // Basic attack implementation
  async executeBasicAttack(attacker, defender, message, demons, attackerText, defenderText) {
    // Check if attacker can act due to status effects
    if (!statusHandler.processStatusEffectsStart(attacker, message)) {
      return true; // Turn used, but couldn't act
    }

    // Charm/Brainwash status effects can redirect targets
    const redirectTarget = shouldTargetAlly(attacker);
    if (redirectTarget) {
      if (statusHandler.hasStatusEffect(attacker, 'charm')) {
        // For charm, target allies instead
        await message.channel.send(`${attackerText} is charmed 💘 and attacks an ally instead!`);
        // In a multiplayer scenario, you'd redirect to a different target here
      } else if (statusHandler.hasStatusEffect(attacker, 'brainwash')) {
        // For brainwash, heal enemies instead of attacking
        await message.channel.send(`${attackerText} is brainwashed 🧠 and attempts to heal the enemy!`);
        const healAmount = Math.floor(attacker.strength / 2);
        defender.hp = Math.min(defender.hp + healAmount, defender.maxHp);
        await message.channel.send(`${defenderText} recovers ${healAmount} HP!`);
        return true;
      }
    }
  
    // Create a basic attack move
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

    // Calculate accuracy with status effect modifiers
    const attackerMods = getStatusEffectModifiers(attacker);
    const defenderMods = getStatusEffectModifiers(defender);
    
    const accuracy = (basicAttackMove.accuracy) * 
                    (attackerMods.accuracyMultiplier ?? 1.0) / 
                    (defenderMods.evasionMultiplier ?? 1.0);
                    
    const roll = Math.random() * 100;
    if (roll > accuracy) {
      await message.channel.send(`${attackerText} attacks... but it MISSES!`);
      return true;
    }

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
    
    // Apply damage
    defender.hp -= baseDamage;
    
    await message.channel.send(`${attackerText} attacks and deals ${baseDamage} damage!`);
    
    // Check for broken status effects when hit
    const brokenEffects = checkStatusBreakOnDamage(defender, "Physical");
    if (brokenEffects && brokenEffects.length > 0) {
      for (const effect of brokenEffects) {
        await message.channel.send(`${defenderText}'s ${effect} status was broken by the attack!`);
      }
    }
    
    return true;
  },

  // AI logic for enemy turn
  async executeEnemyTurn(message, battleData, demons) {
    const enemy = battleData.enemy;
    const player = battleData.player;
    
    // Check if enemy can act due to status effects
    if (!statusHandler.processStatusEffectsStart(enemy, message)) {
      // Process end-of-turn status effects
      await statusHandler.processStatusEffectsEnd(enemy, message);
      return; // Turn used, but couldn't act
    }
    
    // Simple AI logic - prioritize healing at low health, 
    // guard occasionally, and otherwise use best attack
    
    const healingMove = enemy.abilities.find(name => {
      const move = moves[name];
      return move && move.type === 'Healing' && enemy.sp >= move.sp;
    });
    
    // If HP is below 30% and we have a healing move, use it
    if (enemy.hp < enemy.maxHp * 0.3 && healingMove) {
      await this.executeAbility(
        enemy, 
        player, 
        { name: healingMove }, 
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
    // Try to use a status effect move if target doesn't have one
    else {
      const statusMoves = enemy.abilities.filter(name => {
        const move = moves[name];
        return move && 
               enemy.sp >= move.sp && 
               (move.ailment || move.debuff);
      });
      
      const hasNoAilment = !player.statusEffects || 
                          !player.statusEffects.some(s => s.type === 'ailment');
                          
      if (hasNoAilment && statusMoves.length > 0 && Math.random() < 0.4) {
        // 40% chance to try a status move if player has no ailment
        const statusMove = statusMoves[Math.floor(Math.random() * statusMoves.length)];
        await this.executeAbility(
          enemy, 
          player, 
          { name: statusMove }, 
          message, 
          demons, 
          enemy.name, 
          player.name
        );
      }
      else {
        // Try to use a random offensive ability if we have SP
        const usableAbilities = enemy.abilities.filter(name => {
          const move = moves[name];
          return move && enemy.sp >= move.sp && move.type !== 'Healing';
        });
        
        if (usableAbilities.length > 0) {
          const abilityName = usableAbilities[Math.floor(Math.random() * usableAbilities.length)];
          await this.executeAbility(
            enemy, 
            player, 
            { name: abilityName }, 
            message, 
            demons, 
            enemy.name, 
            player.name
          );
        } else {
          // Fall back to basic attack
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
    }
    
    // Process end-of-turn status effects
    await statusHandler.processStatusEffectsEnd(enemy, message);
  },

  async displayBattleStatus(message, player, enemy, isPlayerTurn = true) {
    const attacker = isPlayerTurn ? player : enemy;
    const userId = attacker.userId;
    
    if (!battleMenuState[userId]) {
      battleMenuState[userId] = {
        currentMenu: 'main', // 'main' or 'skills'
      };
    }
  
    const playerMention = player.userId ? ` (<@${player.userId}>)` : '';
    const enemyMention = enemy.userId ? ` (<@${enemy.userId}>)` : '';
    const attackerMention = attacker.userId ? `<@${attacker.userId}>` : attacker.name;
  
    let battleStatus = `**${player.name}** Lv${player.level}${playerMention}\nHP: ${player.hp} / ${player.maxHp} | SP: ${player.sp} / ${player.maxSp}`;
    
    // Show guard status if active
    if (player.isGuarding) {
      battleStatus += " 🛡️";
    }
    
    // Show status effects
    if (player.statusEffects && player.statusEffects.length > 0) {
      battleStatus += " | Status: " + player.statusEffects.map(s => 
        `${s.emoji} ${s.name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turnsRemaining})`
      ).join(", ");
    }
    
    battleStatus += `\n\n**${enemy.name}** Lv${enemy.level}${enemyMention}\nHP: ${enemy.hp} / ${enemy.maxHp} | SP: ${enemy.sp} / ${enemy.maxSp}`;
    
    if (enemy.isGuarding) {
      battleStatus += " 🛡️";
    }
    
    // Show status effects
    if (enemy.statusEffects && enemy.statusEffects.length > 0) {
      battleStatus += " | Status: " + enemy.statusEffects.map(s => 
        `${s.emoji} ${s.name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turnsRemaining})`
      ).join(", ");
    }
  
    if (isPlayerTurn !== null) {
      battleStatus += `\n\n${attackerMention}, it's your turn!`;
      
      // Display appropriate menu based on current state
      if (battleMenuState[userId].currentMenu === 'main') {
        // Main menu
        battleStatus += `\nChoose an action:\n`;
        battleStatus += `1 - 🗡️ Attack\n`;
        battleStatus += `2 - 📜 Skills\n`;
        battleStatus += `3 - 🛡️ Guard\n`;
        battleStatus += `\nType the number of your choice.`;
      } else if (battleMenuState[userId].currentMenu === 'skills') {
        // Skills submenu
        battleStatus += `\nChoose a skill:\n${attacker.abilities.map((name, i) => {
          const move = moves[name];
          return move
            ? `${i + 1}. ${move.emoji} ${name} — ${move.type} (${move.sp} SP) \n _${move.desc}_\n`
            : `${i + 1}. ${name} (Unknown Move)`;
        }).join('\n')}`;
        battleStatus += `\n0 - ⬅️ Back to main menu`;
      }
    }
  
    await message.channel.send(battleStatus);
  },
  
  // Process user input based on menu state
  async processMenuInput(message, input, battleData, demons, isPlayerTurn) {
    const attacker = isPlayerTurn ? battleData.player : battleData.enemy;
    const defender = isPlayerTurn ? battleData.enemy : battleData.player;
    const userId = attacker.userId;
    
    // Ensure battleMenuState for this user exists
    if (!battleMenuState[userId]) {
      battleMenuState[userId] = { currentMenu: 'main' };
    }
    
    const menuState = battleMenuState[userId];
    const choice = parseInt(input);
    
    // Text references for messages
    const attackerText = attacker.userId ? `<@${attacker.userId}> (${attacker.name})` : attacker.name;
    const defenderText = defender.userId ? `<@${defender.userId}> (${defender.name})` : defender.name;
    
    // Process input based on current menu
    if (menuState.currentMenu === 'main') {
      switch (choice) {
        case 1: // Attack
          const result = await this.executeBasicAttack(attacker, defender, message, demons, attackerText, defenderText);
          if (result) {
            // Process end-of-turn status effects
            await statusHandler.processStatusEffectsEnd(attacker, message);
          }
          return result;
          
        case 2: // Skills - change to submenu
          menuState.currentMenu = 'skills';
          await this.displayBattleStatus(message, battleData.player, battleData.enemy, isPlayerTurn);
          return false; // Action not complete, await new input
          
        case 3: // Guard
          const guardResult = await this.executeGuard(attacker, message);
          if (guardResult) {
            // Process end-of-turn status effects
            await statusHandler.processStatusEffectsEnd(attacker, message);
          }
          return guardResult;
          
        default:
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
        const result = await this.executeAbility(attacker, defender, { name: abilityName }, message, demons, attackerText, defenderText);
        menuState.currentMenu = 'main'; // Return to main menu after using ability
        
        if (result) {
          // Process end-of-turn status effects
          await statusHandler.processStatusEffectsEnd(attacker, message);
        }
        
        return result; // Action complete if ability was used successfully
      } else {
        return false; // Action not complete, await new input
      }
    }
    
    return false; 
  },
  
  // Reset menu state for a user
  resetMenuState(userId) {
    if (battleMenuState[userId]) {
      battleMenuState[userId].currentMenu = 'main';
    }
  },
  
  // End turn function - resets guard and processes status effects
  async endTurn(demon, message) {
    // Reset guard status
    demon.isGuarding = false;
    
    // Process status effects at end of turn
    await statusHandler.processStatusEffectsEnd(demon, message);
  },
  
  // Export battleMenuState for use in other modules
  battleMenuState
};