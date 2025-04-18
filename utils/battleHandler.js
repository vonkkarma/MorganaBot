const fs = require('fs');
const moves = require('../moves.json');

module.exports = {
  async promptForDemonSelection(message, userId, caughtDemons, demons) {
    await message.channel.send(
      `<@${userId}>, choose your demon:\n${caughtDemons.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
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
      attacker.hp = Math.min(attacker.hp + move.power, maxHp);
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name} and heals ${move.power} HP!`);
    } else {
      let dmg = move.power + attacker.attack - defender.defense;
      const resist = defender.resistances;

      if (resist?.weak?.includes(move.type)) {
        dmg *= 2;
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... It's super effective!`);
      } else if (resist?.resist?.includes(move.type)) {
        dmg = Math.floor(dmg / 2);
        await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... It's not very effective...`);
      }

      dmg = Math.max(0, dmg);
      defender.hp -= dmg;
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name} and deals ${dmg} damage!`);
    }
  },

  async displayBattleStatus(message, player, enemy, isTurnPrompt = false) {
    let battleStatus = `**You**\n${player.name}: ${player.hp} HP | ${player.sp} SP\n\n**Enemy**\n${enemy.name}: ${enemy.hp} HP | ${enemy.sp} SP`;

    if (isTurnPrompt) {
      battleStatus += `\n\nYour turn! Choose an ability:\n${player.abilities.map((name, i) => {
        const move = moves[name];
        return move
          ? `${i + 1}. ${name} ${move.emoji} (${move.sp} SP)`
          : `${i + 1}. ${name} (Unknown Move)`;
      }).join('\n')}`;      
    }

    await message.channel.send(battleStatus);
  }
};
