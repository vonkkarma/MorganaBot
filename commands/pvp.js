const dataManager = require('../utils/DataManager');
const BattleManager = require('../utils/BattleManager');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

    // Sort demons by level, highest to lowest
    const sortedDemons = [...userDemons].sort((a, b) => {
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
          i.reply({ content: "This isn't your demon selection!", ephemeral: true });
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
          const selectedName = sortedDemons[index];
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
    const demons = await dataManager.getDemons();
    const battleManager = new BattleManager(message, battleData, demons);
  
    while (true) {
      const attacker = turn === 'player' ? battleData.player : battleData.enemy;
      
      attacker.isGuarding = false;
      await battleManager.displayBattleStatus(turn === 'player');
  
      const filter = i => {
        if (i.user.id !== attacker.userId) {
          i.reply({ content: "This isn't your turn!", ephemeral: true });
          return false;
        }
        return true;
      };

      try {
        const interaction = await message.channel.awaitMessageComponent({ filter, time: 30000 });
        const actionCompleted = await battleManager.processInput(interaction, turn === 'player');
        
        if (actionCompleted) {
          turn = turn === 'player' ? 'enemy' : 'player';
        }
      } catch (error) {
        await message.channel.send(`<@${attacker.userId}> didn't respond in time. Turn skipped.`);
        turn = turn === 'player' ? 'enemy' : 'player';
      }

      if (battleData.player.hp <= 0 || battleData.enemy.hp <= 0) {
        break;
      }
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