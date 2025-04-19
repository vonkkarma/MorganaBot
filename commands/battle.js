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
      player: { 
        ...playerDemon, 
        name: playerDemon.name, 
        maxHp: playerDemon.hp, 
        hp: playerDemon.hp, 
        sp: playerDemon.sp, 
        maxSp: playerDemon.sp,
        isGuarding: false
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

    await this.battleLoop(message, battleData, demons);
  },

  async battleLoop(message, battleData, demons) {
    let turn = 'player';
    const battleHandler = require('../utils/battleHandler');
  
    while (battleData.player.hp > 0 && battleData.enemy.hp > 0) {
      if (turn === 'player') {
        // Reset guard state at the beginning of the turn
        battleData.player.isGuarding = false;
        
        await battleHandler.displayBattleStatus(message, battleData.player, battleData.enemy, true);
  
        // Track if the action was completed
        let actionCompleted = false;
        
        // Start the 30s timer for the turn
        const startTime = Date.now();
        const TIMEOUT = 30000;
        
        while (!actionCompleted) {
          const elapsed = Date.now() - startTime;
          const remaining = TIMEOUT - elapsed;
          
          // If time ran out, skip the turn
          if (remaining <= 0) {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
          
          try {
            // Wait only for the remaining time
            const collected = await message.channel.awaitMessages({
              filter: m => m.author.id === message.author.id,
              max: 1,
              time: remaining,
              errors: ['time']
            });
            
            const input = collected.first().content.trim();
            
            // Process input using the new function
            actionCompleted = await battleHandler.processMenuInput(
              message, 
              input, 
              battleData, 
              demons, 
              true // isPlayerTurn
            );
            
          } catch (error) {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
        }
  
        turn = 'enemy';
      } else {
        // Reset the enemy's guard state at the beginning of the turn
        battleData.enemy.isGuarding = false;
        
        // Enemy AI logic
        await battleHandler.executeEnemyTurn(message, battleData, demons);
  
        turn = 'player';
      }
    }
  
    // Reset the menu state when the battle ends
    battleHandler.resetMenuState(message.author.id);
  
    if (battleData.player.hp <= 0) {
      await message.channel.send(`You were defeated by ${battleData.enemy.name}. Better luck next time!`);
    } else {
      await message.channel.send(`You defeated ${battleData.enemy.name}! You win!`);
    }
  }
};