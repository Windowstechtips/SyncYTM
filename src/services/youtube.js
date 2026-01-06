const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY
const BASE_URL = 'https://www.googleapis.com/youtube/v3'

export const searchYoutube = async (query) => {
    if (!query) return []
    if (!API_KEY) {
        console.error("Missing YouTube API Key")
        return []
    }

    try {
        const response = await fetch(`${BASE_URL}/search?part=snippet&maxResults=10&q=${encodeURIComponent(query)}&type=video&key=${API_KEY}`)
        const data = await response.json()

        if (data.error) {
            throw new Error(data.error.message)
        }

        return data.items.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails.medium.url
        }))
    } catch (error) {
        console.error('YouTube Search Error:', error)
        return []
    }
}

/**
 * Extract playlist ID from various YouTube URL formats
 * Supports:
 * - https://www.youtube.com/playlist?list=...
 * - https://music.youtube.com/playlist?list=...
 * - https://youtube.com/playlist?list=...
 * - Direct playlist ID
 */
export const extractPlaylistId = (url) => {
    if (!url) return null

    // If it's already just a playlist ID (alphanumeric and some special chars)
    if (/^[a-zA-Z0-9_-]+$/.test(url.trim())) {
        return url.trim()
    }

    try {
        const urlObj = new URL(url)
        const listParam = urlObj.searchParams.get('list')
        return listParam
    } catch (error) {
        // Not a valid URL, return null
        return null
    }
}

/**
 * Fetch all videos from a YouTube playlist
 * Note: Playlists must be public or unlisted to be accessible
 */
export const getPlaylistItems = async (playlistUrl) => {
    if (!API_KEY) {
        console.error("Missing YouTube API Key")
        throw new Error("YouTube API Key is not configured")
    }

    const playlistId = extractPlaylistId(playlistUrl)
    if (!playlistId) {
        throw new Error("Invalid playlist URL or ID")
    }

    try {
        let allItems = []
        let nextPageToken = null
        let playlistTitle = 'Playlist'

        // Fetch playlist details first
        const playlistResponse = await fetch(
            `${BASE_URL}/playlists?part=snippet&id=${playlistId}&key=${API_KEY}`
        )
        const playlistData = await playlistResponse.json()

        if (playlistData.error) {
            if (playlistData.error.code === 404) {
                throw new Error("Playlist not found. Make sure it's public or unlisted.")
            }
            throw new Error(playlistData.error.message)
        }

        if (playlistData.items && playlistData.items.length > 0) {
            playlistTitle = playlistData.items[0].snippet.title
        }

        // Fetch all playlist items (paginated)
        do {
            const url = `${BASE_URL}/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}&key=${API_KEY}${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`
            const response = await fetch(url)
            const data = await response.json()

            if (data.error) {
                if (data.error.code === 404) {
                    throw new Error("Playlist not found or is private. Make sure it's public or unlisted.")
                }
                throw new Error(data.error.message)
            }

            if (data.items) {
                allItems = allItems.concat(data.items)
            }

            nextPageToken = data.nextPageToken
        } while (nextPageToken)

        // Filter out deleted/private videos and format the results
        const videos = allItems
            .filter(item => item.snippet.title !== 'Private video' && item.snippet.title !== 'Deleted video')
            .map(item => ({
                id: item.snippet.resourceId.videoId,
                title: item.snippet.title,
                channel: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
                thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url
            }))

        return {
            title: playlistTitle,
            videos
        }
    } catch (error) {
        console.error('YouTube Playlist Error:', error)
        throw error
    }
}
