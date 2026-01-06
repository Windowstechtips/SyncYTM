import React, { useState } from 'react'
import { Loader, AlertCircle, Check, Music } from 'lucide-react'

const PlaylistImport = ({ onImport }) => {
    const [playlistUrl, setPlaylistUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [playlist, setPlaylist] = useState(null)
    const [selectedVideos, setSelectedVideos] = useState(new Set())

    // Extract playlist ID from YouTube URL
    const extractPlaylistId = (url) => {
        const patterns = [
            /[?&]list=([^&]+)/,  // Standard playlist URL
            /youtube\.com\/playlist\?list=([^&]+)/,
        ]

        for (const pattern of patterns) {
            const match = url.match(pattern)
            if (match) return match[1]
        }
        return null
    }

    const fetchPlaylist = async () => {
        const playlistId = extractPlaylistId(playlistUrl)

        if (!playlistId) {
            setError('Invalid playlist URL. Please paste a valid YouTube or YouTube Music playlist link.')
            return
        }

        setLoading(true)
        setError(null)

        try {
            const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY

            if (!apiKey) {
                throw new Error('YouTube API key not found. Please add VITE_YOUTUBE_API_KEY to your .env file.')
            }

            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/playlistItems?` +
                `part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`
            )

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('Playlist not found. Make sure the playlist is public or unlisted.')
                }
                throw new Error('Failed to fetch playlist. Please check the URL and try again.')
            }

            const data = await response.json()

            const videos = data.items.map(item => ({
                id: item.snippet.resourceId.videoId,
                title: item.snippet.title,
                thumbnail: item.snippet.thumbnails.default.url,
                channel: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle
            }))

            setPlaylist({
                title: data.items[0]?.snippet.playlistTitle || 'Playlist',
                videos
            })

            // Select all videos by default
            setSelectedVideos(new Set(videos.map(v => v.id)))

        } catch (err) {
            console.error('Playlist fetch error:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const toggleVideo = (videoId) => {
        const newSelected = new Set(selectedVideos)
        if (newSelected.has(videoId)) {
            newSelected.delete(videoId)
        } else {
            newSelected.add(videoId)
        }
        setSelectedVideos(newSelected)
    }

    const handleImport = () => {
        const videosToImport = playlist.videos.filter(v => selectedVideos.has(v.id))
        onImport(videosToImport)

        // Reset state
        setPlaylistUrl('')
        setPlaylist(null)
        setSelectedVideos(new Set())
    }

    const selectAll = () => {
        setSelectedVideos(new Set(playlist.videos.map(v => v.id)))
    }

    const deselectAll = () => {
        setSelectedVideos(new Set())
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
            {/* Input Section */}
            <div style={{ padding: '1rem', borderBottom: '1px solid hsl(var(--border))' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: '600' }}>Playlist URL</label>
                    <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginTop: '0.25rem' }}>
                        Paste a YouTube or YouTube Music playlist link (must be public or unlisted)
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                        className="input"
                        type="text"
                        placeholder="https://www.youtube.com/playlist?list=..."
                        value={playlistUrl}
                        onChange={(e) => setPlaylistUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && fetchPlaylist()}
                        disabled={loading}
                        style={{ flex: 1 }}
                    />
                    <button
                        className="btn btn-primary"
                        onClick={fetchPlaylist}
                        disabled={loading || !playlistUrl.trim()}
                    >
                        {loading ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : 'Fetch'}
                    </button>
                </div>

                {error && (
                    <div style={{
                        marginTop: '0.75rem',
                        padding: '0.75rem',
                        background: 'hsla(0, 70%, 50%, 0.1)',
                        border: '1px solid hsla(0, 70%, 50%, 0.3)',
                        borderRadius: '8px',
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'flex-start'
                    }}>
                        <AlertCircle size={16} color="hsl(0, 70%, 50%)" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span style={{ fontSize: '0.85rem', color: 'hsl(0, 70%, 50%)' }}>{error}</span>
                    </div>
                )}
            </div>

            {/* Playlist Preview */}
            {playlist && (
                <>
                    <div style={{ padding: '0 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>{playlist.title}</h4>
                            <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                                {selectedVideos.size} of {playlist.videos.length} selected
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-ghost" onClick={selectAll} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
                                Select All
                            </button>
                            <button className="btn btn-ghost" onClick={deselectAll} style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}>
                                Clear
                            </button>
                        </div>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem' }}>
                        {playlist.videos.map((video) => {
                            const isSelected = selectedVideos.has(video.id)
                            return (
                                <div
                                    key={video.id}
                                    onClick={() => toggleVideo(video.id)}
                                    style={{
                                        display: 'flex',
                                        gap: '0.75rem',
                                        padding: '0.5rem',
                                        marginBottom: '0.5rem',
                                        borderRadius: '8px',
                                        background: isSelected ? 'hsla(var(--primary)/0.1)' : 'transparent',
                                        border: `1px solid ${isSelected ? 'hsl(var(--primary))' : 'transparent'}`,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease'
                                    }}
                                    className="queue-item"
                                >
                                    <div style={{
                                        width: '20px',
                                        height: '20px',
                                        borderRadius: '4px',
                                        border: `2px solid ${isSelected ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                                        background: isSelected ? 'hsl(var(--primary))' : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0
                                    }}>
                                        {isSelected && <Check size={14} color="white" />}
                                    </div>

                                    <div style={{ width: '40px', height: '40px', background: 'black', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                                        <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                    </div>

                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {video.title}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{video.channel}</div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    <div style={{ padding: '1rem', borderTop: '1px solid hsl(var(--border))' }}>
                        <button
                            className="btn btn-primary"
                            onClick={handleImport}
                            disabled={selectedVideos.size === 0}
                            style={{ width: '100%' }}
                        >
                            <Music size={18} />
                            Import {selectedVideos.size} Song{selectedVideos.size !== 1 ? 's' : ''} to Queue
                        </button>
                    </div>
                </>
            )}

            {!playlist && !loading && (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2rem',
                    textAlign: 'center',
                    color: 'hsl(var(--text-muted))'
                }}>
                    <Music size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p style={{ fontSize: '0.9rem' }}>Paste a playlist URL above to get started</p>
                    <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
                        Works with YouTube and YouTube Music playlists
                    </p>
                </div>
            )}
        </div>
    )
}

export default PlaylistImport
