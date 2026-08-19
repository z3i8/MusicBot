const axios = require('axios');
const Genius = require('genius-lyrics');
const config = require('../config');

class LyricsManager {
    constructor() {
        this.cache = new Map(); // Cache lyrics by track URL / key
        this.cacheTimers = new Map(); // Track cache expiration timers

        // Initialize Genius client with optional token from config
        const geniusToken = config.genius?.clientSecret || config.genius?.clientId || null;
        this.geniusClient = geniusToken ? new Genius.Client(geniusToken) : new Genius.Client();
        
        // HTTP client with proper User-Agent header for LRCLIB
        this.http = axios.create({
            timeout: 6000,
            headers: {
                'User-Agent': 'MusicBot/16.0.0 (https://github.com/umutxyp/MusicBot)'
            }
        });
    }

    getCacheKey(track) {
        if (!track) return 'unknown';
        const title = (track.title || '').toLowerCase().trim();
        const artist = (track.artist || track.uploader || '').toLowerCase().trim();
        return `${title}-${artist}` || title || 'unknown';
    }

    storeInCache(cacheKey, data, ttlMs = null) {
        if (!cacheKey) return;

        this.cache.set(cacheKey, data);

        if (this.cacheTimers.has(cacheKey)) {
            clearTimeout(this.cacheTimers.get(cacheKey));
        }

        const effectiveTtl = typeof ttlMs === 'number' ? ttlMs : (data ? 3600000 : 300000);

        const timer = setTimeout(() => {
            this.cache.delete(cacheKey);
            this.cacheTimers.delete(cacheKey);
        }, effectiveTtl);

        if (typeof timer.unref === 'function') {
            timer.unref();
        }

        this.cacheTimers.set(cacheKey, timer);
    }

    cleanTrackTitle(title = '') {
        return title
            .replace(/\(.*?\)/g, '') // Remove parentheses content like (Official Video)
            .replace(/\[.*?\]/g, '') // Remove brackets content like [Lyrics]
            .replace(/【.*?】/g, '') // Remove Japanese-style brackets
            .replace(/v[iï]de[oó]/gi, '')
            .replace(/official|audio|video|lyrics?|full\s?hd|hd|4k|8k|mv|m\/v|premiere|remastered/gi, '')
            .replace(/rotana|mazzika|melody|free\s?tv/gi, '') // Common Arabic record labels
            .replace(/prod(\.)?\s?by.*?$/gi, '') // Remove producer credits
            .replace(/ft\.|feat\..*?$/gi, '') // Remove features for better search match
            .replace(/\|/g, ' ') // Replace pipe with space
            .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
            .trim();
    }

    /**
     * Splits artist and title from common video title patterns (e.g. "Artist - Title")
     */
    extractArtistAndTitle(rawTitle = '', fallbackArtist = '') {
        const clean = this.cleanTrackTitle(rawTitle);
        const cleanFallbackArtist = (fallbackArtist || '')
            .replace(/\s-\sTopic$/i, '')
            .replace(/VEVO$/i, '')
            .replace(/Official$/i, '')
            .trim();

        // Check for separators: " - ", " – ", " — ", " : "
        const separatorMatch = clean.match(/^(.*?)\s*[-–—:]\s*(.*)$/);
        if (separatorMatch) {
            const possibleArtist = separatorMatch[1].trim();
            const possibleTitle = separatorMatch[2].trim();
            if (possibleArtist && possibleTitle) {
                return {
                    artist: possibleArtist,
                    title: possibleTitle,
                    fallbackArtist: cleanFallbackArtist
                };
            }
        }

        return {
            artist: cleanFallbackArtist,
            title: clean,
            fallbackArtist: cleanFallbackArtist
        };
    }

