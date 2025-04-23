const fs = require('fs');
const BattleManager = require('../utils/BattleManager');
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

    const playerDemon = await this._selectDemon(message, userId, userData[userId].caughtDemons, demons);
    if (!playerDemon) return message.reply('Invalid choice. Battle canceled.');

    const enemyDemon = demons[Object.keys(demons)[Math.floor(Math.random() * Object.keys(demons).length)]];
    await message.channel.send(`A wild ${enemyDemon.name} appears!`);

    const battleData = this._initializeBattleData(playerDemon, enemyDemon, userId);
    await this.battleLoop(message, battleData, demons);
  },

  _initializeBattleData(playerDemon, enemyDemon, userId) {
    return {
      player: { 
        ...playerDemon, 
        name: playerDemon.name, 
        maxHp: playerDemon.hp, 
        hp: playerDemon.hp, 
        sp: playerDemon.sp, 
        maxSp: playerDemon.sp,
        isGuarding: false,
        userId
      },
      enemy: { 
        ...enemyDemon, 
        name: enemyDemon.name, 
        maxHp: enemyDemon.hp, 
        hp: enemyDemon.hp, 
        sp: enemyDemon.sp, 
        maxSp: enemyDemon.sp,
        isGuarding: false
      }
    };
  },

  async _selectDemon(message, userId, caughtDemons, demons) {
    await message.channel.send(
      `<@${userId}>, choose your demon:\n` +
      caughtDemons.map((d, i) => {
        const demon = demons[d];
        const level = demon?.level ?? '?';
        return `${i + 1}. ${d} (Lv ${level})`;
      }).join('\n')
    );

    try {
      const collected = await message.channel.awaitMessages({
        filter: m => m.author.id === userId && !isNaN(m.content) && 
                     parseInt(m.content) > 0 && parseInt(m.content) <= caughtDemons.length,
        max: 1,
        time: 30000,
        errors: ['time']
      });

      const index = parseInt(collected.first().content) - 1;
      const selectedName = caughtDemons[index];
      return demons[selectedName];
    } catch (error) {
      return null;
    }
  },

  async battleLoop(message, battleData, demons) {
    const battleManager = new BattleManager(message, battleData, demons);
    let turn = 'player';
  
    while (battleData.player.hp > 0 && battleData.enemy.hp > 0) {
      if (turn === 'player') {
        // Reset guard state at the beginning of the turn
        battleData.player.isGuarding = false;
        
        await battleManager.displayBattleStatus(true);
  
        // Start the 30s timer for the turn
        const startTime = Date.now();
        const TIMEOUT = 30000;
        let actionCompleted = false;
        
        while (!actionCompleted) {
          const elapsed = Date.now() - startTime;
          const remaining = TIMEOUT - elapsed;
          
          if (remaining <= 0) {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
          
          try {
            const collected = await message.channel.awaitMessages({
              filter: m => m.author.id === message.author.id,
              max: 1,
              time: remaining,
              errors: ['time']
            });
            
            actionCompleted = await battleManager.processInput(
              collected.first().content.trim(),
              true
            );
            
          } catch (error) {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
        }
  
        turn = 'enemy';
      } else {
        battleData.enemy.isGuarding = false;
        await battleManager.executeEnemyTurn();
        turn = 'player';
      }
    }
  
    battleManager.resetMenuState(message.author.id);
  
    if (battleData.player.hp <= 0) {
      await message.channel.send(`You were defeated by ${battleData.enemy.name}. Better luck next time!`);
    } else {
      await message.channel.send(`You defeated ${battleData.enemy.name}! You win!`);
    }
  }
};