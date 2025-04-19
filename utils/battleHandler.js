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

    const accuracy = move.accuracy ?? 100;
    const roll = Math.random() * 100;
    if (roll > accuracy) {
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it MISSES!`);
      return;
    }

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
        isGuarding: false
      };
    
      let efficacy = 1;
      let baseDamage = calculateDamage(attacker, defender, move, context);
      baseDamage = Math.floor(baseDamage * efficacy);
      
      const isWeak = resist?.weak?.includes(move.type);
      const isResist = resist?.resist?.includes(move.type);
      const isNull = resist?.null?.includes(move.type);
      const isDrain = resist?.drain?.includes(move.type);
      const isRepel = resist?.repel?.includes(move.type);
      
      switch(true){
        case (isWeak): {
          efficacy = 1.25; // baseline SMT V multiplier
          await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... WEAK‼️!`);
        } case (isResist): {
          efficacy = 0.5; // baseline resist multiplier
          await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... RESIST🛡!`);
        } case (isNull): {
          await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it has no effect! ❌`);
          return;
        } case (isDrain): {
          const healedAmount = Math.max(0, Math.floor(baseDamage));
          defender.hp = Math.min(defender.maxHp, defender.hp + healedAmount);
          await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... but it's drained! ${defenderText} heals ${healedAmount} HP! 💉`);
          return;
        } case (isRepel): {
          attacker.hp -= baseDamage;
          await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name}... it's reflected! ${attackerText} takes ${baseDamage} damage! 🔁`);
          return;
        }
      }

      const critChance = move.crit ?? 0.1;
      const isCrit = Math.random() < critChance;

      if (isCrit) {
        baseDamage = Math.floor(baseDamage * 1.5);
        await message.channel.send(`Critical hit! 💥`);
      }
      defender.hp -= baseDamage;
      
      await message.channel.send(`${attackerText} uses ${move.emoji} ${ability.name} and deals ${baseDamage} damage!`);
    }
  },

  // Função para implementar a lógica de guarda
  async executeGuard(attacker, message) {
    // Define a flag de guarda - esta é a lógica de guarda que você pode precisar ajustar
    attacker.isGuarding = true;
    
    // Redução de dano e outros efeitos de guarda podem ser definidos aqui
    // O contexto.isGuarding já é verificado em calculateDamage
    
    await message.channel.send(`${attacker.userId ? `<@${attacker.userId}>` : attacker.name} assumes a defensive stance! 🛡️`);
    
    // Redefina o estado de guarda no final do turno (isso deverá ser chamado em outro lugar)
    // Talvez adicionar uma função resetGuard() que será chamada no início de cada turno
    return true;
  },

  // Nova função para executar um ataque básico
  async executeBasicAttack(attacker, defender, message, demons, attackerText, defenderText) {
    // Criar um movimento básico de ataque
    const basicAttackMove = {
      name: "Attack",
      type: "Physical", 
      power: 100,
      emoji: "🗡️",
      sp: 0,
      usesStrength: true,
      usesMagic: false,
      accuracy: 95,
      desc: "Basic physical attack."
    };

    let context = {
      attackStageMultiplier: 1,
      defenseStageMultiplier: 1,
      isGuarding: false
    };

    // Cálculo de acerto
    const accuracy = basicAttackMove.accuracy;
    const roll = Math.random() * 100;
    if (roll > accuracy) {
      await message.channel.send(`${attackerText} attacks... but it MISSES!`);
      return;
    }

    // Calcular dano
    let baseDamage = calculateDamage(attacker, defender, basicAttackMove, context);
    
    // Aplicar crítico
    const critChance = 0.1; // 10% de chance de crítico para ataques básicos
    const isCrit = Math.random() < critChance;
    if (isCrit) {
      baseDamage = Math.floor(baseDamage * 1.5);
      await message.channel.send(`Critical hit! 💥`);
    }
    
    // Aplicar dano
    defender.hp -= baseDamage;
    
    await message.channel.send(`${attackerText} attacks and deals ${baseDamage} damage!`);
  },

  // Estado do menu principal
  battleMenuState: {},

  async displayBattleStatus(message, player, enemy, isPlayerTurn = true) {
    const attacker = isPlayerTurn ? player : enemy;
    const userId = attacker.userId;
    
    if (!this.battleMenuState[userId]) {
      this.battleMenuState[userId] = {
        currentMenu: 'main', // 'main' ou 'skills'
      };
    }
  
    const playerMention = player.userId ? ` (<@${player.userId}>)` : '';
    const enemyMention = enemy.userId ? ` (<@${enemy.userId}>)` : '';
    const attackerMention = attacker.userId ? `<@${attacker.userId}>` : attacker.name;
  
    let battleStatus = `**${player.name}** Lv${player.level}${playerMention}\nHP: ${player.hp} / ${player.maxHp} | SP: ${player.sp} / ${player.maxSp}\n\n` +
                       `**${enemy.name}** Lv${enemy.level}${enemyMention}\nHP: ${enemy.hp} / ${enemy.maxHp} | SP: ${enemy.sp} / ${enemy.maxSp}`;
  
    if (isPlayerTurn !== null) {
      battleStatus += `\n\n${attackerMention}, it's your turn!`;
      
      // Exibir menu apropriado baseado no estado atual
      if (this.battleMenuState[userId].currentMenu === 'main') {
        // Menu principal
        battleStatus += `\nChoose an action:\n`;
        battleStatus += `1. 🗡️ Attack - Basic physical attack\n`;
        battleStatus += `2. 📜 Skills - Use demon abilities\n`;
        battleStatus += `3. 🛡️ Guard - Defensive stance\n`;
        battleStatus += `\nType the number of your choice.`;
      } else if (this.battleMenuState[userId].currentMenu === 'skills') {
        // Submenu de habilidades
        battleStatus += `\nChoose a skill:\n${attacker.abilities.map((name, i) => {
          const move = moves[name];
          return move
            ? `${i + 1}. ${move.emoji} ${name} — ${move.type} (${move.sp} SP) \n _${move.desc}_\n`
            : `${i + 1}. ${name} (Unknown Move)`;
        }).join('\n')}`;
        battleStatus += `\n0. ⬅️ Back to main menu`;
      }
    }
  
    await message.channel.send(battleStatus);
  },
  
  // Função para processar a entrada do usuário com base no estado do menu
  async processMenuInput(message, input, battleData, demons, isPlayerTurn) {
    const attacker = isPlayerTurn ? battleData.player : battleData.enemy;
    const defender = isPlayerTurn ? battleData.enemy : battleData.player;
    const userId = attacker.userId;
    
    // Garantir que battleMenuState para este usuário existe
    if (!this.battleMenuState[userId]) {
      this.battleMenuState[userId] = { currentMenu: 'main' };
    }
    
    const menuState = this.battleMenuState[userId];
    const choice = parseInt(input);
    
    // Referências de texto para mensagens
    const attackerText = attacker.userId ? `<@${attacker.userId}> (${attacker.name})` : attacker.name;
    const defenderText = defender.userId ? `<@${defender.userId}> (${defender.name})` : defender.name;
    
    // Processar input com base no menu atual
    if (menuState.currentMenu === 'main') {
      switch (choice) {
        case 1: // Attack
          await this.executeBasicAttack(attacker, defender, message, demons, attackerText, defenderText);
          return true; // Ação completa
          
        case 2: // Skills - mudar para submenu
          menuState.currentMenu = 'skills';
          await this.displayBattleStatus(message, battleData.player, battleData.enemy, isPlayerTurn);
          return false; // Ação não completa, aguardar nova entrada
          
        case 3: // Guard
          await this.executeGuard(attacker, message);
          return true; // Ação completa
          
        default:
          await message.channel.send(`Invalid option. Please choose 1, 2, or 3.`);
          return false; // Ação não completa, aguardar nova entrada
      }
    } 
    else if (menuState.currentMenu === 'skills') {
      if (choice === 0) {
        // Voltar para o menu principal
        menuState.currentMenu = 'main';
        await this.displayBattleStatus(message, battleData.player, battleData.enemy, isPlayerTurn);
        return false; // Ação não completa, aguardar nova entrada
      }
      
      // Usar habilidade
      const abilityIndex = choice - 1;
      if (abilityIndex >= 0 && abilityIndex < attacker.abilities.length) {
        const abilityName = attacker.abilities[abilityIndex];
        await this.executeAbility(attacker, defender, { name: abilityName }, message, demons, attackerText, defenderText);
        menuState.currentMenu = 'main'; // Retornar ao menu principal após usar habilidade
        return true; // Ação completa
      } else {
        await message.channel.send(`Invalid skill choice. Please try again.`);
        return false; // Ação não completa, aguardar nova entrada
      }
    }
    
    return false; // Ação não completa por padrão
  },
  
  // Função para resetar o estado do menu para um usuário
  resetMenuState(userId) {
    if (this.battleMenuState[userId]) {
      this.battleMenuState[userId].currentMenu = 'main';
    }
  }
};