    /**
     * Normalize strings for comparison
     */
    normalizeString(str = '') {
        return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Checks if a search result matches the track using fuzzy matching
     */
    isMatch(track, result) {
        if (!track || !result) return false;

        const rawTrackTitle = track.title || '';
        const rawTrackArtist = track.artist || track.uploader || '';
        const { artist: extractedArtist, title: extractedTitle } = this.extractArtistAndTitle(rawTrackTitle, rawTrackArtist);

        const normTrackTitle = this.normalizeString(rawTrackTitle);
        const normExtractedTitle = this.normalizeString(extractedTitle);
        const normExtractedArtist = this.normalizeString(extractedArtist);
        const normTrackArtist = this.normalizeString(rawTrackArtist.replace(/\s-\sTopic$/i, '').replace(/VEVO$/i, ''));

        const resultTitle = result.trackName || result.name || result.title || '';
        const resultArtist = result.artistName || result.artist?.name || result.artist || '';

        const normResultTitle = this.normalizeString(resultTitle);
        const normResultArtist = this.normalizeString(resultArtist);

        if (!normResultTitle) return false;

        // Direct exact match
        if (normResultTitle === normExtractedTitle || normResultTitle === normTrackTitle) {
            return true;
        }

        // Check if result title is contained in track title or vice versa
        const titleContained = normTrackTitle.includes(normResultTitle) || 
                               normExtractedTitle.includes(normResultTitle) ||
                               normResultTitle.includes(normExtractedTitle);

        if (titleContained) {
            if (!normResultArtist || !normExtractedArtist) return true;
            if (normTrackTitle.includes(normResultArtist) || 
                normTrackArtist.includes(normResultArtist) || 
                normExtractedArtist.includes(normResultArtist) ||
                normResultArtist.includes(normExtractedArtist)) {
                return true;
            }
            if (this.getSimilarity(normExtractedArtist, normResultArtist) > 0.6) {
                return true;
            }
        }

        // Fuzzy similarity checks
        const titleSim = Math.max(
            this.getSimilarity(normExtractedTitle, normResultTitle),
            this.getSimilarity(normTrackTitle, normResultTitle)
        );

        if (titleSim > 0.8) return true;

        if (titleSim > 0.5) {
            const artistSim = Math.max(
                this.getSimilarity(normExtractedArtist, normResultArtist),
                this.getSimilarity(normTrackArtist, normResultArtist)
            );
            if (artistSim > 0.6) return true;
        }

        return false;
    }

    /**
     * Simple Levenshtein-based similarity
     */
    getSimilarity(s1, s2) {
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1.0;

        if (s1.includes(s2) || s2.includes(s1)) {
            const shorterLen = Math.min(s1.length, s2.length);
            const longerLen = Math.max(s1.length, s2.length);
            if (longerLen > 0 && shorterLen / longerLen > 0.4) return 0.85;
        }

        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        const longerLength = longer.length;

        if (longerLength === 0) return 1.0;

        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longerLength - editDistance) / longerLength;
    }

