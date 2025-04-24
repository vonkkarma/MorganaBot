const dataManager = require('../utils/DataManager');
const BattleManager = require('../utils/BattleManager');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: 'battle',
  description: 'Fight a random demon!',
  async execute(message, args) {
    const userId = message.author.id;
    const userDemons = await dataManager.getUserDemons(userId);

    if (!userDemons.length) {
      return message.reply("You don't have any caught demons.");
    }

    const playerDemon = await this._selectDemon(message, userId, userDemons);
    if (!playerDemon) return message.reply('Invalid choice. Battle canceled.');

    const demons = await dataManager.getDemons();
    const enemyDemon = demons[Object.keys(demons)[Math.floor(Math.random() * Object.keys(demons).length)]];
    await message.channel.send(`A wild ${enemyDemon.name} appears!`);

    const battleData = this._initializeBattleData(playerDemon, enemyDemon, userId);
    await this.battleLoop(message, battleData);
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

  async _selectDemon(message, userId, caughtDemons) {
    const demons = await dataManager.getDemons();
    
    // Sort demons by level, highest to lowest
    const sortedDemons = [...caughtDemons].sort((a, b) => {
      const levelA = demons[a]?.level ?? 0;
      const levelB = demons[b]?.level ?? 0;
      return levelB - levelA;
    });
    
    const itemsPerPage = 5;
    let currentPage = 0;
    const maxPages = Math.ceil(sortedDemons.length / itemsPerPage);

    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = Math.min(start + itemsPerPage, sortedDemons.length);
      const demonList = sortedDemons.slice(start, end).map((d, i) => {
        const demon = demons[d];
        const level = demon?.level ?? '?';
        return `${start + i + 1}. ${d} (Lv ${level})`;
      }).join('\n');

      return `<@${userId}>, choose your demon:\n${demonList}`;
    };

    const generateButtons = (page) => {
      const rows = [];
      const buttonRow = new ActionRowBuilder();
      
      // Add number buttons for demons on current page
      const start = page * itemsPerPage;
      const end = Math.min(start + itemsPerPage, sortedDemons.length);
      for (let i = start; i < end; i++) {
        buttonRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`demon_${i}`)
            .setLabel(`${i + 1}`)
            .setStyle(ButtonStyle.Primary)
        );
      }
      rows.push(buttonRow);

      // Add navigation buttons if needed
      if (maxPages > 1) {
        const navigationRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('prev_page')
              .setLabel('Previous')
              .setEmoji('⬅️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page === 0),
            new ButtonBuilder()
              .setCustomId('next_page')
              .setLabel('Next')
              .setEmoji('➡️')
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(page >= maxPages - 1)
          );
        rows.push(navigationRow);
      }

      return rows;
    };

    const reply = await message.channel.send({
      content: generateEmbed(currentPage),
      components: generateButtons(currentPage)
    });

    try {
      const filter = i => {
        if (i.user.id !== userId) {
          i.reply({ content: "This isn't your battle!", ephemeral: true });
          return false;
        }
        return true;
      };

      while (true) {
        const interaction = await reply.awaitMessageComponent({ filter, time: 30000 });
        
        // Acknowledge the interaction first
        await interaction.deferUpdate();
        
        if (interaction.customId === 'prev_page') {
          currentPage = Math.max(0, currentPage - 1);
          await reply.edit({
            content: generateEmbed(currentPage),
            components: generateButtons(currentPage)
          });
        }
        else if (interaction.customId === 'next_page') {
          currentPage = Math.min(maxPages - 1, currentPage + 1);
          await reply.edit({
            content: generateEmbed(currentPage),
            components: generateButtons(currentPage)
          });
        }
        else if (interaction.customId.startsWith('demon_')) {
          const index = parseInt(interaction.customId.split('_')[1]);
          const selectedName = sortedDemons[index]; // Use sortedDemons instead of caughtDemons
          await reply.edit({ components: [] });
          return demons[selectedName];
        }
      }
    } catch (error) {
      await reply.edit({ components: [] });
      return null;
    }
  },

  async battleLoop(message, battleData) {
    let turn = 'player';
    const battleManager = new BattleManager(message, battleData, await dataManager.getDemons());
    let battleMsg = null;

    while (true) {
      if (turn === 'player') {
        battleData.player.isGuarding = false;
        // Only send a new message if none exists, otherwise edit
        if (!battleMsg) {
          // displayBattleStatus returns the sent message
          battleMsg = await battleManager.displayBattleStatus(true);
        } else {
          await battleManager.displayBattleStatus(true, battleMsg);
        }

        const filter = i => {
          if (i.user.id !== battleData.player.userId) {
            i.reply({ content: "This isn't your turn!", ephemeral: true });
            return false;
          }
          return true;
        };

        try {
          const interaction = await message.channel.awaitMessageComponent({ filter, time: 30000 });
          const actionCompleted = await battleManager.processInput(interaction, true);
          // After an action, if the menu is reset, clear the reference so a new message is sent next turn
          if (actionCompleted) {
            battleMsg = null;
            turn = 'enemy';
          }
        } catch (error) {
          await message.channel.send('No response. Turn skipped.');
          battleMsg = null;
          turn = 'enemy';
        }
      } else {
        battleData.enemy.isGuarding = false;
        await battleManager.executeEnemyTurn();
        battleMsg = null;
        turn = 'player';
      }

      if (battleData.player.hp <= 0 || battleData.enemy.hp <= 0) {
        break;
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