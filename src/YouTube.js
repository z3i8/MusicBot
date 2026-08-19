const youtubedl = require('youtube-dl-exec');
const config = require('../config');
const LanguageManager = require('./LanguageManager');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// In-memory cache for search results to improve speed
const searchCache = new Map();
const infoCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

class YouTube {
    // yt-dlp için ortak parametreleri döndüren yardımcı fonksiyon
    static getYtDlpOptions(extraOptions = {}) {
        const baseOptions = {
            noCheckCertificates: true,
            noWarnings: true,
            // User-Agent header ekle
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            ],
            // Optimization flags
            noPlaylist: true,
            quiet: true,
            extractorArgs: 'youtube:player_client=mweb,web',
            ...extraOptions
        };

        // Cookie settings (use browser cookies, explicit file, or default cookies.txt if exists)
        if (config.ytdl.cookiesFromBrowser) {
            baseOptions.cookiesFromBrowser = config.ytdl.cookiesFromBrowser;
        } else {
            const defaultCookies = path.resolve(__dirname, '..', 'cookies.txt');
            const targetCookies = config.ytdl.cookiesFile || (fs.existsSync(defaultCookies) ? defaultCookies : null);
            if (targetCookies) {
                const cookiesPath = path.isAbsolute(targetCookies)
                    ? targetCookies
                    : path.resolve(__dirname, '..', targetCookies);
                if (fs.existsSync(cookiesPath)) {
                    baseOptions.cookies = cookiesPath;
                }
            }
        }