    levenshteinDistance(s1, s2) {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        }
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    }

    /**
     * Build lyrics data object with sync support
     */
    buildLyricsData(track, data = {}) {
        const synced = data.synced ?? null;
        let parsed = null;

        if (synced) {
            console.log(`⚙️ Parsing synced lyrics for: ${track.title}`);
            parsed = this.parseLrc(synced);
            if (parsed) {
                console.log(`✅ Successfully parsed ${parsed.length} timed lines.`);
            } else {
                console.log(`⚠️ Synced lyrics found but failed to parse into timed lines.`);
            }
        }

        return {
            plain: data.plain ?? null,
            synced: synced,
            parsed: parsed,
            source: data.source ?? null,
            artist: data.artist ?? track?.artist ?? track?.uploader ?? null,
            title: data.title ?? track?.title ?? null,
            album: data.album ?? null
        };
    }

    /**
     * Parses LRC format [mm:ss.xx] or [mm:ss.xxx] text into structured timestamps
     */
    parseLrc(lrc) {
        if (!lrc || typeof lrc !== 'string') return null;
        const lines = lrc.split('\n');
        const parsed = [];

        for (const line of lines) {
            // Support multiple timestamps per line: [00:12.34][00:15.67]text
            const timeTagRegex = /\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g;
            let match;
            const timestamps = [];

            while ((match = timeTagRegex.exec(line)) !== null) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseFloat(match[2]);
                const time = Math.round((minutes * 60 + seconds) * 1000);
                timestamps.push(time);
            }

            if (timestamps.length > 0) {
                const text = line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
                if (text) {
                    for (const time of timestamps) {
                        parsed.push({ time, text });
                    }
                }
            }
        }

        if (parsed.length === 0) return null;

        // Ensure chronological sorting
        parsed.sort((a, b) => a.time - b.time);
        return parsed;
    }

    /**
     * Gets the lyric line for a specific time in ms
     */
    getLyricAtTime(lyricsData, timeMs) {
        if (!lyricsData || !lyricsData.parsed || lyricsData.parsed.length === 0) return null;

        const lines = lyricsData.parsed;
        let currentLine = null;

        for (let i = 0; i < lines.length; i++) {
            if (timeMs >= lines[i].time) {
                currentLine = lines[i].text;
            } else {
                break; // Lines are ordered by time
            }
        }

        return currentLine;
    }

    /**
     * Fetch lyrics - first from LRCLIB for sync, fallback to Genius
     */
    async fetchLyrics(track) {
        if (!track || !track.title) return null;

        const cacheKey = this.getCacheKey(track);

        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        console.log(`🔍 Searching lyrics for: ${track.title} - ${track.artist || track.uploader || ''}`);

        // Try LRCLIB first for synced support
        const lrclibResult = await this.fetchFromLrclib(track);
        if (lrclibResult && (lrclibResult.synced || lrclibResult.plain)) {
            console.log(`✅ Lyrics found on LRCLIB (${lrclibResult.synced ? 'synced' : 'plain'})`);
            this.storeInCache(cacheKey, lrclibResult);
            return lrclibResult;
        }

        // Fallback to Genius
        const geniusResult = await this.fetchFromGenius(track);
        if (geniusResult && geniusResult.plain) {
            console.log(`✅ Lyrics found on Genius (plain)`);
            this.storeInCache(cacheKey, geniusResult);
            return geniusResult;
        }

        // Cache null result to avoid repeated lookups
        this.storeInCache(cacheKey, null);
        return null;
    }

    async fetchFromLrclib(track) {
        try {
            const { artist, title, fallbackArtist } = this.extractArtistAndTitle(track.title, track.artist || track.uploader);
            const duration = track.duration ? Math.round(track.duration) : null;

            // Attempt 1: Direct /api/get exact lookup if artist & title are known
            if (title && (artist || fallbackArtist)) {
                try {
                    const getParams = {
                        track_name: title,
                        artist_name: artist || fallbackArtist
                    };
                    if (duration) getParams.duration = duration;

                    const directResponse = await this.http.get('https://lrclib.net/api/get', { params: getParams });
                    if (directResponse.data && (directResponse.data.plainLyrics || directResponse.data.syncedLyrics)) {
                        return this.buildLyricsData(track, {
                            plain: directResponse.data.plainLyrics,
                            synced: directResponse.data.syncedLyrics,
                            source: 'LRCLIB'
                        });
                    }
                } catch (e) {
                    // /api/get returns 404 if not exact, continue to search
                }
            }

            // Prepare search attempts for /api/search
            const searchUrl = 'https://lrclib.net/api/search';
            const attempts = [];

            if (title && artist) {
                attempts.push({ track_name: title, artist_name: artist });
                attempts.push({ q: `${artist} ${title}`.trim() });
            }

            if (fallbackArtist && fallbackArtist !== artist && title) {
                attempts.push({ track_name: title, artist_name: fallbackArtist });
                attempts.push({ q: `${fallbackArtist} ${title}`.trim() });
            }

            const cleanRawTitle = this.cleanTrackTitle(track.title);
            if (cleanRawTitle !== title) {
                attempts.push({ q: cleanRawTitle });
            }

            attempts.push({ q: title });

            for (const params of attempts) {
                if (!params.q && !params.track_name) continue;

                try {
                    const response = await this.http.get(searchUrl, { params });
                    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                        const result = response.data.find(r => (r.plainLyrics || r.syncedLyrics) && this.isMatch(track, r));
                        if (result) {
                            return this.buildLyricsData(track, {
                                plain: result.plainLyrics,
                                synced: result.syncedLyrics,
                                source: 'LRCLIB'
                            });
                        }
                    }
                } catch (error) {
                    // Continue to next search attempt
                }
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to fetch lyrics from LRCLIB:', error.message);
            return null;
        }
    }

    async fetchFromGenius(track) {
        try {
            const { artist, title, fallbackArtist } = this.extractArtistAndTitle(track.title, track.artist || track.uploader);
            const searchArtist = artist || fallbackArtist || '';
            const searchTitle = title || this.cleanTrackTitle(track.title || '');

            if (!searchTitle) return null;

            const queries = [];
            if (searchArtist) {
                queries.push(`${searchArtist} ${searchTitle}`);
            }
            queries.push(searchTitle);

            for (const query of queries) {
                try {
                    const searches = await this.geniusClient.songs.search(query);
                    if (!searches || searches.length === 0) continue;

                    const matchingSong = searches.find(s => this.isMatch(track, s));
                    if (!matchingSong) continue;

                    const lyrics = await matchingSong.lyrics();
                    if (!lyrics) continue;

                    const cleanedLyrics = this.cleanGeniusLyrics(lyrics);
                    if (!cleanedLyrics) continue;

                    return this.buildLyricsData(track, {
                        plain: cleanedLyrics,
                        source: 'Genius'
                    });
                } catch (err) {
                    // Try next query
                }
            }

            return null;
        } catch (error) {
            // Keep error quiet to avoid spamming console
            return null;
        }
    }

    cleanGeniusLyrics(lyrics) {
        if (!lyrics) return null;

        let cleaned = lyrics;

        // Step 1: Remove contributor/translation header
        cleaned = cleaned.replace(/^\d+\s+Contributors.*?Lyrics(<[^>]+>)*\s*/is, '');

        // Step 2: Remove HTML tags
        cleaned = cleaned.replace(/<[^>]*>/g, '');

        // Step 3: Remove description paragraphs
        cleaned = cleaned.replace(/^[^\[]+?\.{3}\s*Read More\s*/im, '');

        // Step 4: Remove bracketed descriptions with quotes
        cleaned = cleaned.replace(/\[[""][^\]]{50,}\]/g, '');

        // Step 5: Clean up whitespace
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
        cleaned = cleaned.trim();

        return cleaned || null;
    }

    /**
     * Format full lyrics for display (with pagination support)
     * @param {Object} lyricsData - Lyrics data
     * @param {number} maxLength - Max character length per page
     * @returns {Array<string>} Array of lyric pages
     */
    formatFullLyrics(lyricsData, maxLength = 4000) {
        if (!lyricsData) return [];

        const text = lyricsData.plain || lyricsData.synced?.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '') || '';
        if (!text) return [];

        const pages = [];
        const lines = text.split('\n').filter(line => line.trim());

        let currentPage = '';
        for (const line of lines) {
            if ((currentPage + line + '\n').length > maxLength) {
                if (currentPage) pages.push(currentPage.trim());
                currentPage = line + '\n';
            } else {
                currentPage += line + '\n';
            }
        }

        if (currentPage) pages.push(currentPage.trim());

        return pages;
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        for (const timer of this.cacheTimers.values()) {
            clearTimeout(timer);
        }
        this.cacheTimers.clear();
    }
}

module.exports = new LyricsManager();
