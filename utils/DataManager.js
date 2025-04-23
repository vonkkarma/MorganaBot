const fs = require('fs').promises;
const path = require('path');

class DataManager {
    constructor() {
        this.cache = {
            demons: null,
            moves: null,
            statusEffects: null,
            userData: null
        };
        this.dataPath = {
            demons: 'demons.json',
            moves: 'moves.json',
            statusEffects: 'statusEffects.json',
            userData: 'userData.json'
        };
    }

    async loadData(type) {
        try {
            if (!this.cache[type]) {
                const filePath = path.join(process.cwd(), this.dataPath[type]);
                const data = await fs.readFile(filePath, 'utf8');
                this.cache[type] = JSON.parse(data);
            }
            return this.cache[type];
        } catch (error) {
            console.error(`Error loading ${type} data:`, error);
            return null;
        }
    }

    async saveData(type, data) {
        try {
            const filePath = path.join(process.cwd(), this.dataPath[type]);
            await fs.writeFile(filePath, JSON.stringify(data, null, 2));
            this.cache[type] = data;
            return true;
        } catch (error) {
            console.error(`Error saving ${type} data:`, error);
            return false;
        }
    }

    async getDemons() {
        return await this.loadData('demons');
    }

    async getMoves() {
        return await this.loadData('moves');
    }

    async getStatusEffects() {
        return await this.loadData('statusEffects');
    }

    async getUserData() {
        return await this.loadData('userData');
    }

    async saveUserData(userData) {
        return await this.saveData('userData', userData);
    }

    async getDemon(demonName) {
        const demons = await this.getDemons();
        return demons ? demons[demonName] : null;
    }

    async getMove(moveName) {
        const moves = await this.getMoves();
        return moves ? moves[moveName] : null;
    }

    async getStatusEffect(effectName) {
        const effects = await this.getStatusEffects();
        return effects ? effects[effectName] : null;
    }

    async getUserDemons(userId) {
        const userData = await this.getUserData();
        return userData && userData[userId] ? userData[userId].caughtDemons : [];
    }

    async addUserDemon(userId, demonName) {
        const userData = await this.getUserData() || {};
        
        if (!userData[userId]) {
            userData[userId] = { caughtDemons: [] };
        }
        
        if (!userData[userId].caughtDemons.includes(demonName)) {
            userData[userId].caughtDemons.push(demonName);
            await this.saveUserData(userData);
            return true;
        }
        return false;
    }

    async removeUserDemon(userId, demonName) {
        const userData = await this.getUserData();
        if (!userData || !userData[userId]) return false;

        const index = userData[userId].caughtDemons.indexOf(demonName);
        if (index === -1) return false;

        userData[userId].caughtDemons.splice(index, 1);
        await this.saveUserData(userData);
        return true;
    }

    clearCache() {
        this.cache = {
            demons: null,
            moves: null,
            statusEffects: null,
            userData: null
        };
    }
}

// Create a singleton instance
const dataManager = new DataManager();
module.exports = dataManager;