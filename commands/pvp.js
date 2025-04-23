const dataManager = require('../utils/DataManager');
const BattleManager = require('../utils/BattleManager');

// Track channels currently in battle
const activeBattles = new Set();

module.exports = {
  name: 'pvp',
  description: 'Fight against another player!',
  async execute(message, args) {
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

    const userDemons = await dataManager.getUserDemons(userId);
    const opponentDemons = await dataManager.getUserDemons(opponentId);

    if (!userDemons.length) {
      return message.reply("You don't have any caught demons.");
    }

    if (!opponentDemons.length) {
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
    } catch (error) {
      return message.channel.send(`${opponent.username} did not respond in time. Challenge canceled.`);
    }

    activeBattles.add(channelId);

    try {
      const battleData = await this._initializeBattle(message, userId, opponentId);
      if (!battleData) {
        activeBattles.delete(channelId);
        return;
      }

      await this.battleLoop(message, battleData);
    } finally {
      activeBattles.delete(channelId);
    }
  },

  async _initializeBattle(message, userId, opponentId) {
    const playerDemon = await this._selectDemon(message, userId);
    if (!playerDemon) {
      await message.reply('Your demon selection was invalid. Battle canceled.');
      return null;
    }

    await message.channel.send(`<@${opponentId}>, it's your turn to choose your demon!`);

    const opponentDemon = await this._selectDemon(message, opponentId);
    if (!opponentDemon) {
      await message.reply('Opponent demon selection was invalid. Battle canceled.');
      return null;
    }

    return {
      player: {
        ...playerDemon,
        userId,
        name: playerDemon.name,
        maxHp: playerDemon.hp,
        maxSp: playerDemon.sp,
        hp: playerDemon.hp,
        sp: playerDemon.sp,
        isGuarding: false
      },
      enemy: {
        ...opponentDemon,
        userId: opponentId,
        name: opponentDemon.name,
        maxHp: opponentDemon.hp,
        maxSp: opponentDemon.sp,
        hp: opponentDemon.hp,
        sp: opponentDemon.sp,
        isGuarding: false
      }
    };
  },

  async _selectDemon(message, userId) {
    const userDemons = await dataManager.getUserDemons(userId);
    const demons = await dataManager.getDemons();

    await message.channel.send(
      `<@${userId}>, choose your demon:\n` +
      userDemons.map((d, i) => {
        const demon = demons[d];
        const level = demon?.level ?? '?';
        return `${i + 1}. ${d} (Lv ${level})`;
      }).join('\n')
    );

    try {
      const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === userId && !isNaN(m.content) && 
                     parseInt(m.content) > 0 && parseInt(m.content) <= userDemons.length,
        max: 1,
        time: 30000,
        errors: ['time']
      });

      const index = parseInt(collected.first().content) - 1;
      const selectedName = userDemons[index];
      return demons[selectedName];
    } catch (error) {
      return null;
    }
  },

  async battleLoop(message, battleData) {
    let turn = 'player';
    const demons = await dataManager.getDemons();
    const battleManager = new BattleManager(message, battleData, demons);
  
    while (true) {
      const attacker = turn === 'player' ? battleData.player : battleData.enemy;
      
      attacker.isGuarding = false;
      await battleManager.displayBattleStatus(turn === 'player');
  
      const startTime = Date.now();
      const TIMEOUT = 30000;
      let actionCompleted = false;
  
      while (!actionCompleted) {
        const elapsed = Date.now() - startTime;
        const remaining = TIMEOUT - elapsed;
  
        if (remaining <= 0) {
          await message.channel.send(`<@${attacker.userId}> didn't respond in time. Turn skipped.`);
          break;
        }
  
        try {
          const collected = await message.channel.awaitMessages({
            filter: m => m.author.id === attacker.userId,
            max: 1,
            time: remaining,
            errors: ['time']
          });
          
          actionCompleted = await battleManager.processInput(
            collected.first().content.trim(),
            turn === 'player'
          );
          
        } catch (error) {
          await message.channel.send(`<@${attacker.userId}> didn't respond in time. Turn skipped.`);
          break;
        }
      }
      
      // Check victory after the turn is fully processed
      if (battleData.player.hp <= 0 || battleData.enemy.hp <= 0) {
        break;
      }
  
      turn = turn === 'player' ? 'enemy' : 'player';
    }
  
    battleManager.resetMenuState(battleData.player.userId);
    battleManager.resetMenuState(battleData.enemy.userId);
  
    if (battleData.player.hp <= 0) {
      await message.channel.send(`<@${battleData.player.userId}> was defeated by <@${battleData.enemy.userId}>!`);
    } else {
      await message.channel.send(`<@${battleData.player.userId}> defeated <@${battleData.enemy.userId}>!`);
    }
  }
};