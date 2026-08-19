const path = require('path');
const fs = require('fs');

const DB_FILE_PATH = path.join(__dirname, '..', 'database', 'playerState.json');

class PlayerStateManager {
    constructor() {
        this.filePath = DB_FILE_PATH;
        this.ensureFileExists();
    }

    ensureFileExists() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, JSON.stringify({ bots: {} }, null, 4), 'utf8');
        }
    }

    readDatabase() {
        try {
            if (!fs.existsSync(this.filePath)) {
                this.ensureFileExists();
                return { bots: {} };
            }
            const content = fs.readFileSync(this.filePath, 'utf8');
            if (!content || !content.trim()) {
                return { bots: {} };
            }
            const data = JSON.parse(content);
            // Migration for old structure if it exists
            if (data.players && !data.bots) {
                return { bots: { "default": { players: data.players } } };
            }
            return data;
        } catch (error) {
            // Silently recover if transient file read collision
            return { bots: {} };
        }
    }

    writeDatabase(data) {
        try {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const tmpFile = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
            fs.writeFileSync(tmpFile, JSON.stringify(data, null, 4), 'utf8');
            fs.renameSync(tmpFile, this.filePath);
        } catch (error) {
            console.error('❌ Failed to write database:', error.message);
        }
    }

    sanitizeState(state = {}) {
        try {
            return JSON.parse(JSON.stringify(state));
        } catch (error) {
            return {};
        }
    }

    async saveState(botId, guildId, state) {
        if (!botId || !guildId || !state) return;

        const payload = this.sanitizeState({
            ...state,
            updatedAt: Date.now()
        });

        try {
            const db = this.readDatabase();
            if (!db.bots) db.bots = {};
            if (!db.bots[botId]) db.bots[botId] = { players: {} };
            if (!db.bots[botId].players) db.bots[botId].players = {};

            db.bots[botId].players[guildId] = payload;
            this.writeDatabase(db);
        } catch (error) {
            console.error(`❌ Failed to save player state for bot ${botId} guild ${guildId}:`, error);
        }
    }

    getState(botId, guildId) {
        if (!botId || !guildId) return null;

        try {
            const db = this.readDatabase();
            if (db.bots?.[botId]?.players?.[guildId]) {
                return db.bots[botId].players[guildId];
            }
            // Fallback for old structure or default
            if (botId === "default" && db.players?.[guildId]) {
                return db.players[guildId];
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    getAllStates(botId) {
        if (!botId) return {};

        try {
            const db = this.readDatabase();
            return db.bots?.[botId]?.players || {};
        } catch (error) {
            return {};
        }
    }

    async removeState(botId, guildId) {
        if (!botId || !guildId) return;

        try {
            const db = this.readDatabase();
            if (db.bots?.[botId]?.players?.[guildId]) {
                const currentData = db.bots[botId].players[guildId];

                // Keep persistent settings but clear session-specific data
                db.bots[botId].players[guildId] = {
                    volume: currentData.volume,
                    loop: currentData.loop,
                    shuffle: currentData.shuffle,
                    autoplay: currentData.autoplay,
                    updatedAt: Date.now()
                };

                this.writeDatabase(db);
            }
        } catch (error) {
            console.error(`❌ Failed to clear player state for bot ${botId} guild ${guildId}:`, error);
        }
    }

    async clearAllStates(botId) {
        if (!botId) return;
        try {
            const db = this.readDatabase();
            if (db.bots?.[botId]) {
                db.bots[botId].players = {};
                this.writeDatabase(db);
            }
        } catch (error) {
            // Ignore if fails
        }
    }

    getProtectedCacheFiles() {
        const db = this.readDatabase();
        const protectedFiles = new Set();

        const processPlayer = (state) => {
            if (!state) return;
            if (Array.isArray(state.downloadedFiles)) {
                for (const filepath of state.downloadedFiles) {
                    if (filepath) {
                        protectedFiles.add(path.resolve(filepath));
                    }
                }
            }
            if (state.currentDownloadedFile) {
                protectedFiles.add(path.resolve(state.currentDownloadedFile));
            }
        };

        // Check global players for backward compatibility
        if (db.players) {
            Object.values(db.players).forEach(processPlayer);
        }

        // Check bot-specific players
        if (db.bots) {
            Object.values(db.bots).forEach(bot => {
                if (bot.players) {
                    Object.values(bot.players).forEach(processPlayer);
                }
            });
        }

        return protectedFiles;
    }
}

module.exports = new PlayerStateManager();

