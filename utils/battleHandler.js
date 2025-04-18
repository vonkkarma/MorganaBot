const fs = require('fs');
const moves = require('../moves.json');
const { calculateDamage } = require('./damageCalculator');

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
      const selectedName = caughtDemons[index];
      const demon = demons[selectedName];
      if (demon) {
        return demon;
      }
    } catch {
      return null;
    }

    return null;
  },

  async executeAbility(attacker, defender, ability, message, demons, attackerText, defenderText) {
    if (!ability) return;
    const move = moves[ability.name]; // Get the full move from moves.json
    if (!move) return;

    if (attacker.sp < move.sp) {
      await message.channel.send(`${attackerText} doesn't have enough SP to use ${ability.name}!`);
      return;
    }

    // Deduct SP
    attacker.sp -= move.sp;

    if (move.type === 'Healing') {
      const maxHp = demons[attacker.name]?.hp || attacker.maxHp;
      const baseHeal = move.power;
      const percentHeal = Math.floor(maxHp * (move.healingPercent || 0));
      const totalHeal = baseHeal + percentHeal;
    
      attacker.hp = Math.min(attacker.hp + totalHeal, maxHp);
    
      await message.channel.send(
        `${attackerText} uses ${move.emoji} ${ability.name} and heals ${totalHeal} HP!`
      );
    }
     else {
      const resist = defender.resistances;
    
      let context = {
        attackStageMultiplier: 1,
        defenseStageMultiplier: 1,
        // add other multipliers here if needed
        isGuarding: false
      };
    
      

    
      let efficacy = 1;
      let baseDamage = calculateDamage(attacker, defender, move, context);
      baseDamage = Math.floor(baseDamage * efficacy);
      
      const isWeak = resist?.weak?.includes(move.type);
      const isResist = resist?.resist?.includes(move.type);
      // Later implement repels, nulls, and drains too

      if (isWeak) {
        efficacy = 1.25; // baseline SMT V multiplier
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... WEAK!`);
      } else if (isResist) {
        efficacy = 0.5; // baseline resist multiplier
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... RESIST!`);
      }

    
      baseDamage = Math.max(0, baseDamage);
      defender.hp -= baseDamage;
    
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name} and deals ${baseDamage} damage!`);
    }
    
  },

  async displayBattleStatus(message, player, enemy, isPlayerTurn = true) {
    const attacker = isPlayerTurn ? player : enemy;
  
    const playerMention = player.userId ? ` (<@${player.userId}>)` : '';
    const enemyMention = enemy.userId ? ` (<@${enemy.userId}>)` : '';
    const attackerMention = attacker.userId ? `<@${attacker.userId}>` : attacker.name;
  
    let battleStatus = `**${player.name}** Lv${player.level}${playerMention}\nHP: ${player.hp} / ${player.maxHp} | SP: ${player.sp} / ${player.maxSp}\n\n` +
                       `**${enemy.name}** Lv${enemy.level}${enemyMention}\nHP: ${enemy.hp} / ${enemy.maxHp} | SP: ${enemy.sp} / ${enemy.maxSp}`;
  
    if (isPlayerTurn !== null) {
      battleStatus += `\n\n${attackerMention}, it's your turn! Choose an ability:\n${attacker.abilities.map((name, i) => {
        const move = moves[name];
        return move
          ? `${i + 1}. ${move.emoji} ${name} — ${move.type} (${move.sp} SP)`
          : `${i + 1}. ${name} (Unknown Move)`;
      }).join('\n')}`;
    }
  
    await message.channel.send(battleStatus);
  }
  
  
};
