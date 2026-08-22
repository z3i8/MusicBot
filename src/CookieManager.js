const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

// Directory for per-invocation cookie copies
const COOKIE_WORK_DIR = path.join(__dirname, '..', '.cookie_work');

// Ensure work directory exists
if (!fs.existsSync(COOKIE_WORK_DIR)) {
    fs.mkdirSync(COOKIE_WORK_DIR, { recursive: true });
}

class CookieManager {
    /**
     * Returns the master cookies.txt path (the one the user maintains).
     */
    static getMasterCookiePath() {
        if (config.ytdl.cookiesFromBrowser) return null; // browser mode, no file

        const defaultCookies = path.resolve(__dirname, '..', 'cookies.txt');
        const target = config.ytdl.cookiesFile || (fs.existsSync(defaultCookies) ? defaultCookies : null);
        if (!target) return null;

        const resolved = path.isAbsolute(target)
            ? target
            : path.resolve(__dirname, '..', target);

        return fs.existsSync(resolved) ? resolved : null;
    }

    /**
     * Creates an isolated copy of cookies.txt for a single yt-dlp invocation.
     * This prevents concurrent yt-dlp processes from corrupting the same file.
     *
     * Returns the path to the temporary copy, or null if no cookies are available.
     * The caller must call releaseCopy(path) when done.
     */
    static createIsolatedCopy() {
        const master = this.getMasterCookiePath();
        if (!master) return null;

        try {
            const content = fs.readFileSync(master, 'utf8');
            if (!content || content.trim().length === 0) return null;

            const id = crypto.randomBytes(6).toString('hex');
            const copyPath = path.join(COOKIE_WORK_DIR, `cookies_${id}.txt`);
            fs.writeFileSync(copyPath, content, 'utf8');
            return copyPath;
        } catch (err) {
            console.error('⚠️ CookieManager: failed to create isolated copy:', err.message);
            return null;
        }
    }

    /**
     * After a yt-dlp invocation finishes, sync any rotated cookies back
     * to the master file then delete the temporary copy.
     *
     * yt-dlp updates SIDCC / __Secure-*PSIDCC / __Secure-*PSIDTS in-place,
     * so if the copy was modified we merge the new values back.
     */
    static releaseCopy(copyPath) {
        if (!copyPath) return;

        try {
            if (!fs.existsSync(copyPath)) return;

            const master = this.getMasterCookiePath();
            if (master) {
                const copyContent = fs.readFileSync(copyPath, 'utf8');
                const masterContent = fs.readFileSync(master, 'utf8');

                // Only sync back if the copy was actually modified by yt-dlp
                if (copyContent !== masterContent && copyContent.trim().length > 0) {
                    // Parse both files into cookie maps
                    const copyCookies = this._parseCookieFile(copyContent);
                    const masterCookies = this._parseCookieFile(masterContent);

                    // Rotating cookie names that yt-dlp updates
                    const rotatingNames = new Set([
                        'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
                        '__Secure-1PSIDTS', '__Secure-3PSIDTS',
                        'SID', '__Secure-1PSID', '__Secure-3PSID',
                        'HSID', 'SSID', 'APISID', 'SAPISID',
                        '__Secure-1PAPISID', '__Secure-3PAPISID'
                    ]);

                    let updated = false;
                    for (const name of rotatingNames) {
                        const copyVal = copyCookies.get(name);
                        const masterVal = masterCookies.get(name);
                        if (copyVal && copyVal !== masterVal) {
                            masterCookies.set(name, copyVal);
                            updated = true;
                        }
                    }

                    if (updated) {
                        // Rebuild the master file preserving comments and structure
                        const newContent = this._rebuildCookieFile(masterContent, masterCookies);
                        fs.writeFileSync(master, newContent, 'utf8');
                        console.log('🍪 CookieManager: synced rotated cookies back to master');
                    }
                }
            }

            // Clean up the temporary copy
            fs.unlinkSync(copyPath);
        } catch (err) {
            // Best-effort cleanup
            try { fs.unlinkSync(copyPath); } catch (_) {}
            console.error('⚠️ CookieManager: releaseCopy error:', err.message);
        }
    }

    /**
     * Parse a Netscape cookie file into a Map of name -> value.
     */
    static _parseCookieFile(content) {
        const cookies = new Map();
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const parts = trimmed.split('\t');
            if (parts.length >= 7) {
                cookies.set(parts[5], parts[6]);
            }
        }
        return cookies;
    }

    /**
     * Rebuild a cookie file from original content with updated values.
     */
    static _rebuildCookieFile(originalContent, updatedCookies) {
        const lines = originalContent.split('\n');
        const result = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                result.push(line);
                continue;
            }
            const parts = trimmed.split('\t');
            if (parts.length >= 7) {
                const name = parts[5];
                const newVal = updatedCookies.get(name);
                if (newVal !== undefined) {
                    parts[6] = newVal;
                }
                result.push(parts.join('\t'));
            } else {
                result.push(line);
            }
        }
        return result.join('\n');
    }

    /**
     * Checks whether the master cookies.txt is likely still valid.
     * Looks at the SIDCC / __Secure-1PSIDCC expiration timestamps.
     * Returns { valid: boolean, reason: string }
     */
    static checkValidity() {
        const master = this.getMasterCookiePath();
        if (!master) return { valid: false, reason: 'No cookie file found' };

        try {
            const content = fs.readFileSync(master, 'utf8');
            const now = Math.floor(Date.now() / 1000);

            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const parts = trimmed.split('\t');
                if (parts.length >= 7) {
                    const expiry = parseInt(parts[4], 10);
                    const name = parts[5];
                    // Check session-critical cookies
                    if ((name === 'SIDCC' || name === '__Secure-1PSIDCC') && expiry > 0 && expiry < now) {
                        return { valid: false, reason: `Cookie ${name} expired at ${new Date(expiry * 1000).toISOString()}` };
                    }
                }
            }

            return { valid: true, reason: 'Cookies appear valid' };
        } catch (err) {
            return { valid: false, reason: err.message };
        }
    }

    /**
     * Clean up old temporary cookie copies that may have been orphaned
     * (e.g., from a process crash).
     */
    static cleanupOrphans() {
        try {
            if (!fs.existsSync(COOKIE_WORK_DIR)) return;

            const files = fs.readdirSync(COOKIE_WORK_DIR);
            const now = Date.now();
            let cleaned = 0;

            for (const file of files) {
                if (!file.startsWith('cookies_') || !file.endsWith('.txt')) continue;
                const filepath = path.join(COOKIE_WORK_DIR, file);
                try {
                    const stat = fs.statSync(filepath);
                    // Remove copies older than 5 minutes (they're definitely orphaned)
                    if (now - stat.mtimeMs > 5 * 60 * 1000) {
                        fs.unlinkSync(filepath);
                        cleaned++;
                    }
                } catch (_) {}
            }

            if (cleaned > 0) {
                console.log(`🍪 CookieManager: cleaned up ${cleaned} orphaned cookie copies`);
            }
        } catch (err) {
            console.error('⚠️ CookieManager: cleanupOrphans error:', err.message);
        }
    }
}

// Clean up orphans on startup
CookieManager.cleanupOrphans();

module.exports = CookieManager;
