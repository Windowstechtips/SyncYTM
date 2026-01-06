import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Player from '../components/Player'
import SearchOverlay from '../components/SearchOverlay'
import MusicModeUI from '../components/MusicModeUI'
import { getPlaylistItems } from '../services/youtube'

import { useWebRTC } from '../hooks/useWebRTC'
import { MessageCircle, Users, Send, Search as SearchIcon, ListMusic, Music2, Wifi, WifiOff, Activity, Play, Plus, Check, X, Shield, ShieldAlert, Home, Music, RefreshCw } from 'lucide-react'

export default function Room() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const [room, setRoom] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isAuthorized, setIsAuthorized] = useState(false)
    const [passwordInput, setPasswordInput] = useState('')

    // Player State
    const [url, setUrl] = useState('')
    const [isPlaying, setIsPlaying] = useState(false)
    const [queue, setQueue] = useState([]) // Array of video objects (Persistent Playlist)
    const [currentVideo, setCurrentVideo] = useState(null)

    // UI State
    const [showSearch, setShowSearch] = useState(false)
    const [isMusicMode, setIsMusicMode] = useState(false)
    const [messages, setMessages] = useState([])
    const [newMessage, setNewMessage] = useState('')
    const [showDebug, setShowDebug] = useState(false)
    const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'users'
    const [queueTab, setQueueTab] = useState('queue') // 'queue' | 'playlists'

    // Playlist Import State
    const [playlistUrl, setPlaylistUrl] = useState('')
    const [playlistData, setPlaylistData] = useState(null)
    const [loadingPlaylist, setLoadingPlaylist] = useState(false)
    const [playlistError, setPlaylistError] = useState('')
    const [selectedSongs, setSelectedSongs] = useState(new Set())


    // Remote Control State
    const [remoteUsers, setRemoteUsers] = useState(new Set()) // Set of emails
    const [songRequests, setSongRequests] = useState([]) // Array of { video, user }

    const playerRef = useRef(null)
    const isBlockingUpdates = useRef(false) // Strict Lock: Ignore outgoing events when true

    // Track Last Hydration/Sync to calculate drift
    const lastSyncRef = useRef({ time: 0, timestamp: 0 })
    const seekingRef = useRef(false) // Lock to prevent pause broadcasts during seek
    const isBufferingRef = useRef(false) // Track buffering state to ignore false pauses

    // Tracks current state for hydration
    const stateRef = useRef({ url: '', isPlaying: false, queue: [], currentVideo: null })

    // Track last known playback time to detect seeks via onProgress
    const lastProgressTimeRef = useRef(0)

    const isHost = room?.host_id === user?.id
    const hasRemote = isHost || remoteUsers.has(user?.email)

    const queueRef = useRef(queue)
    const remoteUsersRef = useRef(remoteUsers)
    const isHostRef = useRef(isHost)

    useEffect(() => {
        stateRef.current = { url, isPlaying, queue, currentVideo }
        queueRef.current = queue
        remoteUsersRef.current = remoteUsers
        isHostRef.current = isHost // Derived from user/room
    }, [url, isPlaying, queue, currentVideo, remoteUsers, isHost])

    // Callback for incoming WebRTC data
    const onData = React.useCallback((data, senderEmail) => {
        console.log('RX from', senderEmail, ':', data.type)

        // --- Security / Authorization Gate ---
        // If I am the Host, I should only accept control commands from Authorized Remote Users
        const controlTypes = ['play', 'pause', 'seek', 'play-video', 'queue-add', 'sync-state']
        if (isHostRef.current && controlTypes.includes(data.type)) {
            const isAuthorized = remoteUsersRef.current.has(senderEmail)
            if (!isAuthorized) {
                console.warn(`Host ignored unauthorized '${data.type}' from ${senderEmail}`)
                return
            }
        }
        // -------------------------------------

        if (data.type === 'chat') {
            setMessages(prev => [...prev, { id: Date.now(), user: senderEmail, text: data.payload }])
        }

        if (data.type === 'sync-state') {
            // Extra safety: Host never hydrates from peers (already covered by Auth Gate above, but explicit check)
            if (isHostRef.current) return

            console.log('HYDRATING STATE', data.state)
            const { url, isPlaying: remoteIsPlaying, queue: remoteQueue, currentVideo, time } = data.state

            isBlockingUpdates.current = true // START HYDRATION LOCK

            if (remoteQueue) setQueue(remoteQueue)
            setCurrentVideo(currentVideo)
            if (url) setUrl(url)

            setIsPlaying(remoteIsPlaying)

            if (time > 0) {
                setTimeout(() => {
                    if (playerRef.current) playerRef.current.seekTo(time)
                    // Release lock after enough time for seek + buffer to settle
                    setTimeout(() => {
                        isBlockingUpdates.current = false
                        console.log('HYDRATION UNLOCK')
                    }, 3000)
                }, 1000)
            } else {
                setTimeout(() => {
                    isBlockingUpdates.current = false
                    console.log('HYDRATION UNLOCK')
                }, 2000)
            }
        }

        // --- Permissions Events ---
        if (data.type === 'request-song') {
            // Only Host receives/handles this (UI wise)
            if (isHostRef.current) {
                setSongRequests(prev => [...prev, { video: data.video, user: senderEmail, id: Date.now() }])
                // Optional: Play a notification sound
                console.log('Song Request Received:', data.video.title)
            }
        }

        if (data.type === 'grant-remote') {
            // Update local remoteUsers list
            const { targetEmail, value } = data
            setRemoteUsers(prev => {
                const newSet = new Set(prev)
                if (value) newSet.add(targetEmail)
                else newSet.delete(targetEmail)
                return newSet
            })
        }

        if (data.type === 'sync-remotes') {
            // Host broadcasts the full list to new peers
            setRemoteUsers(new Set(data.remotes))
        }
        // --------------------------

        // --- Request/Reply Sync Protocol ---
        if (data.type === 'request-time') {
            // Use refs for current state check if needed, but direct ref access to player is safe
            if (playerRef.current) {
                const currentTime = playerRef.current.getCurrentTime()
                // We can't access 'isPlaying' state easily here without ref, but checking player is enough
                // Or use stateRef
                if (stateRef.current.isPlaying) {
                    broadcastDataRef.current({ type: 'time-update', time: currentTime })
                }
            }
        }

        if (data.type === 'time-update') {
            isBlockingUpdates.current = true
            if (playerRef.current) {
                const myTime = playerRef.current.getCurrentTime()
                if (Math.abs(myTime - data.time) > 1.0) {
                    playerRef.current.seekTo(data.time)
                }
            }
            setTimeout(() => isBlockingUpdates.current = false, 500)
        }
        // -----------------------------------

        if (data.type === 'play') {
            if (isBlockingUpdates.current) return
            isBlockingUpdates.current = true
            setTimeout(() => isBlockingUpdates.current = false, 1000)

            setIsPlaying(true)
            if (typeof data.time === 'number' && playerRef.current) {
                const current = playerRef.current.getCurrentTime()
                if (Math.abs(current - data.time) > 2) {
                    playerRef.current.seekTo(data.time)
                }
            }
        }

        if (data.type === 'pause') {
            if (isBlockingUpdates.current) return
            isBlockingUpdates.current = true
            setTimeout(() => isBlockingUpdates.current = false, 1000)

            setIsPlaying(false)
        }

        if (data.type === 'seek') {
            console.log('RX: SEEK command', data.time)
            isBlockingUpdates.current = true
            seekingRef.current = true // Prevent spurious pause events during seek
            isBufferingRef.current = true // Seeking causes buffering

            setTimeout(() => {
                isBlockingUpdates.current = false
                seekingRef.current = false
                isBufferingRef.current = false
                console.log('Seek lock released')
            }, 1500) // Extended timeout to cover seek + buffer settling

            if (playerRef.current) {
                console.log('Seeking player to:', data.time)
                playerRef.current.seekTo(data.time)
                console.log('SeekTo called successfully')
            } else {
                console.warn('No playerRef available for seek')
            }
        }

        if (data.type === 'play-video') {
            isBlockingUpdates.current = true
            setTimeout(() => isBlockingUpdates.current = false, 4000) // Longer lock for video load

            // Direct call to state setter or ensure PlayVideo logic is safe
            // Ideally we need to invoke logic that might depend on state.
            // But for simple SetState it's fine.
            // HOWEVER: playVideo function depends on state. 
            // We should duplicate logic or use Ref logic.
            // Simplified:
            setCurrentVideo(data.video)
            setUrl(`https://www.youtube.com/watch?v=${data.video.id}`)
            setIsPlaying(true)
        }

        if (data.type === 'queue-add') {
            setQueue(prev => [...prev, data.video])
        }

        if (data.type === 'request-sync') {
            console.log('RX: Request Sync')
            if (isHostRef.current) {
                console.log('Sending Sync State payload...')
                const currentState = {
                    type: 'sync-state',
                    state: {
                        ...stateRef.current,
                        time: playerRef.current ? playerRef.current.getCurrentTime() : 0
                    }
                }
                // Broadcast to ensure everyone is aligned? Or just unicast?
                // Broadcast is safer for general "resync" button
                broadcastDataRef.current(currentState)
                broadcastDataRef.current({ type: 'sync-remotes', remotes: Array.from(remoteUsersRef.current) })
            }
        }
    }, []) // Empty dependency array = STABLE FUNCTION

    const onPeerConnect = React.useCallback((peerId, email) => {
        console.log('New peer connected:', email)

        // Only Host (or Remote) should send state to hydrate the new peer.
        // Guests should NEVER send state on connect.
        if (isHostRef.current) {
            console.log('Sending Host State to:', email)
            // Send Playback State (Unicast)
            if (stateRef.current.currentVideo || stateRef.current.queue.length > 0) {
                const currentState = {
                    type: 'sync-state',
                    state: {
                        ...stateRef.current,
                        time: playerRef.current ? playerRef.current.getCurrentTime() : 0
                    }
                }
                sendToPeerRef.current(peerId, currentState)
            }
            // Send Remote Permissions List (Host only)
            sendToPeerRef.current(peerId, { type: 'sync-remotes', remotes: Array.from(remoteUsersRef.current) })
        }
    }, [])

    // Need refs to hook methods to call them from inside callbacks without dependency loops
    const broadcastDataRef = useRef(() => { })
    const sendToPeerRef = useRef(() => { })

    const { peers, broadcastData, sendToPeer } = useWebRTC(isAuthorized ? id : null, user, onData, onPeerConnect)

    useEffect(() => {
        broadcastDataRef.current = broadcastData
        sendToPeerRef.current = sendToPeer
    }, [broadcastData, sendToPeer])

    useEffect(() => {
        fetchRoom()
    }, [id])

    const fetchRoom = async () => {
        const { data, error } = await supabase.from('rooms').select('*').eq('id', id).single()
        if (error) {
            alert('Room not found')
            navigate('/')
        } else {
            setRoom(data)
            if (Array.isArray(data.queue)) {
                setQueue(data.queue)
            }
            if (!data.is_private || data.host_id === user.id) {
                setIsAuthorized(true)
            }
        }
        setLoading(false)
    }

    // Helper to update Queue State everywhere (Local + DB + Peers)
    const handleQueueUpdate = async (newQueue, shouldBroadcast = true) => {
        setQueue(newQueue)

        // Broadcast change to peers
        if (shouldBroadcast && newQueue.length > queue.length) {
            // Optimization: Only broadcast the NEW item if it's an addition
            const newItem = newQueue[newQueue.length - 1]
            broadcastData({ type: 'queue-add', video: newItem })
        }

        // Persist to DB (Host Only) - Debounced ideally, but direct for now is safer for consistency
        if (isHost) {
            await supabase.from('rooms').update({ queue: newQueue }).eq('id', id)
        }
    }

    const handlePasswordSubmit = (e) => {
        e.preventDefault()
        if (room.password_hash === passwordInput) {
            setIsAuthorized(true)
        } else {
            alert('Incorrect Password')
        }
    }

    // --- Logic ---

    const playVideo = (video, broadcast = true) => {
        // Security check: Only allow if possessing remote OR if responding to an incoming broadcast (sync)
        if (broadcast && !hasRemote) return

        if (currentVideo?.id === video.id) {
            // Optimization: If same video, just ensure playing (prevents flickering/reload)
            setIsPlaying(true)
            if (broadcast) broadcastData({ type: 'play-video', video })
            return
        }

        setCurrentVideo(video)
        setUrl(`https://www.youtube.com/watch?v=${video.id}`)
        setIsPlaying(true)
        if (broadcast) {
            broadcastData({ type: 'play-video', video })
        }
    }

    const handleVideoAction = (video) => {
        if (hasRemote) {
            // If remote: Add to queue
            const newQueue = [...queue, video]
            handleQueueUpdate(newQueue, true)

            if (!currentVideo) {
                playVideo(video) // Auto-play if idle
            }
            setShowSearch(false)
        } else {
            // If guest: Request song
            broadcastData({ type: 'request-song', video })
            alert('Song request sent to Host!')
            setShowSearch(false)
        }
    }

    const handleNext = () => {
        if (!hasRemote) return
        if (!currentVideo || queue.length === 0) return

        const currentIndex = queue.findIndex(v => v.id === currentVideo.id)
        if (currentIndex < queue.length - 1) {
            playVideo(queue[currentIndex + 1])
        } else {
            setIsPlaying(false)
        }
    }

    const handlePrev = () => {
        if (!hasRemote) return
        if (!currentVideo || queue.length === 0) return

        const currentIndex = queue.findIndex(v => v.id === currentVideo.id)
        if (currentIndex > 0) {
            playVideo(queue[currentIndex - 1])
        } else {
            if (playerRef.current) playerRef.current.seekTo(0)
        }
    }

    // Host Functions
    const toggleRemote = (targetEmail) => {
        if (!isHost) return
        const isGranted = remoteUsers.has(targetEmail)

        // Update Local
        const newSet = new Set(remoteUsers)
        if (isGranted) newSet.delete(targetEmail)
        else newSet.add(targetEmail)
        setRemoteUsers(newSet)

        // Broadcast
        broadcastData({ type: 'grant-remote', targetEmail, value: !isGranted })
    }

    const approveRequest = (req) => {
        const newQueue = [...queue, req.video]
        handleQueueUpdate(newQueue, true)

        setSongRequests(prev => prev.filter(r => r.id !== req.id)) // Remove from requests
        if (!currentVideo) playVideo(req.video)
    }

    const denyRequest = (reqId) => {
        setSongRequests(prev => prev.filter(r => r.id !== reqId))
    }

    const handleSendMessage = (e) => {
        e.preventDefault()
        if (!newMessage.trim()) return
        const msg = { type: 'chat', payload: newMessage }
        broadcastData(msg)
        setMessages(prev => [...prev, { id: user?.email ? Date.now() : Date.now() + 1, user: user?.email || 'Guest', text: newMessage }])
        setNewMessage('')
    }

    const handleLoadPlaylist = async (e) => {
        e.preventDefault()
        if (!playlistUrl.trim()) return

        setLoadingPlaylist(true)
        setPlaylistError('')
        setPlaylistData(null)
        setSelectedSongs(new Set())

        try {
            const data = await getPlaylistItems(playlistUrl)
            setPlaylistData(data)
            // Auto-select all songs
            setSelectedSongs(new Set(data.videos.map(v => v.id)))
        } catch (error) {
            setPlaylistError(error.message || 'Failed to load playlist')
        } finally {
            setLoadingPlaylist(false)
        }
    }

    const toggleSongSelection = (videoId) => {
        setSelectedSongs(prev => {
            const newSet = new Set(prev)
            if (newSet.has(videoId)) {
                newSet.delete(videoId)
            } else {
                newSet.add(videoId)
            }
            return newSet
        })
    }

    const handleImportSelected = () => {
        if (!playlistData || selectedSongs.size === 0) return

        const videosToImport = playlistData.videos.filter(v => selectedSongs.has(v.id))
        const newQueue = [...queue, ...videosToImport]
        handleQueueUpdate(newQueue, true)

        // Clear playlist state
        setPlaylistUrl('')
        setPlaylistData(null)
        setSelectedSongs(new Set())
        setQueueTab('queue') // Switch back to queue tab

        // Auto-play first imported song if nothing is playing
        if (!currentVideo && videosToImport.length > 0) {
            playVideo(videosToImport[0])
        }
    }

    const handlePlaylistImport = (videos) => {
        const newQueue = [...queue, ...videos]
        handleQueueUpdate(newQueue, true)

        // Switch to queue tab to show imported songs
        setQueueTab('queue')

        // Optionally play first song if nothing is playing
        if (!currentVideo && videos.length > 0) {
            playVideo(videos[0])
        }
    }

    const onProgress = (state) => {
        const currentTime = state.playedSeconds
        const lastTime = lastProgressTimeRef.current

        // Detect if there was a significant time jump (> 2 seconds difference)
        // This indicates a seek operation (user dragged the seekbar)
        const timeDiff = Math.abs(currentTime - lastTime)

        // Only detect seeks if we have a valid last time and not currently blocked
        if (lastTime > 0 && timeDiff > 2 && !isBlockingUpdates.current && !seekingRef.current) {
            console.log('SEEK DETECTED via onProgress! Jump from', lastTime, 'to', currentTime, 'diff:', timeDiff)
            // Trigger the seek handler as if onSeek was called
            onSeek(currentTime)
        }

        // Update last known time
        lastProgressTimeRef.current = currentTime
    }

    const onBuffer = () => {
        isBufferingRef.current = true
    }

    const pauseDebounceRef = useRef(null)

    const onPlay = () => {
        isBufferingRef.current = false // We are playing, so not buffering

        // Clear any pending pause broadcast (if we resumed quickly)
        if (pauseDebounceRef.current) {
            clearTimeout(pauseDebounceRef.current)
            pauseDebounceRef.current = null
        }

        if (isBlockingUpdates.current) {
            console.log('Identify spurious Play (Blocked)')
            return
        }

        if (!hasRemote) {
            setIsPlaying(false)
            return
        }

        if (isPlaying) return

        setIsPlaying(true)
        broadcastData({ type: 'play', time: playerRef.current?.getCurrentTime() || 0 })
    }

    const onPause = () => {
        // Critical: Ignore pauses that happen during Seek or Buffering
        if (isBlockingUpdates.current || seekingRef.current || isBufferingRef.current) {
            console.log('Ignored Pause (Blocked/Seek/Buffer)', {
                block: isBlockingUpdates.current,
                seek: seekingRef.current,
                buff: isBufferingRef.current
            })
            return
        }

        if (!hasRemote) { setIsPlaying(true); return; } // Prevent pause

        // DEBOUNCE PAUSE: Wait 1000ms to see if this is actually a Seek or Resume
        // Increased to 1000ms to handle slow seekbar drags (onSeek fires on release, not during drag)
        if (pauseDebounceRef.current) clearTimeout(pauseDebounceRef.current)

        pauseDebounceRef.current = setTimeout(() => {
            // Double-check seekingRef hasn't been set in the meantime
            if (seekingRef.current) {
                console.log('Cancelled Pause - seek detected during debounce')
                pauseDebounceRef.current = null
                return
            }

            console.log('Broadcasting PAUSE (Debounced)')
            setIsPlaying(false)
            broadcastData({ type: 'pause' })
            pauseDebounceRef.current = null
        }, 1000) // Increased to 1000ms to catch slow seeks
    }

    const onSeek = (seconds) => {
        console.log('onSeek Triggered:', seconds, 'HasRemote:', hasRemote, 'Block:', isBlockingUpdates.current)
        if (isBlockingUpdates.current) return
        if (!hasRemote) return

        // Cancel any pending pause from the seek start
        if (pauseDebounceRef.current) {
            console.log('Cancelled Pause due to Seek')
            clearTimeout(pauseDebounceRef.current)
            pauseDebounceRef.current = null
        }

        // Set seeking lock to ignore the subsequent buffering/pause/play events
        seekingRef.current = true
        isBufferingRef.current = true

        // Extended seek lock to cover:
        // - The pause that happened before this seek (retroactive)
        // - The seek operation itself
        // - The play that happens after seek
        setTimeout(() => {
            seekingRef.current = false
            isBufferingRef.current = false
        }, 2000) // Increased from 1500ms to 2000ms for better coverage

        console.log('Broadcasting SEEK:', seconds)
        broadcastData({ type: 'seek', time: seconds })
    }

    const onEnded = () => {
        if (isHost) {
            handleNext()
        }
    }

    if (loading) return <div className="container" style={{ paddingTop: '4rem' }}>Loading Room...</div>

    if (!isAuthorized) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
                <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '2rem' }}>
                    <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Private Room</h2>
                    <form onSubmit={handlePasswordSubmit}>
                        <input className="input" type="password" placeholder="Enter Room Password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} autoFocus />
                        <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }}>Enter Room</button>
                    </form>
                </div>
            </div>
        )
    }

    return (
        <div style={{
            minHeight: '100vh',
            width: '100%',
            background: 'radial-gradient(circle at top right, hsl(var(--primary) / 0.2), transparent 40%)',
            overflowX: 'hidden'
        }}>
            <div className="container room-layout" style={{
                padding: '2rem 0',
                height: 'auto'
            }}>
                <style>{`
                .room-layout {
                    display: grid;
                    grid-template-columns: minmax(0, 3fr) 1fr;
                    gap: 2rem;
                }
                .mobile-only { display: none; }
                
                @media (max-width: 900px) {
                    .room-layout {
                        display: flex;
                        flex-direction: column;
                        height: auto !important;
                        overflow-y: auto !important;
                        gap: 1rem;
                    }
                    .room-right-col {
                        height: 500px !important;
                    }
                    /* Mobile Header Optimizations */
                    .mobile-hide-text span {
                        display: none;
                    }
                    .btn-mobile-compact {
                        padding: 0.5rem !important;
                    }
                    h2 {
                        font-size: 1.25rem !important;
                    }
                    .container {
                        padding: 1rem !important;
                    }
                }
            `}</style>

                {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} onAddParams={handleVideoAction} isRequest={!hasRemote} />}

                {/* Network Debug */}
                {showDebug && (
                    <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', width: '300px', background: 'rgba(0,0,0,0.9)', padding: '1rem', borderRadius: '8px', zIndex: 9999, border: '1px solid #333', color: '#0f0', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                        <button onClick={() => setShowDebug(false)} style={{ color: 'white' }}>Close</button>
                        <pre>{JSON.stringify({ peers: peers.length, remote: hasRemote }, null, 2)}</pre>
                    </div>
                )}

                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 0, overflow: 'hidden' }}>
                    <header style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ minWidth: 0 }}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room?.name}</h2>
                            <p className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }} onClick={() => setShowDebug(!showDebug)}>
                                {peers.length > 0 ? <Wifi size={16} color="limegreen" /> : <WifiOff size={16} color="red" />}
                                <span className="mobile-hide-text" title="Click for Network Details"><span>{peers.length} peers connected</span></span>
                            </p>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                            <button className="btn btn-ghost btn-mobile-compact" style={{ padding: '0.5rem' }} onClick={() => broadcastData({ type: 'request-sync' })} title="Force Sync">
                                <RefreshCw size={20} />
                            </button>
                            <button className="btn btn-ghost btn-mobile-compact" style={{ padding: '0.5rem' }} onClick={() => navigate('/')} title="Go Home">
                                <Home size={20} />
                            </button>

                            <button className="btn btn-ghost btn-mobile-compact" style={{ padding: '0.5rem' }} onClick={() => setShowDebug(!showDebug)}>
                                <Activity size={20} />
                            </button>

                            <button className={`btn ${isMusicMode ? 'btn-primary' : 'btn-ghost'} btn-mobile-compact mobile-hide-text`} onClick={() => setIsMusicMode(!isMusicMode)}>
                                <Music2 size={20} /> <span>Music Mode</span>
                            </button>
                            <button className="btn btn-primary btn-mobile-compact mobile-hide-text" onClick={() => setShowSearch(true)}>
                                {hasRemote ? <><Plus size={20} /> <span>Add Song</span></> : <><SearchIcon size={20} /> <span>Request Song</span></>}
                            </button>
                        </div>
                    </header>

                    {/* Player Area - Swappable */}
                    <div style={{ flexShrink: 0 }}>
                        <div style={{ display: isMusicMode ? 'none' : 'block' }}>
                            {url ? (
                                <Player
                                    url={url}
                                    isPlaying={isPlaying}
                                    playerRef={playerRef}
                                    onProgress={onProgress}
                                    onPlay={onPlay}
                                    onPause={onPause}
                                    onBuffer={onBuffer}
                                    onSeek={onSeek}
                                    onEnded={onEnded}
                                />
                            ) : (
                                <div style={{
                                    width: '100%', paddingTop: '56.25%', position: 'relative',
                                    background: 'hsl(var(--surface))', borderRadius: 'var(--radius-lg)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '1px solid hsl(var(--border))'
                                }}>
                                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--text-muted))' }}>
                                        <Music size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                                        <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Music Playing</h3>
                                        <p>{hasRemote ? "Select a song to start listening" : "Wait for the host to start playing"}</p>
                                    </div>
                                </div>
                            )}
                            {/* Overlay to block controls for non-remotes */}
                            <div style={{
                                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                zIndex: 10, background: 'transparent',
                                pointerEvents: 'none'
                            }}></div>
                        </div>

                        {isMusicMode && (
                            <div style={{ height: 'auto', minHeight: '300px' }}>
                                <MusicModeUI
                                    currentVideo={currentVideo}
                                    isPlaying={isPlaying}
                                    onPlayPause={() => isPlaying ? onPause() : onPlay()}
                                    onNext={handleNext}
                                    onPrev={handlePrev}
                                    onExit={() => setIsMusicMode(false)}
                                />
                            </div>
                        )}
                    </div>

                    {/* Queue List with Tabs */}
                    <div className="glass-card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: '200px' }}>
                        {/* Queue Tabs Header */}
                        <div style={{ display: 'flex', borderBottom: '1px solid hsl(var(--border))' }}>
                            <button
                                onClick={() => setQueueTab('queue')}
                                style={{
                                    flex: 1,
                                    padding: '1rem',
                                    background: queueTab === 'queue' ? 'hsl(var(--surface))' : 'transparent',
                                    border: 'none',
                                    color: queueTab === 'queue' ? 'white' : 'grey',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    fontWeight: 'bold'
                                }}
                            >
                                <ListMusic size={18} /> Queue
                            </button>
                            <button
                                onClick={() => setQueueTab('playlists')}
                                style={{
                                    flex: 1,
                                    padding: '1rem',
                                    background: queueTab === 'playlists' ? 'hsl(var(--surface))' : 'transparent',
                                    border: 'none',
                                    color: queueTab === 'playlists' ? 'white' : 'grey',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem',
                                    fontWeight: 'bold'
                                }}
                            >
                                <Music size={18} /> Playlists
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {/* QUEUE TAB */}
                            {queueTab === 'queue' && (
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {queue.map((video, i) => {
                                        const isCurrent = currentVideo && currentVideo.id === video.id
                                        return (
                                            <div
                                                key={`${video.id}-${i}`}
                                                onClick={() => hasRemote && playVideo(video)}
                                                style={{
                                                    display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.5rem',
                                                    borderRadius: '8px',
                                                    background: isCurrent ? 'hsla(var(--primary)/0.1)' : 'transparent',
                                                    border: isCurrent ? '1px solid hsl(var(--primary))' : '1px solid transparent',
                                                    cursor: hasRemote ? 'pointer' : 'default',
                                                    opacity: isCurrent ? 1 : 0.7,
                                                    transition: 'background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease'
                                                }}
                                                className="queue-item"
                                            >
                                                {isCurrent && <div style={{ position: 'absolute', left: '1.5rem', color: 'hsl(var(--primary))' }}><Play size={12} fill="currentColor" /></div>}

                                                <div style={{ width: '40px', height: '40px', background: 'black', borderRadius: '4px', overflow: 'hidden', flexShrink: 0, marginLeft: isCurrent ? '1rem' : 0 }}>
                                                    <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <div title={video.title} style={{ fontWeight: '600', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isCurrent ? 'hsl(var(--primary))' : 'inherit' }}>{video.title}</div>
                                                    <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>{video.channel}</div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                    {queue.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>Queue is empty</div>
                                    )}
                                </div>
                            )}

                            {/* PLAYLISTS TAB */}
                            {queueTab === 'playlists' && (
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {/* Info Box */}
                                    <div style={{ background: 'hsla(var(--primary)/0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid hsla(var(--primary)/0.3)', fontSize: '0.85rem', lineHeight: '1.4' }}>
                                        📋 Paste a YouTube or YouTube Music playlist URL below. Note: The playlist must be <strong>public or unlisted</strong> to be imported.
                                    </div>

                                    {/* URL Input Form */}
                                    <form onSubmit={handleLoadPlaylist} style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input
                                            className="input"
                                            placeholder="Playlist URL or ID"
                                            value={playlistUrl}
                                            onChange={e => setPlaylistUrl(e.target.value)}
                                            style={{ flex: 1, padding: '0.5rem' }}
                                            disabled={!hasRemote}
                                        />
                                        <button
                                            type="submit"
                                            className="btn btn-primary"
                                            disabled={loadingPlaylist || !hasRemote}
                                            style={{ padding: '0.5rem 1rem' }}
                                        >
                                            {loadingPlaylist ? '...' : 'Load'}
                                        </button>
                                    </form>

                                    {/* Permission Warning for Guests */}
                                    {!hasRemote && (
                                        <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.7, fontSize: '0.9rem' }}>
                                            Ask the host for remote access to import playlists
                                        </div>
                                    )}

                                    {/* Error Display */}
                                    {playlistError && (
                                        <div style={{ background: 'hsla(0, 100%, 50%, 0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid hsla(0, 100%, 50%, 0.3)', color: '#ff6b6b', fontSize: '0.9rem' }}>
                                            ❌ {playlistError}
                                        </div>
                                    )}

                                    {/* Playlist Preview */}
                                    {playlistData && (
                                        <>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid hsl(var(--border))' }}>
                                                <div>
                                                    <h4 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{playlistData.title}</h4>
                                                    <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>{playlistData.videos.length} songs</p>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => setSelectedSongs(selectedSongs.size === playlistData.videos.length ? new Set() : new Set(playlistData.videos.map(v => v.id)))}
                                                        style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                                                    >
                                                        {selectedSongs.size === playlistData.videos.length ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={handleImportSelected}
                                                        disabled={selectedSongs.size === 0}
                                                        style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                                                    >
                                                        Import {selectedSongs.size > 0 ? `(${selectedSongs.size})` : ''}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Song List with Checkboxes */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {playlistData.videos.map((video) => {
                                                    const isSelected = selectedSongs.has(video.id)
                                                    return (
                                                        <div
                                                            key={video.id}
                                                            onClick={() => toggleSongSelection(video.id)}
                                                            style={{
                                                                display: 'flex',
                                                                gap: '0.75rem',
                                                                alignItems: 'center',
                                                                padding: '0.5rem',
                                                                borderRadius: '8px',
                                                                background: isSelected ? 'hsla(var(--primary)/0.1)' : 'transparent',
                                                                border: isSelected ? '1px solid hsl(var(--primary))' : '1px solid transparent',
                                                                cursor: 'pointer',
                                                                transition: 'background-color 0.2s ease, border-color 0.2s ease'
                                                            }}
                                                        >
                                                            {/* Checkbox */}
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => { }} // Handled by parent div onClick
                                                                style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                                            />

                                                            {/* Thumbnail */}
                                                            <div style={{ width: '40px', height: '40px', background: 'black', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                                                                <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                                            </div>

                                                            {/* Title & Channel */}
                                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                                <div title={video.title} style={{ fontWeight: '600', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                    {video.title}
                                                                </div>
                                                                <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>{video.channel}</div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Split Tabs */}
                <div className="glass-card room-right-col" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0', overflow: 'hidden' }}>

                    {/* Tabs Header */}
                    <div style={{ display: 'flex', borderBottom: '1px solid hsl(var(--border))' }}>
                        <button
                            onClick={() => setActiveTab('chat')}
                            style={{ flex: 1, padding: '1rem', background: activeTab === 'chat' ? 'hsl(var(--surface))' : 'transparent', border: 'none', color: activeTab === 'chat' ? 'white' : 'grey', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 'bold' }}
                        >
                            <MessageCircle size={18} /> Chat
                        </button>
                        <button
                            onClick={() => setActiveTab('users')}
                            style={{ flex: 1, padding: '1rem', background: activeTab === 'users' ? 'hsl(var(--surface))' : 'transparent', border: 'none', color: activeTab === 'users' ? 'white' : 'grey', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 'bold' }}
                        >
                            <Users size={18} /> Users
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

                        {/* CHAT TAB */}
                        {activeTab === 'chat' && (
                            <>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {messages.map(msg => (
                                        <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.75rem', color: 'hsl(var(--primary))' }}>{msg.user.split('@')[0]}</span>
                                            <span style={{ background: 'hsl(var(--surface-hover))', padding: '0.5rem 0.75rem', borderRadius: '0 8px 8px 8px', width: 'fit-content', wordBreak: 'break-word' }}>
                                                {msg.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <form onSubmit={handleSendMessage} style={{ padding: '1rem', borderTop: '1px solid hsl(var(--border))', display: 'flex', gap: '0.5rem' }}>
                                    <input className="input" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type a message..." style={{ padding: '0.5rem' }} />
                                    <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem' }}><Send size={18} /></button>
                                </form>
                            </>
                        )}

                        {/* USERS TAB */}
                        {activeTab === 'users' && (
                            <div style={{ padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                {/* Host Only: Requests */}
                                {isHost && songRequests.length > 0 && (
                                    <div style={{ background: 'hsla(var(--warning)/0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid hsla(var(--warning)/0.3)' }}>
                                        <h4 style={{ marginBottom: '0.5rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'hsl(var(--warning))', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <ShieldAlert size={14} /> Song Requests ({songRequests.length})
                                        </h4>
                                        {songRequests.map(req => (
                                            <div key={req.id} style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'hsl(var(--surface))', borderRadius: '4px', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <div style={{ width: '30px', height: '30px', background: 'black', flexShrink: 0 }}>
                                                    <img src={req.video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.video.title}</div>
                                                    <div style={{ fontSize: '0.7rem', opacity: 0.5 }}>from {req.user.split('@')[0]}</div>
                                                </div>
                                                <button onClick={() => approveRequest(req)} style={{ color: 'limegreen', border: 'none', background: 'none' }} title="Approve"><Check size={18} /></button>
                                                <button onClick={() => denyRequest(req.id)} style={{ color: 'red', border: 'none', background: 'none' }} title="Deny"><X size={18} /></button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div>
                                    <h4 style={{ marginBottom: '0.5rem', fontSize: '0.8rem', textTransform: 'uppercase', opacity: 0.7 }}>Connected Peers</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {[...peers, { peerId: 'me', userEmail: user.email + ' (You)' }].map(p => {
                                            const rawEmail = p.userEmail.replace(' (You)', '')

                                            // Improved Badge Logic
                                            const isThisUserHost = rawEmail === hostEmail || (isHost && rawEmail === user.email)
                                            const isRemote = remoteUsers.has(rawEmail) || isThisUserHost

                                            return (
                                                <div key={p.peerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem', background: 'hsl(var(--surface))', borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'hsl(var(--primary))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                            {rawEmail[0].toUpperCase()}
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <span style={{ fontSize: '0.9rem' }}>{p.userEmail}</span>
                                                            <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                                                                {isThisUserHost ? 'Host' : (isRemote ? 'Remote Access' : 'Guest')}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Host Controls */}
                                                    {isHost && p.peerId !== 'me' && (
                                                        <button
                                                            onClick={() => toggleRemote(rawEmail)}
                                                            className={`btn ${isRemote && !isThisUserHost ? 'btn-primary' : 'btn-ghost'}`}
                                                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem' }}
                                                            disabled={isThisUserHost}
                                                        >
                                                            {isRemote ? 'Revoke' : 'Grant'}
                                                        </button>
                                                    )}
                                                    {isRemote && !isHost && <Shield size={16} color="hsl(var(--primary))" />}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>

                            </div>
                        )}

                    </div>

                </div>

            </div >
        </div>
    )
}
