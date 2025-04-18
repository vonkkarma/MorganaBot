const fs = require('fs');
const battleUtils = require('../utils/battleHandler');
const userDataPath = './userData.json';

// Track channels currently in battle
const activeBattles = new Set();

module.exports = {
  name: 'pvp',
  description: 'Fight against another player!',
  async execute(message, args, demons) {
    const channelId = message.channel.id;

    if (activeBattles.has(channelId)) {
      return message.reply("A battle is already in progress in this channel. Please wait for it to finish.");
    }

    const userId = message.author.id;
    const opponent = message.mentions.users.first();

    if (!opponent) {
      return message.reply('Please mention a user to challenge! Example: `&pvp @username`');
    }

    const opponentId = opponent.id;

    if (opponentId === userId) {
      return message.reply("This isn't Persona 4! You can't fight yourself.");
    }

    const userData = fs.existsSync(userDataPath)
      ? JSON.parse(fs.readFileSync(userDataPath))
      : {};

    if (!userData[userId]?.caughtDemons?.length) {
      return message.reply("You don't have any caught demons.");
    }

    if (!userData[opponentId]?.caughtDemons?.length) {
      return message.reply(`${opponent.username} doesn't have any caught demons.`);
    }

    // Ask for consent
    await message.channel.send(`<@${opponentId}>, you have been challenged by <@${userId}>! Do you accept? (yes/no)`);

    try {
      const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === opponentId && ['yes', 'no'].includes(m.content.toLowerCase()),
        max: 1,
        time: 30000,
        errors: ['time']
      });

      const response = collected.first().content.toLowerCase();
      if (response !== 'yes') {
        return message.channel.send(`${opponent.username} declined the PvP challenge.`);
      }
    } catch {
      return message.channel.send(`${opponent.username} did not respond in time. Challenge canceled.`);
    }

    activeBattles.add(channelId);

    try {
      const playerDemon = await battleUtils.promptForDemonSelection(message, userId, userData[userId].caughtDemons, demons);
      if (!playerDemon) return message.reply('Your demon selection was invalid. Battle canceled.');

      await message.channel.send(`<@${opponentId}>, it's your turn to choose your demon!`);

      const opponentDemon = await battleUtils.promptForDemonSelection(message, opponentId, userData[opponentId].caughtDemons, demons);
      if (!opponentDemon) return message.reply('Opponent demon selection was invalid. Battle canceled.');

      const battleData = {
        player: {
          ...playerDemon,
          userId,
          name: playerDemon.name,
          maxHp: playerDemon.hp,
          hp: playerDemon.hp,
          sp: playerDemon.sp,
        },
        enemy: {
          ...opponentDemon,
          userId: opponentId,
          name: opponentDemon.name,
          maxHp: opponentDemon.hp,
          hp: opponentDemon.hp,
          sp: opponentDemon.sp,
        }
      };

      await this.battleLoop(message, battleData, demons);
    } finally {
      // Release channel lock
      activeBattles.delete(channelId);
    }
  },

  async battleLoop(message, battleData, demons) {
    let turn = 'player';

    while (battleData.player.hp > 0 && battleData.enemy.hp > 0) {
      const attacker = turn === 'player' ? battleData.player : battleData.enemy;
      const defender = turn === 'player' ? battleData.enemy : battleData.player;

      await battleUtils.displayBattleStatus(message, battleData.player, battleData.enemy, turn === 'player');

      try {
        const collected = await message.channel.awaitMessages({
          filter: m => m.author.id === attacker.userId,
          max: 1,
          time: 30000,
          errors: ['time']
        });

        const choice = parseInt(collected.first().content);
        const abilityName = attacker.abilities[choice - 1];
        if (!abilityName) throw new Error();

        await battleUtils.executeAbility(
          attacker,
          defender,
          { name: abilityName },
          message,
          demons,
          `<@${attacker.userId}> (${attacker.name})`,
          `<@${defender.userId}> (${defender.name})`
        );
      } catch {
        await message.channel.send(`<@${attacker.userId}> didn't respond. Turn skipped.`);
      }

      turn = turn === 'player' ? 'enemy' : 'player';
    }

    if (battleData.player.hp <= 0) {
      await message.channel.send(`<@${battleData.player.userId}> was defeated by <@${battleData.enemy.userId}>!`);
    } else {
      await message.channel.send(`<@${battleData.player.userId}> defeated <@${battleData.enemy.userId}>!`);
    }
  }
};