        return baseOptions;
    }

    static getCookieHeader() {
        try {
            const defaultCookies = path.resolve(__dirname, '..', 'cookies.txt');
            const targetCookies = config.ytdl.cookiesFile || (fs.existsSync(defaultCookies) ? defaultCookies : null);
            if (!targetCookies) return null;
            
            const cookiesPath = path.isAbsolute(targetCookies)
                ? targetCookies
                : path.resolve(__dirname, '..', targetCookies);

            if (!fs.existsSync(cookiesPath)) return null;

            const content = fs.readFileSync(cookiesPath, 'utf8');
            const lines = content.split('\n');
            const cookiePairs = [];

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;

                const parts = trimmed.split('\t');
                if (parts.length >= 7) {
                    const name = parts[5];
                    const value = parts[6];
                    cookiePairs.push(`${name}=${value}`);
                }
            }

            return cookiePairs.length > 0 ? cookiePairs.join('; ') : null;
        } catch (error) {
            console.error('Error parsing cookies.txt:', error.message);
            return null;
        }
    }

    static async scrapeSearch(query, limit = 1, guildId = null) {
        try {
            const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
            
            const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            };

            const cookieHeader = this.getCookieHeader();
            if (cookieHeader) {
                headers['Cookie'] = cookieHeader;
            }

            const response = await axios.get(url, {
                headers,
                timeout: 5000
            });

            const html = response.data;
            const regex = /var ytInitialData = ({.*?});<\/script>/s;
            const match = html.match(regex);

            if (!match) return [];

            const data = JSON.parse(match[1]);
            const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;

            if (!contents) return [];

            const tracks = [];
            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

            for (const item of contents) {
                if (tracks.length >= limit) break;

                const video = item.videoRenderer;
                if (!video) continue;

                const videoId = video.videoId;
                const title = video.title?.runs?.[0]?.text || unknownTitle;
                const artist = video.ownerText?.runs?.[0]?.text || unknownArtist;
                const durationText = video.lengthText?.simpleText;
                if (!durationText) continue; // Skip live streams/upcoming streams

                const thumbnail = video.thumbnail?.thumbnails?.[video.thumbnail.thumbnails.length - 1]?.url || video.thumbnail?.thumbnails?.[0]?.url;

                let duration = 0;
                const parts = durationText.split(':').reverse();
                for (let i = 0; i < parts.length; i++) {
                    duration += parseInt(parts[i]) * Math.pow(60, i);
                }

                if (videoId) {
                    tracks.push({
                        title,
                        artist,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        duration,
                        thumbnail,
                        thumbnails: video.thumbnail?.thumbnails || [],
                        platform: 'youtube',
                        type: 'track',
                        id: videoId,
                        views: video.viewCountText?.simpleText || '0 views',
                        uploadDate: video.publishedTimeText?.simpleText || 'Unknown date',
                        description: video.detailedMetadataSnippets?.[0]?.snippetText?.runs?.[0]?.text || '',
                        streamInfo: null
                    });
                }
            }

            return tracks;
        } catch (error) {
            console.error('High-speed YouTube search scraper error:', error.message);
            return [];
        }
    }

    static async search(query, limit = 1, guildId = null) {
        try {
            // Check cache
            const cacheKey = `${limit}:${query}`;
            if (searchCache.has(cacheKey)) {
                const cached = searchCache.get(cacheKey);
                if (Date.now() - cached.timestamp < CACHE_TTL) {
                    return cached.data;
                }
                searchCache.delete(cacheKey);
            }

            // If it's already a YouTube URL, get info directly
            if (this.isYouTubeURL(query)) {
                const info = await this.getInfo(query, guildId);
                return info ? [info] : [];
            }

            // Try the ultra-fast HTTP scraper first (under 500ms)
            try {
                const tracks = await this.scrapeSearch(query, limit, guildId);
                if (tracks && tracks.length > 0) {
                    // Save to cache
                    searchCache.set(cacheKey, {
                        data: tracks,
                        timestamp: Date.now()
                    });
                    return tracks;
                }
            } catch (scrapeError) {
                console.error('⚠️ High-speed YouTube scraper failed, falling back to yt-dlp:', scrapeError.message);
            }

            // Fallback to slower yt-dlp search if scraper failed
            const searchQuery = `ytsearch${limit}:${query}`;

            // Optimization: If limit is 1, don't use flatPlaylist so we get full metadata (like duration) in one go
            // If limit > 1, we use flatPlaylist for speed and fetch details only if necessary
            const searchOptions = {
                dumpSingleJson: true,
                flatPlaylist: limit > 1,
                playlistEnd: limit,
                noPlaylist: true
            };

            const results = await youtubedl(searchQuery, this.getYtDlpOptions(searchOptions));

            if (!results || !results.entries || results.entries.length === 0) {
                return [];
            }

            const tracks = [];

            for (const item of results.entries) {
                if (tracks.length >= limit) break;

                try {
                    // Skip live streams or upcoming videos
                    if (item.is_live || item.live_status === 'is_live' || !item.duration || item.duration === 0) {
                        continue;
                    }

                    const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
                    const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

                    const track = {
                        title: item.title || item.fulltitle || unknownTitle,
                        artist: item.uploader || item.channel || unknownArtist,
                        url: item.webpage_url || item.url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : null),
                        duration: item.duration || 0,
                        thumbnail: item.thumbnail || (item.thumbnails && item.thumbnails.length > 0 ? item.thumbnails[item.thumbnails.length - 1].url : null),
                        thumbnails: item.thumbnails || [],
                        platform: 'youtube',
                        type: 'track',
                        id: item.id,
                        views: item.view_count,
                        uploadDate: item.upload_date,
                        description: item.description,
                        // Captured stream info for immediate playback if available (only in full info mode, limit=1)
                        streamInfo: (limit === 1 && item.url && item.url !== item.webpage_url) ? {
                            url: item.url,
                            type: item.acodec && item.acodec.includes('opus') ? 'opus' : 'arbitrary',
                            duration: item.duration || 0,
                            bitrate: item.abr || item.tbr || 0,
                            format: item.format,
                            httpHeaders: item.http_headers || {}
                        } : null
                    };

                    // Only fetch additional info if duration is missing and we really need it
                    // In single search (limit=1), we turned off flatPlaylist, so duration should already be there.
                    if (limit === 1 && (!track.duration || track.duration === 0)) {
                        const detailedInfo = await this.getInfo(track.url, guildId);
                        if (detailedInfo && detailedInfo.duration) {
                            track.duration = detailedInfo.duration;
                        }
                    }

                    tracks.push(track);
                } catch (error) {
                    continue;
                }
            }

            // Save to cache
            if (tracks.length > 0) {
                searchCache.set(cacheKey, {
                    data: tracks,
                    timestamp: Date.now()
                });
            }

            return tracks;
        } catch (error) {
            console.error('YouTube Search Error:', error);
            return [];
        }
    }

    static async getInfo(url, guildId = null) {
        try {
            // Check cache
            if (infoCache.has(url)) {
                const cached = infoCache.get(url);
                if (Date.now() - cached.timestamp < CACHE_TTL) {
                    return cached.data;
                }
                infoCache.delete(url);
            }

            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                preferFreeFormats: true,
                skipDownload: true
            }));

            if (!info) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_info_returned') : 'No info returned from youtube-dl';
                throw new Error(errorMsg);
            }

            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

            const track = {
                title: info.title || unknownTitle,
                artist: info.uploader || info.channel || unknownArtist,
                url: info.webpage_url || url,
                duration: info.duration || 0,
                thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : null),
                thumbnails: info.thumbnails || [],
                platform: 'youtube',
                type: 'track',
                id: info.id,
                views: info.view_count,
                uploadDate: info.upload_date,
                description: info.description,
                formats: info.formats,
                // Captured stream info for immediate playback
                streamInfo: info.url ? {
                    url: info.url,
                    type: info.acodec && info.acodec.includes('opus') ? 'opus' : 'arbitrary',
                    duration: info.duration || 0,
                    bitrate: info.abr || info.tbr || 0,
                    format: info.format,
                    httpHeaders: info.http_headers || {}
                } : null
            };

            // Save to cache
            infoCache.set(url, {
                data: track,
                timestamp: Date.now()
            });

            return track;
        } catch (error) {
            return null;
        }
    }

    static async getStream(url, guildId = null, startSeconds = 0, returnStream = false) {
        try {
            if (!url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.url_required') : 'URL is required';
                throw new Error(errorMsg);
            }

            // Get stream URL with simple format
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                format: config.ytdl.format || 'bestaudio/best',
            }));

            if (!info || !info.url) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_stream_url') : 'No stream URL found';
                throw new Error(errorMsg);
            }

            const baseUrl = info.url;
            const canSeek = /googlevideo\.com/i.test(baseUrl);
            let finalUrl = baseUrl;

            const seekSeconds = Math.max(0, Number(startSeconds) || 0);
            if (seekSeconds > 0 && canSeek) {
                const startMs = Math.floor(seekSeconds * 1000);
                const separator = baseUrl.includes('?') ? '&' : '?';
                finalUrl = `${baseUrl}${separator}begin=${startMs}`;
            }

            const result = {
                url: finalUrl,
                rawUrl: baseUrl,
                type: info.acodec && info.acodec.includes('opus') ? 'opus' : 'arbitrary',
                duration: info.duration || 0,
                bitrate: info.abr || info.tbr || 0,
                canSeek,
                format: info.format,
                httpHeaders: info.http_headers || {}
            };

            if (returnStream) {
                const ytdlOptions = this.getYtDlpOptions({
                    output: '-',
                    format: config.ytdl.format || 'bestaudio/best',
                });
                const subprocess = youtubedl.exec(url, ytdlOptions, { stdio: ['ignore', 'pipe', 'ignore'] });
                // Prevent unhandled promise rejection if subprocess is killed/terminated later
                subprocess.catch(() => {});
                result.stream = subprocess.stdout;
                result.subprocess = subprocess;
            }

            return result;
        } catch (error) {
            throw error;
        }
    }

    static async getPlaylist(url, guildId = null) {
        try {
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                flatPlaylist: true,
            }));

            if (!info) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_playlist_info') : 'No playlist info found';
                throw new Error(errorMsg);
            }

            if (!info.entries || info.entries.length === 0) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_playlist_entries') : 'No playlist entries found';
                throw new Error(errorMsg);
            }

            const unknownTitle = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_title') : 'Unknown Title';
            const unknownArtist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_artist') : 'Unknown Artist';

            const tracks = [];
            for (const entry of info.entries.slice(0, config.bot.maxPlaylistSize)) {
                if (entry && (entry.id || entry.url)) {
                    try {
                        const track = {
                            title: entry.title || entry.fulltitle || unknownTitle,
                            artist: entry.uploader || entry.channel || entry.uploader_id || unknownArtist,
                            url: entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : null),
                            duration: entry.duration || 0,
                            thumbnail: entry.thumbnail || (entry.thumbnails && entry.thumbnails.length > 0 ? entry.thumbnails[entry.thumbnails.length - 1].url : null),
                            thumbnails: entry.thumbnails || [],
                            platform: 'youtube',
                            type: 'track',
                            id: entry.id,
                        };

                        if (track.url) {
                            tracks.push(track);
                        }
                    } catch (entryError) {
                        continue;
                    }
                }
            }

            if (tracks.length === 0) {
                const errorMsg = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.no_valid_tracks') : 'No valid tracks found in playlist';
                throw new Error(errorMsg);
            }

            const unknownPlaylist = guildId ? await LanguageManager.getTranslation(guildId, 'youtube.unknown_playlist') : 'Unknown Playlist';

            return {
                title: info.title || unknownPlaylist,
                tracks: tracks,
                totalTracks: info.playlist_count || tracks.length,
                url: url,
                platform: 'youtube',
                type: 'playlist',
            };
        } catch (error) {
            return null;
        }
    }

    static isYouTubeURL(url) {
        const patterns = [
            /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/playlist\?list=)/,
            /^https?:\/\/(www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]+/,
            /^https?:\/\/(www\.)?youtube\.com\/v\/[a-zA-Z0-9_-]+/,
        ];
        return patterns.some(pattern => pattern.test(url));
    }

    static isPlaylist(url) {
        return url.includes('list=') &&
            (url.includes('youtube.com/playlist') ||
                url.includes('youtube.com/watch') ||
                url.includes('youtu.be'));
    }

    static parseDuration(durationString) {
        if (!durationString) return 0;
        const parts = durationString.split(':').reverse();
        let seconds = 0;
        for (let i = 0; i < parts.length; i++) {
            seconds += parseInt(parts[i]) * Math.pow(60, i);
        }
        return seconds;
    }

    static formatDuration(seconds) {
        if (!seconds || seconds === 0) return '0:00';
        const totalSeconds = Math.floor(Number(seconds) || 0);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const remainingSeconds = totalSeconds % 60;
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
        }
    }

    static async getRelatedVideos(videoId, limit = 5) {
        return [];
    }

    static extractVideoId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/,
            /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
            /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
        ];
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    }

    static extractPlaylistId(url) {
        const match = url.match(/[&?]list=([a-zA-Z0-9_-]+)/);
        return match ? match[1] : null;
    }

    static createThumbnailUrl(videoId, quality = 'maxresdefault') {
        return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
    }

    static createVideoUrl(videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    static async validateUrl(url) {
        try {
            if (!this.isYouTubeURL(url)) return false;
            const info = await youtubedl(url, this.getYtDlpOptions({
                dumpSingleJson: true,
                skipDownload: true,
            }));
            return !!info && !!info.title;
        } catch (error) {
            return false;
        }
    }
}

module.exports = YouTube;