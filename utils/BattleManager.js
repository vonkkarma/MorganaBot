const dataManager = require('./DataManager');
const statusHandler = require('./statusHandler');
const damageCalculator = require('./damageCalculator');

class BattleManager {
    constructor(message, battleData, demons) {
        this.message = message;
        this.battleData = battleData;
        this.demons = demons;
        this.menuState = new Map();
        this.moves = null;
        this.statusEffects = null;
    }

    async initialize() {
        this.moves = await dataManager.getMoves();
        this.statusEffects = await dataManager.getStatusEffects();
    }

    async displayBattleStatus(isPlayerTurn = true) {
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
            battleStatus += this._getMenuText(attacker);
        }

        await this.message.channel.send(battleStatus);
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

    _getMenuText(entity) {
        const menuState = this.menuState.get(entity.userId) || { currentMenu: 'main' };

        if (menuState.currentMenu === 'main') {
            return `\nChoose an action:\n1 - 🗡️ Attack\n2 - 📜 Skills\n3 - 🛡️ Guard\n\nType the number of your choice.`;
        } else if (menuState.currentMenu === 'skills') {
            return `\nChoose a skill:\n${entity.abilities.map((name, i) => {
                const move = this.moves[name];
                return move
                    ? `${i + 1}. ${move.emoji} ${name} — ${move.type} (${move.sp} SP) \n _${move.desc}_\n`
                    : `${i + 1}. ${name} (Unknown Move)`;
            }).join('\n')}\n0 - ⬅️ Back to main menu`;
        }
    }

    async processInput(input, isPlayerTurn) {
        const attacker = isPlayerTurn ? this.battleData.player : this.battleData.enemy;
        const defender = isPlayerTurn ? this.battleData.enemy : this.battleData.player;
        
        if (!this.menuState.has(attacker.userId)) {
            this.menuState.set(attacker.userId, { currentMenu: 'main' });
        }

        const menuState = this.menuState.get(attacker.userId);
        const choice = parseInt(input);

        if (menuState.currentMenu === 'main') {
            return await this._handleMainMenu(choice, attacker, defender);
        } else if (menuState.currentMenu === 'skills') {
            return await this._handleSkillsMenu(choice, attacker, defender);
        }

        return false;
    }

    async _handleMainMenu(choice, attacker, defender) {
        switch (choice) {
            case 1:
                return await this.executeBasicAttack(attacker, defender);
            case 2:
                this.menuState.get(attacker.userId).currentMenu = 'skills';
                await this.displayBattleStatus();
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

        const accuracy = move.accuracy * 
            (attackerMods.accuracyMultiplier ?? 1.0) / 
            (defenderMods.evasionMultiplier ?? 1.0);

        if (Math.random() * 100 > accuracy) {
            await this.message.channel.send(`${this._getEntityText(attacker)} attacks... but it MISSES!`);
            return false;
        }

        const context = {
            attackStageMultiplier: attackerMods.strengthMultiplier || 1,
            defenseStageMultiplier: defenderMods.defenseMultiplier || 1,
            isGuarding: defender.isGuarding || false
        };

        let damage = await damageCalculator.calculateDamage(attacker, defender, move, context);

        if (Math.random() < 0.1) {
            damage = Math.floor(damage * 1.5);
            await this.message.channel.send(`Critical hit! 💥`);
        }

        defender.hp -= damage;
        return damage;
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

        await this.message.channel.send(`${attackerText} uses ${move.emoji} ${move.name}...`);
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
