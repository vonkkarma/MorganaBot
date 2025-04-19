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
    const battleHandler = require('../utils/battleHandler');
  
    while (battleData.player.hp > 0 && battleData.enemy.hp > 0) {
      if (turn === 'player') {
        // Resetar o estado de guarda no início do turno
        battleData.player.isGuarding = false;
        
        await battleHandler.displayBattleStatus(message, battleData.player, battleData.enemy, true);
  
        // Rastrear se a ação foi completada
        let actionCompleted = false;
        
        // Iniciar o timer de 30s para o turno
        const startTime = Date.now();
        const TIMEOUT = 30000;
        
        while (!actionCompleted) {
          const elapsed = Date.now() - startTime;
          const remaining = TIMEOUT - elapsed;
          
          // Se o tempo acabou, pular o turno
          if (remaining <= 0) {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
          
          try {
            // Esperar apenas o tempo restante
            const collected = await message.channel.awaitMessages({
              filter: m => m.author.id === message.author.id,
              max: 1,
              time: remaining,
              errors: ['time']
            });
            
            const input = collected.first().content.trim();
            
            // Processar a entrada usando a nova função
            actionCompleted = await battleHandler.processMenuInput(
              message, 
              input, 
              battleData, 
              demons, 
              true // isPlayerTurn
            );
            
          } catch {
            await message.channel.send('No response. Turn skipped.');
            break;
          }
        }
  
        turn = 'enemy';
      } else {
        // Resetar o estado de guarda do inimigo no início do turno
        battleData.enemy.isGuarding = false;
        
        // Lógica de IA do inimigo 
        const abilityName = battleData.enemy.abilities[0];
        if (!abilityName) {
          await message.channel.send(`${battleData.enemy.name} does nothing...`);
        } else {
          await battleHandler.executeAbility(
            battleData.enemy, 
            battleData.player, 
            { name: abilityName }, 
            message, 
            demons, 
            battleData.enemy.name, 
            battleData.player.name
          );
        }
  
        turn = 'player';
      }
    }
  
    // Resetar o estado do menu quando a batalha terminar
    battleHandler.resetMenuState(message.author.id);
  
    if (battleData.player.hp <= 0) {
      await message.channel.send(`You were defeated by ${battleData.enemy.name}. Better luck next time!`);
    } else {
      await message.channel.send(`You defeated ${battleData.enemy.name}! You win!`);
    }
  }
};
