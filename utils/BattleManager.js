const dataManager = require('./DataManager');
const statusHandler = require('./statusHandler');
const damageCalculator = require('./damageCalculator');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class BattleManager {
    constructor(message, battleData, demons) {
        this.message = message;
        this.battleData = battleData;
        this.demons = demons;
        this.menuState = new Map();
        this.moves = null;
        this.statusEffects = null;
        this.itemsPerPage = 5; // Number of demons/moves per page
    }

    async initialize() {
        this.moves = await dataManager.getMoves();
        this.statusEffects = await dataManager.getStatusEffects();
    }

    async displayBattleStatus(isPlayerTurn = true, existingMessage = null) {
        if (!this.moves) await this.initialize();
        const attacker = isPlayerTurn ? this.battleData.player : this.battleData.enemy;
        const player = this.battleData.player;
        const enemy = this.battleData.enemy;
    
        const playerMention = player.userId ? ` (<@${player.userId}>)` : '';
        const enemyMention = enemy.userId ? ` (<@${enemy.userId}>)` : '';
        const attackerMention = attacker.userId ? `<@${attacker.userId}>` : attacker.name;
    
        let battleStatus = this._formatEntityStatus(player, playerMention);
        battleStatus += `\n\n${this._formatEntityStatus(enemy, enemyMention)}`;
    
        if (isPlayerTurn !== null) {
            battleStatus += `\n\n${attackerMention}, it's your turn!`;
            
            const menuState = this.menuState.get(attacker.userId) || { currentMenu: 'main', page: 0 };
            const row = this._createMenuButtons(attacker, menuState);
            
            // Improved check to ensure existingMessage is valid
            if (existingMessage && typeof existingMessage.edit === 'function') {
                try {
                    return await existingMessage.edit({
                        content: battleStatus,
                        components: Array.isArray(row) ? row : [row]
                    });
                } catch (error) {
                    console.error("Failed to edit message:", error);
                    // Fall through to sending a new message
                }
            }
            
            // Only send a new message if we couldn't edit the existing one
            return await this.message.channel.send({
                content: battleStatus,
                components: Array.isArray(row) ? row : [row]
            });
        } else {
            // Similar approach for the non-player turn case
            if (existingMessage && typeof existingMessage.edit === 'function') {
                try {
                    return await existingMessage.edit({ content: battleStatus });
                } catch (error) {
                    console.error("Failed to edit message:", error);
                }
            }
            
            return await this.message.channel.send({ content: battleStatus });
        }
    }

    _formatEntityStatus(entity, mention) {
        let status = `**${entity.name}** Lv${entity.level}${mention}\nHP: ${entity.hp} / ${entity.maxHp} | SP: ${entity.sp} / ${entity.maxSp}`;

        if (entity.isGuarding) {
            status += " 🛡️";
        }

        if (entity.statusEffects?.length > 0) {
            status += " | Status: " + entity.statusEffects.map(s =>
                `${s.emoji} ${s.name}${s.stacks > 1 ? ` x${s.stacks}` : ''} (${s.turnsRemaining})`
            ).join(", ");
        }

        return status;
    }

    _createMenuButtons(entity, menuState) {
        const row = new ActionRowBuilder();

        if (menuState.currentMenu === 'main') {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('attack')
                    .setLabel('Attack')
                    .setEmoji('🗡️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('skills')
                    .setLabel('Skills')
                    .setEmoji('📜')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('guard')
                    .setLabel('Guard')
                    .setEmoji('🛡️')
                    .setStyle(ButtonStyle.Primary)
            );
        } else if (menuState.currentMenu === 'skills') {
            const startIdx = menuState.page * this.itemsPerPage;
            const endIdx = Math.min(startIdx + this.itemsPerPage, entity.abilities.length);
            const abilities = entity.abilities.slice(startIdx, endIdx);

            // Add skill buttons
            abilities.forEach((name, i) => {
                const move = this.moves[name];
                if (move) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`skill_${startIdx + i}`)
                            .setLabel(name)
                            .setEmoji(move.emoji)
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(entity.sp < move.sp)
                    );
                }
            });

            // Add navigation buttons if needed
            if (entity.abilities.length > this.itemsPerPage) {
                const navigationRow = new ActionRowBuilder();
                navigationRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev_page')
                        .setLabel('⬅')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(menuState.page === 0),
                    new ButtonBuilder()
                        .setCustomId('next_page')
                        .setLabel('➡')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled((menuState.page + 1) * this.itemsPerPage >= entity.abilities.length)
                );
                return [row, navigationRow];
            }

            // Add back button
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('back')
                    .setLabel('Back')
                    .setEmoji('⬅️')
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        return row;
    }

    async processInput(interaction, isPlayerTurn) {
        const attacker = isPlayerTurn ? this.battleData.player : this.battleData.enemy;
        const defender = isPlayerTurn ? this.battleData.enemy : this.battleData.player;
        
        if (!this.menuState.has(attacker.userId)) {
            this.menuState.set(attacker.userId, { currentMenu: 'main', page: 0 });
        }

        const menuState = this.menuState.get(attacker.userId);
        const customId = interaction.customId;

        // Acknowledge the interaction first
        await interaction.deferUpdate();

        if (menuState.currentMenu === 'main') {
            switch (customId) {
                case 'attack':
                    return await this.executeBasicAttack(attacker, defender);
                case 'skills':
                    menuState.currentMenu = 'skills';
                    menuState.page = 0;
                    await this.displayBattleStatus(isPlayerTurn, interaction.message);
                    return false;
                case 'guard':
                    return await this.executeGuard(attacker);
                default:
                    return false;
            }
        } else if (menuState.currentMenu === 'skills') {
            if (customId === 'back') {
                menuState.currentMenu = 'main';
                await this.displayBattleStatus(isPlayerTurn, interaction.message);
                return false;
            } else if (customId === 'prev_page') {
                menuState.page = Math.max(0, menuState.page - 1);
                await this.displayBattleStatus(isPlayerTurn, interaction.message);
                return false;
            } else if (customId === 'next_page') {
                const maxPage = Math.ceil(attacker.abilities.length / this.itemsPerPage) - 1;
                menuState.page = Math.min(maxPage, menuState.page + 1);
                await this.displayBattleStatus(isPlayerTurn, interaction.message);
                return false;
            } else if (customId.startsWith('skill_')) {
                const index = parseInt(customId.split('_')[1]);
                if (index >= 0 && index < attacker.abilities.length) {
                    const abilityName = attacker.abilities[index];
                    const result = await this.executeAbility(attacker, defender, { name: abilityName });
                    menuState.currentMenu = 'main';
                    menuState.page = 0;

                    if (result) {
                        await statusHandler.processStatusEffectsEnd(attacker, this.message);
                    }

                    return result;
                }
            }
        }

        return false;
    }

    async _handleMainMenu(choice, attacker, defender) {
        switch (choice) {
            case 1:
                return await this.executeBasicAttack(attacker, defender);
            case 2:
                this.menuState.get(attacker.userId).currentMenu = 'skills';
                return false;
            case 3:
                return await this.executeGuard(attacker);
            default:
                return false;
        }
    }

    async _handleSkillsMenu(choice, attacker, defender) {
        if (choice === 0) {
            this.menuState.get(attacker.userId).currentMenu = 'main';
            await this.displayBattleStatus();
            return false;
        }

        const abilityIndex = choice - 1;
        if (abilityIndex >= 0 && abilityIndex < attacker.abilities.length) {
            const abilityName = attacker.abilities[abilityIndex];
            const result = await this.executeAbility(attacker, defender, { name: abilityName });
            this.menuState.get(attacker.userId).currentMenu = 'main';

            if (result) {
                await statusHandler.processStatusEffectsEnd(attacker, this.message);
            }

            return result;
        }
        return false;
    }

    async executeBasicAttack(attacker, defender) {
        if (!await statusHandler.processStatusEffectsStart(attacker, this.message)) {
            return true;
        }

        const attackerText = this._getEntityText(attacker);
        const defenderText = this._getEntityText(defender);

        const redirected = await this._handleTargetRedirection(attacker, defender, { type: "Physical" });
        if (redirected) return true;

        const basicAttackMove = {
            name: "Attack",
            type: "Physical",
            power: 100,
            emoji: "🗡️",
            sp: 0,
            usesStrength: true,
            usesMagic: false,
            accuracy: 95
        };

        const damage = await this._executeAttack(attacker, defender, basicAttackMove);
        if (damage === false) return true;

        await this.message.channel.send(`${attackerText} attacks and deals ${damage} damage!`);
        await this._checkStatusBreak(defender, "Physical", defenderText);
        return true;
    }

    async executeGuard(attacker) {
        if (!await statusHandler.processStatusEffectsStart(attacker, this.message)) {
            return true;
        }

        damageCalculator.guardAction(attacker);
        const attackerText = this._getEntityText(attacker);
        await this.message.channel.send(`${attackerText} assumes a defensive stance! 🛡️`);
        await statusHandler.processStatusEffectsEnd(attacker, this.message);
        return true;
    }

    async executeAbility(attacker, defender, ability) {
        if (!this.moves) await this.initialize();
        const move = this.moves[ability.name];
        if (!move) return false;

        if (!statusHandler.processStatusEffectsStart(attacker, this.message)) {
            return true;
        }

        const attackerText = this._getEntityText(attacker);
        const defenderText = this._getEntityText(defender);

        if (attacker.sp < move.sp) {
            await this.message.channel.send(`${attackerText} doesn't have enough SP to use ${ability.name}!`);
            return false;
        }

        attacker.sp -= move.sp;

        const redirected = await this._handleTargetRedirection(attacker, defender, move);
        if (redirected) return true;

        if (move.type === 'Healing') {
            return await this._executeHealingMove(attacker, move, attackerText);
        } else if (move.power === 0 || move.isPureStatus) {
            return await this._executeStatusMove(attacker, defender, move, attackerText);
        } else {
            return await this._executeDamageMove(attacker, defender, move, attackerText, defenderText);
        }
    }

    async _executeAttack(attacker, defender, move) {
        const attackerMods = await statusHandler.getStatusMultipliers(attacker);
        const defenderMods = await statusHandler.getStatusMultipliers(defender);

        const hits = move.hits || 1;
        let totalDamage = 0;
        let anyHit = false;
        for (let hit = 0; hit < hits; hit++) {
            const accuracy = move.accuracy * 
                (attackerMods.accuracyMultiplier ?? 1.0) / 
                (defenderMods.evasionMultiplier ?? 1.0);

            if (Math.random() * 100 > accuracy) {
                await this.message.channel.send(`${this._getEntityText(attacker)}'s ${move.name} (hit ${hit+1})... MISSES!`);
                continue;
            }

            // --- TYPE AFFINITIES ---
            const resist = defender.resistances || {};
            const type = move.type;
            let efficacy = 1;
            let affinityMsg = null;
            let isNull = resist.null?.includes(type);
            let isDrain = resist.drain?.includes(type);
            let isRepel = resist.repel?.includes(type);
            let isWeak = resist.weak?.includes(type);
            let isResist = resist.resist?.includes(type);

            // Null: no effect
            if (isNull) {
                await this.message.channel.send(`${this._getEntityText(attacker)} uses ${move.emoji || ''} ${move.name} (hit ${hit+1})... but it has no effect! ❌`);
                continue;
            }
            // Drain: heals the target
            if (isDrain) {
                const context = {
                    attackStageMultiplier: attackerMods.strengthMultiplier || 1,
                    defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
                    isGuarding: defender.isGuarding || false
                };
                let damage = await damageCalculator.calculateDamage(attacker, defender, move, context);
                defender.hp = Math.min(defender.hp + Math.max(1, Math.floor(damage)), defender.maxHp);
                await this.message.channel.send(`${this._getEntityText(attacker)} uses ${move.emoji || ''} ${move.name} (hit ${hit+1})... but it's drained! ${this._getEntityText(defender)} recovers ${Math.max(1, Math.floor(damage))} HP! 💉`);
                continue;
            }
            // Repel: reflects the damage
            if (isRepel) {
                const context = {
                    attackStageMultiplier: attackerMods.strengthMultiplier || 1,
                    defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
                    isGuarding: false // Repel ignores defense
                };
                let damage = await damageCalculator.calculateDamage(attacker, defender, move, context);
                attacker.hp -= damage;
                await this.message.channel.send(`${this._getEntityText(attacker)} uses ${move.emoji || ''} ${move.name} (hit ${hit+1})... but it's reflected! ${this._getEntityText(attacker)} takes ${damage} damage! 🔁`);
                continue;
            }
            // Weak: increased damage
            if (isWeak) {
                efficacy = 1.25;
                affinityMsg = 'WEAK! ‼️';
            } else if (isResist) {
                efficacy = 0.5;
                affinityMsg = 'RESIST! 🛡';
            }

            const context = {
                attackStageMultiplier: attackerMods.strengthMultiplier || 1,
                defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
                isGuarding: defender.isGuarding || false
            };

            let damage = await damageCalculator.calculateDamage(attacker, defender, move, context);
            damage = Math.floor(damage * efficacy);

            if (Math.random() < 0.1) {
                damage = Math.floor(damage * 1.5);
                await this.message.channel.send(`Critical hit! 💥 (hit ${hit+1})`);
            }

            defender.hp -= damage;
            totalDamage += damage;
            anyHit = true;
            if (affinityMsg) {
                await this.message.channel.send(`${this._getEntityText(attacker)} uses ${move.emoji || ''} ${move.name} (hit ${hit+1})... ${affinityMsg}`);
            }
        }
        if (!anyHit) return false;
        return totalDamage;
    }

    async _executeHealingMove(attacker, move, attackerText) {
        if (!this.moves) await this.initialize();
        const maxHp = this.demons[attacker.name]?.hp || attacker.maxHp;
        const baseHeal = move.power;
        const percentHeal = Math.floor(maxHp * (move.healingPercent || 0));
        const totalHeal = baseHeal + percentHeal;

        attacker.hp = Math.min(attacker.hp + totalHeal, maxHp);
        await this.message.channel.send(`${attackerText} uses ${move.emoji} ${move.name} and heals ${totalHeal} HP!`);

        if (move.curesAilment) {
            const removed = statusHandler.removeStatusEffect(attacker, move.curesAilment);
            if (removed) {
                await this.message.channel.send(`${attackerText} is no longer affected by ${move.curesAilment}!`);
            }
        }

        return true;
    }

    async _executeStatusMove(attacker, defender, move, attackerText) {
        await this.message.channel.send(`${attackerText} uses ${move.emoji} ${move.name}...`);

        const attackerMods = statusHandler.getStatusMultipliers(attacker);
        const defenderMods = statusHandler.getStatusMultipliers(defender);

        const accuracy = (move.accuracy ?? 100) *
            (attackerMods.accuracyMultiplier ?? 1.0) /
            (defenderMods.evasionMultiplier ?? 1.0);

        if (Math.random() * 100 > accuracy) {
            await this.message.channel.send(`... but it MISSES!`);
            return true;
        }

        await statusHandler.applyStatusFromSkill(attacker, defender, move, this.message);
        return true;
    }

    async _executeDamageMove(attacker, defender, move, attackerText, defenderText) {
        const damage = await this._executeAttack(attacker, defender, move);
        if (damage === false) return true;

        // Default message if not weak/resist/null/drain/repel
        const resist = defender.resistances || {};
        const type = move.type;
        if (!resist.weak?.includes(type) && !resist.resist?.includes(type) && !resist.null?.includes(type) && !resist.drain?.includes(type) && !resist.repel?.includes(type)) {
            await this.message.channel.send(`${attackerText} uses ${move.emoji} ${move.name}...`);
        }
        await this.message.channel.send(`${defenderText} takes ${damage} damage!`);

        await this._checkStatusBreak(defender, move.type, defenderText);

        if (move.instakill && defender.hp > 0) {
            await statusHandler.checkInstakill(attacker, defender, move, this.message);
        }

        if (defender.hp > 0) {
            await statusHandler.applyStatusFromSkill(attacker, defender, move, this.message);
        }

        return true;
    }

    _getEntityText(entity) {
        return entity.userId ? `<@${entity.userId}> (${entity.name})` : entity.name;
    }

    async _handleTargetRedirection(attacker, defender, move) {
        if (!await damageCalculator.shouldTargetAlly(attacker) || move.type === 'Healing') {
            return false;
        }

        const attackerText = this._getEntityText(attacker);
        const defenderText = this._getEntityText(defender);

        if (await statusHandler.hasStatusEffect(attacker, 'charm')) {
            await this.message.channel.send(`${attackerText} is charmed 💘 and attacks an ally instead!`);
            return true;
        } else if (attacker.statusEffects?.some(effect => effect.name.toLowerCase() === 'brainwash')) {
            await this.message.channel.send(`${attackerText} is brainwashed 🧠 and heals the enemy instead!`);
            const healAmount = Math.max(1, Math.floor(move.power ? move.power / 2 : defender.maxHp * 0.15));
            defender.hp = Math.min(defender.hp + healAmount, defender.maxHp);
            await this.message.channel.send(`${defenderText} recovers ${healAmount} HP!`);
            return true;
        }
        return false;
    }

    async _checkStatusBreak(defender, damageType, defenderText) {
        const brokenEffects = damageCalculator.checkStatusBreakOnDamage(defender, damageType);
        if (brokenEffects?.length > 0) {
            for (const effect of brokenEffects) {
                await this.message.channel.send(`${defenderText}'s ${effect} status was broken by the attack!`);
            }
        }
    }

    resetMenuState(userId) {
        if (this.menuState.has(userId)) {
            this.menuState.get(userId).currentMenu = 'main';
        }
    }

    async executeEnemyTurn() {
        if (!this.moves) await this.initialize();
        const enemy = this.battleData.enemy;
        const player = this.battleData.player;

        if (!await statusHandler.processStatusEffectsStart(enemy, this.message)) {
            await statusHandler.processStatusEffectsEnd(enemy, this.message);
            return;
        }

        const healingMove = enemy.abilities.find(name => {
            const move = this.moves[name];
            return move && move.type === 'Healing' && enemy.sp >= move.sp;
        });

        if (enemy.hp < enemy.maxHp * 0.3 && healingMove) {
            await this.executeAbility(enemy, player, { name: healingMove });
        }
        else if (Math.random() < 0.15) {
            await this.executeGuard(enemy);
        }
        else {
            const statusMoves = enemy.abilities.filter(name => {
                const move = this.moves[name];
                return move &&
                    enemy.sp >= move.sp &&
                    (move.ailment || move.debuff);
            });

            const hasNoAilment = !player.statusEffects ||
                !player.statusEffects.some(s => s.type === 'ailment');

            if (hasNoAilment && statusMoves.length > 0 && Math.random() < 0.4) {
                const statusMove = statusMoves[Math.floor(Math.random() * statusMoves.length)];
                await this.executeAbility(enemy, player, { name: statusMove });
            } else {
                const usableAbilities = enemy.abilities.filter(name => {
                    const move = this.moves[name];
                    return move && enemy.sp >= move.sp && move.type !== 'Healing';
                });

                if (usableAbilities.length > 0) {
                    const abilityName = usableAbilities[Math.floor(Math.random() * usableAbilities.length)];
                    await this.executeAbility(enemy, player, { name: abilityName });
                } else {
                    await this.executeBasicAttack(enemy, player);
                }
            }
        }

        await statusHandler.processStatusEffectsEnd(enemy, this.message);
    }
}

module.exports = BattleManager;
