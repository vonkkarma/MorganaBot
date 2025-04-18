const fs = require('fs');
const battleUtils = require('../utils/battleHandler');
const userDataPath = './userData.json';

module.exports = {
  name: 'battle',
  description: 'Fight a random demon!',
  async execute(message, args, demons) {
    const userId = message.author.id;
    const userData = fs.existsSync(userDataPath)
      ? JSON.parse(fs.readFileSync(userDataPath))
      : {};

    if (!userData[userId]?.caughtDemons?.length) {
      return message.reply("You don't have any caught demons.");
    }

    const playerDemon = await battleUtils.promptForDemonSelection(message, userId, userData[userId].caughtDemons, demons);
    if (!playerDemon) return message.reply('Invalid choice. Battle canceled.');

    const enemyDemon = demons[Object.keys(demons)[Math.floor(Math.random() * Object.keys(demons).length)]];
    await message.channel.send(`A wild ${enemyDemon.name} appears!`);

    const battleData = {
      player: { ...playerDemon, name: playerDemon.name, maxHp: playerDemon.hp, hp: playerDemon.hp, sp: playerDemon.sp, maxSp: playerDemon.sp, },
      enemy: { ...enemyDemon, name: enemyDemon.name, maxHp: enemyDemon.hp, hp: enemyDemon.hp, sp: enemyDemon.sp, maxSp: enemyDemon.sp }
    };

    await this.battleLoop(message, battleData, demons);
  },

  async battleLoop(message, battleData, demons) {
    let turn = 'player';

    while (battleData.player.hp > 0 && battleData.enemy.hp > 0) {
      if (turn === 'player') {
        await battleUtils.displayBattleStatus(message, battleData.player, battleData.enemy, true);

        try {
          const collected = await message.channel.awaitMessages({
            filter: m => m.author.id === message.author.id,
            max: 1,
            time: 30000,
            errors: ['time']
          });

          const choice = parseInt(collected.first().content);
          const abilityName = battleData.player.abilities[choice - 1];
          if (!abilityName) throw new Error();
          await battleUtils.executeAbility(battleData.player, battleData.enemy, { name: abilityName }, message, demons, battleData.player.name, battleData.enemy.name);
        } catch {
          await message.channel.send('No response. Turn skipped.');
        }

        turn = 'enemy';
      } else {
        const abilityName = battleData.enemy.abilities[0];
        if (!abilityName) {
          await message.channel.send(`${battleData.enemy.name} does nothing...`);
        } else {
          await battleUtils.executeAbility(battleData.enemy, battleData.player, { name: abilityName }, message, demons, battleData.enemy.name, battleData.player.name);
        }

        turn = 'player';
      }
    }

    if (battleData.player.hp <= 0) {
      await message.channel.send(`You were defeated by ${battleData.enemy.name}. Better luck next time!`);
    } else {
      await message.channel.send(`You defeated ${battleData.enemy.name}! You win!`);
    }
  }
};
