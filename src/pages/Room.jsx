import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Player from '../components/Player'
import SearchOverlay from '../components/SearchOverlay'
import MusicModeUI from '../components/MusicModeUI'
import Footer from '../components/Footer'
import { getPlaylistItems } from '../services/youtube'

import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { useTrackRoomPresence } from '../hooks/useGlobalPresence'
import { MessageCircle, Users, Send, Search as SearchIcon, ListMusic, Music2, Wifi, WifiOff, Activity, Play, Plus, Check, X, Shield, ShieldAlert, Home, Music, RefreshCw, Trash2, CheckSquare } from 'lucide-react'

export default function Room() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const [room, setRoom] = useState(null)
    const [loading, setLoading] = useState(true)
    const [isAuthorized, setIsAuthorized] = useState(false)
    const [passwordInput, setPasswordInput] = useState('')
    const [passwordError, setPasswordError] = useState('')

    // Player State
    const [url, setUrl] = useState('')
    const [isPlaying, setIsPlaying] = useState(false)
    const [queue, setQueue] = useState([]) // Array of video objects (Persistent Playlist)
    const [currentVideo, setCurrentVideo] = useState(null)
    const [progress, setProgress] = useState(0) // Current playback time in seconds
    const [duration, setDuration] = useState(0) // Total video duration in seconds

    // UI State
    const [showSearch, setShowSearch] = useState(false)
    const [isMusicMode, setIsMusicMode] = useState(() => {
        // Load music mode state from localStorage
        const saved = localStorage.getItem('syncytm_music_mode')
        return saved === 'true'
    })
    const [messages, setMessages] = useState([])
    const [newMessage, setNewMessage] = useState('')
    const [showDebug, setShowDebug] = useState(false)
    const [activeTab, setActiveTab] = useState('chat') // 'chat' | 'users'
    const [queueTab, setQueueTab] = useState('queue') // 'queue' | 'playlists'
    const [mobileTab, setMobileTab] = useState('queue') // 'queue' | 'chat' | 'users'
    const [unreadChatCount, setUnreadChatCount] = useState(0)

    // Queue selection & deletion state
    const [selectedQueueItems, setSelectedQueueItems] = useState(new Set())
    const [isQueueSelectMode, setIsQueueSelectMode] = useState(false)

    // Playlist Import State
    const [playlistUrl, setPlaylistUrl] = useState('')
    const [playlistData, setPlaylistData] = useState(null)
    const [loadingPlaylist, setLoadingPlaylist] = useState(false)
    const [playlistError, setPlaylistError] = useState('')
    const [selectedSongs, setSelectedSongs] = useState(new Set())


    // Remote Control State
    const [remoteUsers, setRemoteUsers] = useState(new Set()) // Set of emails
    const [songRequests, setSongRequests] = useState([]) // Array of { video, user }
    const [songRequestNotif, setSongRequestNotif] = useState('') // Inline toast for guests

    // Precision Sync / Refetch State
    const [isSyncing, setIsSyncing] = useState(false)
    const [syncToast, setSyncToast] = useState('')
    const lastSyncClickRef = useRef(0)
    const syncTimeoutRef = useRef(null)
    const clientSentAtRef = useRef(0)

    const playerRef = useRef(null)
    // Rate-limit map: senderEmail -> last timestamp of request-sync (prevent DoS)
    const requestSyncRateLimitRef = useRef(new Map())
    const isBlockingUpdates = useRef(false) // Strict Lock: Ignore outgoing events when true
    const isSyncingRef = useRef(false) // Keep sync state accessible inside callbacks
    isSyncingRef.current = isSyncing

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
    // Ref to hold the host's email for grant-remote sender validation
    const hostEmailRef = useRef(null)
    // Debounce timer ref for DB queue writes
    const dbQueueDebounceRef = useRef(null)

    useEffect(() => {
        stateRef.current = { url, isPlaying, queue, currentVideo }
        queueRef.current = queue
        remoteUsersRef.current = remoteUsers
        isHostRef.current = isHost // Derived from user/room
        // Derive host email from room data whenever room changes
        if (room?.host_id) {
            // host email is tracked via the peers list for the host user;
            // we store own email when we ARE the host, otherwise we derive from
            // the presence data. For validation purposes, we only need to know
            // the host's user id (room.host_id), which is available in room state.
            // We keep this ref updated for use inside onData closure.
            hostEmailRef.current = room.host_email || null
        }
    }, [url, isPlaying, queue, currentVideo, remoteUsers, isHost, room])

    // Callback for incoming WebRTC/Realtime data
    const onData = React.useCallback((data, senderEmail, senderName, senderId) => {
        console.log('RX from', senderEmail, ':', data.type)

        // --- Security / Authorization Gate ---
        // If I am the Host, I should only accept control commands from Authorized Remote Users
        const controlTypes = ['play', 'pause', 'seek', 'play-video', 'queue-add', 'queue-add-batch', 'queue-remove', 'queue-remove-batch', 'queue-clear', 'sync-state']
        if (isHostRef.current && controlTypes.includes(data.type)) {
            const isAuthorizedSender = remoteUsersRef.current.has(senderEmail) || (senderName && remoteUsersRef.current.has(senderName))
            if (!isAuthorizedSender) {
                console.warn(`Host ignored unauthorized '${data.type}' from ${senderEmail} (${senderName})`)
                return
            }
        }
        // -------------------------------------

        if (data.type === 'chat') {
            setMessages(prev => [...prev, { id: Date.now(), user: senderName || senderEmail, text: data.payload }])
            setUnreadChatCount(prev => prev + 1)
        }

        if (data.type === 'sync-state') {
            // Extra safety: Host never hydrates from peers
            if (isHostRef.current) return

            console.log('HYDRATING STATE', data.state)
            const { url: remoteUrl, isPlaying: remoteIsPlaying, queue: remoteQueue, currentVideo: remoteCurrentVideo, time } = data.state

            isBlockingUpdates.current = true // START HYDRATION LOCK

            if (remoteQueue) setQueue(remoteQueue)
            if (remoteCurrentVideo) setCurrentVideo(remoteCurrentVideo)
            if (remoteUrl) setUrl(remoteUrl)

            setIsPlaying(remoteIsPlaying)

            // Precision latency calculation:
            // Calculate delay between when client sent request and when state is received
            const sentAt = data.clientSentAt || clientSentAtRef.current
            let compensatedTime = typeof time === 'number' ? time : 0
            let rttMs = null

            if (sentAt) {
                rttMs = Math.max(0, Date.now() - sentAt)
                const oneWayDelaySec = (rttMs / 2) / 1000
                if (remoteIsPlaying) {
                    compensatedTime += oneWayDelaySec
                }
                console.log(`[Sync Precision] RTT: ${rttMs}ms, One-Way delay: ${(oneWayDelaySec * 1000).toFixed(1)}ms. Raw: ${time?.toFixed(2)}s -> Compensated: ${compensatedTime.toFixed(2)}s`)
                clientSentAtRef.current = 0 // consumed
            } else if (data.hostSentAt && remoteIsPlaying) {
                const transitSec = Math.max(0, (Date.now() - data.hostSentAt) / 1000)
                if (transitSec < 5) {
                    compensatedTime += transitSec
                }
            }

            // If client is ALREADY playing the exact same video, seek immediately!
            const isSameVideo = (stateRef.current.url === remoteUrl || (stateRef.current.currentVideo?.id && stateRef.current.currentVideo?.id === remoteCurrentVideo?.id)) && playerRef.current

            if (isSameVideo && compensatedTime > 0) {
                playerRef.current.seekTo(compensatedTime)
                setProgress(compensatedTime)
                setTimeout(() => {
                    isBlockingUpdates.current = false
                    console.log('HYDRATION UNLOCK (immediate seek)')
                }, 1200)
            } else if (compensatedTime > 0) {
                // Video is new/mounting: wait for player to mount, but compensate for the wait time
                const receiveTime = performance.now()
                setTimeout(() => {
                    if (playerRef.current) {
                        const elapsed = (performance.now() - receiveTime) / 1000
                        const finalSeekTime = compensatedTime + (remoteIsPlaying ? elapsed : 0)
                        playerRef.current.seekTo(finalSeekTime)
                        setProgress(finalSeekTime)
                    }
                    setTimeout(() => {
                        isBlockingUpdates.current = false
                        console.log('HYDRATION UNLOCK (delayed seek)')
                    }, 2000)
                }, 1000)
            } else {
                setTimeout(() => {
                    isBlockingUpdates.current = false
                    console.log('HYDRATION UNLOCK (no seek)')
                }, 1500)
            }

            // Stop sync animation and show latency feedback
            if (syncTimeoutRef.current) {
                clearTimeout(syncTimeoutRef.current)
                syncTimeoutRef.current = null
            }
            setIsSyncing(false)
            if (rttMs !== null) {
                setSyncToast(`Synced with host (${rttMs}ms RTT)`)
                setTimeout(() => setSyncToast(''), 2500)
            }
        }

        // --- Permissions Events ---
        if (data.type === 'request-song') {
            // Only Host receives/handles this (UI wise)
            if (isHostRef.current) {
                setSongRequests(prev => [...prev, { video: data.video, user: senderName || senderEmail, id: Date.now() }])
                console.log('Song Request Received:', data.video.title)
            }
        }

        if (data.type === 'grant-remote') {
            // SECURITY: Only accept grant-remote if sender matches the room's host_id
            if (senderId && room?.host_id && senderId !== room.host_id) {
                console.warn(`Security: Rejected grant-remote from non-host sender ${senderEmail} (${senderId})`)
                return
            }

            const { targetEmail, value } = data
            setRemoteUsers(prev => {
                const newSet = new Set(prev)
                if (value) newSet.add(targetEmail)
                else newSet.delete(targetEmail)
                return newSet
            })
        }

        if (data.type === 'sync-remotes') {
            // SECURITY: Only accept sync-remotes if sender matches room's host_id
            if (senderId && room?.host_id && senderId !== room.host_id) {
                console.warn(`Security: Rejected sync-remotes from non-host: ${senderEmail}`)
                return
            }
            setRemoteUsers(new Set(data.remotes))
        }
        // --------------------------

        // --- Request/Reply Sync Protocol ---
        if (data.type === 'request-time') {
            if (playerRef.current && stateRef.current.isPlaying) {
                const currentTime = playerRef.current.getCurrentTime()
                broadcastDataRef.current({ type: 'time-update', time: currentTime })
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

        // Periodic drift correction: host broadcasts time every 8s.
        // Peers only seek if drift > 2s, to avoid disrupting normal playback.
        if (data.type === 'time-ping') {
            if (isHostRef.current) return // Host sent this
            if (senderId && room?.host_id && senderId !== room.host_id) return // Must be from host
            if (playerRef.current && stateRef.current.isPlaying) {
                const myTime = playerRef.current.getCurrentTime()
                const transitDelay = data.hostSentAt ? Math.max(0, (Date.now() - data.hostSentAt) / 1000) : 0
                const targetHostTime = data.time + transitDelay
                const drift = Math.abs(myTime - targetHostTime)
                if (drift > 2.0) {
                    console.log(`Drift correction from host: ${drift.toFixed(2)}s (transit: ${(transitDelay * 1000).toFixed(0)}ms) → seeking to ${targetHostTime}`)
                    isBlockingUpdates.current = true
                    playerRef.current.seekTo(targetHostTime)
                    setTimeout(() => isBlockingUpdates.current = false, 1500)
                }
            }
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

            // Host persists play state to DB when triggered by remote user
            if (isHostRef.current) {
                const time = typeof data.time === 'number' ? data.time : (playerRef.current?.getCurrentTime() || 0)
                supabase.from('rooms').update({
                    is_playing: true,
                    progress: time,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
        }

        if (data.type === 'pause') {
            if (isBlockingUpdates.current) return
            isBlockingUpdates.current = true
            setTimeout(() => isBlockingUpdates.current = false, 1000)

            setIsPlaying(false)

            // Host persists pause state to DB when triggered by remote user
            if (isHostRef.current) {
                const time = playerRef.current?.getCurrentTime() || 0
                supabase.from('rooms').update({
                    is_playing: false,
                    progress: time,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
        }

        if (data.type === 'seek') {
            console.log('RX: SEEK command', data.time)
            isBlockingUpdates.current = true
            seekingRef.current = true
            isBufferingRef.current = true

            setTimeout(() => {
                isBlockingUpdates.current = false
                seekingRef.current = false
                isBufferingRef.current = false
                console.log('Seek lock released')
            }, 1500)

            if (playerRef.current) {
                playerRef.current.seekTo(data.time)
            } else {
                console.warn('No playerRef available for seek')
            }

            // Host persists seek position to DB when triggered by remote user
            if (isHostRef.current) {
                supabase.from('rooms').update({
                    progress: data.time,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
        }

        if (data.type === 'play-video') {
            isBlockingUpdates.current = true
            setTimeout(() => isBlockingUpdates.current = false, 4000)

            setCurrentVideo(data.video)
            setUrl(`https://www.youtube.com/watch?v=${data.video.id}`)
            setIsPlaying(true)

            // Host persists current_video to DB when triggered by remote user
            if (isHostRef.current) {
                supabase.from('rooms').update({
                    current_video: data.video,
                    is_playing: true,
                    progress: 0,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
        }

        if (data.type === 'queue-add') {
            let updatedQueue = null
            setQueue(prev => {
                // Deduplicate by queueItemId if present, else fall back to video id
                const key = data.video.queueItemId || data.video.id
                const alreadyExists = prev.some(v => (v.queueItemId || v.id) === key)
                if (alreadyExists) return prev
                updatedQueue = [...prev, data.video]
                return updatedQueue
            })

            // Host: persist the updated queue to DB so it survives a page refresh
            if (isHostRef.current) {
                setTimeout(() => {
                    const toPersist = updatedQueue || (
                        queueRef.current.some(v => (v.queueItemId || v.id) === (data.video.queueItemId || data.video.id))
                            ? queueRef.current
                            : [...queueRef.current, data.video]
                    )
                    supabase.from('rooms').update({ queue: toPersist }).eq('id', id)
                        .then(() => console.log('DB queue updated after remote queue-add'))
                }, 200)
            }
        }

        // Batch queue add for playlist imports — avoids broadcasting 50 individual events
        if (data.type === 'queue-add-batch') {
            let updatedQueue = null
            setQueue(prev => {
                const existingKeys = new Set(prev.map(v => v.queueItemId || v.id))
                const newItems = (data.videos || []).filter(v => {
                    const key = v.queueItemId || v.id
                    return !existingKeys.has(key)
                })
                if (newItems.length === 0) return prev
                updatedQueue = [...prev, ...newItems]
                return updatedQueue
            })

            // Host: persist updated queue to DB
            if (isHostRef.current) {
                setTimeout(() => {
                    const toPersist = updatedQueue || queueRef.current
                    supabase.from('rooms').update({ queue: toPersist }).eq('id', id)
                        .then(() => console.log('DB queue updated after queue-add-batch'))
                }, 200)
            }
        }

        // Batch queue remove for deleting selected items
        if (data.type === 'queue-remove-batch' || data.type === 'queue-remove') {
            const idsToRemove = new Set(data.itemIds || [data.itemId])
            let updatedQueue = null
            setQueue(prev => {
                updatedQueue = prev.filter((v, idx) => {
                    const key = v.queueItemId || `${v.id}-${idx}`
                    return !idsToRemove.has(key) && !idsToRemove.has(v.id)
                })
                return updatedQueue
            })

            if (isHostRef.current) {
                setTimeout(() => {
                    const toPersist = updatedQueue || queueRef.current
                    supabase.from('rooms').update({ queue: toPersist }).eq('id', id)
                        .then(() => console.log('DB queue updated after remote delete'))
                }, 200)
            }
        }

        if (data.type === 'queue-clear') {
            setQueue([])
            if (isHostRef.current) {
                supabase.from('rooms').update({ queue: [] }).eq('id', id).then()
            }
        }

        if (data.type === 'request-sync') {
            console.log('RX: Request Sync from', senderEmail, 'clientSentAt:', data.clientSentAt)
            if (isHostRef.current) {
                // Rate-limit: max 1 request-sync per sender per 2.5 seconds (prevents spam DoS)
                const now = Date.now()
                const lastTime = requestSyncRateLimitRef.current.get(senderEmail) || 0
                if (now - lastTime < 2500) {
                    console.warn(`Rate-limited request-sync from ${senderEmail}`)
                    return
                }
                requestSyncRateLimitRef.current.set(senderEmail, now)

                console.log('Sending Sync State payload...')
                const currentTime = playerRef.current ? playerRef.current.getCurrentTime() : 0
                const currentState = {
                    type: 'sync-state',
                    _fromHost: true,
                    clientSentAt: data.clientSentAt,
                    hostSentAt: Date.now(),
                    requesterId: data.requesterId || senderId,
                    state: {
                        ...stateRef.current,
                        time: currentTime
                    }
                }
                broadcastDataRef.current(currentState)
                broadcastDataRef.current({ type: 'sync-remotes', remotes: Array.from(remoteUsersRef.current), _fromHost: true })

                const videoData = stateRef.current.currentVideo
                if (videoData) {
                    supabase.from('rooms').update({
                        current_video: videoData,
                        is_playing: stateRef.current.isPlaying,
                        progress: currentTime,
                        last_updated_at: new Date()
                    }).eq('id', id).then(() => console.log('DB State Repaired'))
                }
            }
        }
    }, [id, room?.host_id]) // Re-bind if ID or host_id changes


    const onPeerConnect = React.useCallback((peerId, email, sendToPeerFunc) => {
        console.log('New peer connected:', email)

        // Only Host (or Remote) should send state to hydrate the new peer.
        // Guests should NEVER send state on connect.
        if (isHostRef.current) {
            console.log('SYNC: I am Host. Sending playback state to:', email)
            // Send Playback State (Unicast)
            if (stateRef.current.currentVideo || stateRef.current.queue.length > 0) {
                const currentState = {
                    type: 'sync-state',
                    state: {
                        ...stateRef.current,
                        time: playerRef.current ? playerRef.current.getCurrentTime() : 0
                    }
                }
                sendToPeerFunc(peerId, currentState)
            }
            // Send Remote Permissions List (Host only)
            sendToPeerFunc(peerId, { type: 'sync-remotes', remotes: Array.from(remoteUsersRef.current), _fromHost: true })
        } else {
            // If I am a Guest and have no video, request sync from the new peer
            if (!stateRef.current.currentVideo) {
                console.log('SYNC: I am Guest (idle). Requesting sync from:', email)
                sendToPeerFunc(peerId, { type: 'request-sync' })
            }
        }
    }, [])

    // Need refs to hook methods to call them from inside callbacks without dependency loops
    const broadcastDataRef = useRef(() => { })
    const sendToPeerRef = useRef(() => { })

    const { peers, broadcastData, sendToPeer } = useRealtimeSync(isAuthorized ? id : null, user, onData, onPeerConnect)

    useEffect(() => {
        broadcastDataRef.current = broadcastData
        sendToPeerRef.current = sendToPeer
    }, [broadcastData, sendToPeer])

    useEffect(() => {
        fetchRoom()
    }, [id])

    // Update Active Listeners Count (Host Only)
    // Track global presence for Home page counts
    useTrackRoomPresence(id, user?.id)

    // Update Active Listeners Count (Host Only) - LEGACY DB UPDATE REMOVED/Omitted
    // We now rely on Realtime Presence for the Home page count.
    /*
    useEffect(() => {
        if (isHost && room) {
            // Count = Peers + Host (1)
            const count = peers.length + 1
            const updateListeners = async () => {
                await supabase.from('rooms').update({ active_listeners: count }).eq('id', id)
            }
            updateListeners()
        }
    }, [peers.length, isHost, room?.id])
    */

    const fetchRoom = async () => {
        const { data, error } = await supabase.from('rooms').select('*').eq('id', id).single()
        if (error) {
            navigate('/')
        } else {
            setRoom(data)
            if (Array.isArray(data.queue)) {
                setQueue(data.queue)
            }

            // Hydrate persisted remote_users from DB
            if (Array.isArray(data.remote_users) && data.remote_users.length > 0) {
                setRemoteUsers(new Set(data.remote_users))
            }

            // Hydrate Playback State
            if (data.current_video) {
                setCurrentVideo(data.current_video)
                setUrl(`https://www.youtube.com/watch?v=${data.current_video.id}`)
                setIsPlaying(data.is_playing)

                // Calculate drift if playing
                if (data.is_playing && data.last_updated_at) {
                    const lastUpdate = new Date(data.last_updated_at).getTime()
                    const now = Date.now()
                    const elapsed = (now - lastUpdate) / 1000
                    if (elapsed >= 0 && elapsed < 3600) {
                        const estimatedTime = (data.progress || 0) + elapsed
                        setTimeout(() => {
                            if (playerRef.current) playerRef.current.seekTo(estimatedTime)
                        }, 1000)
                    } else if (data.progress > 0) {
                        setTimeout(() => {
                            if (playerRef.current) playerRef.current.seekTo(data.progress)
                        }, 1000)
                    }
                } else if (data.progress > 0) {
                    setTimeout(() => {
                        if (playerRef.current) playerRef.current.seekTo(data.progress)
                    }, 1000)
                }
            }

            if (!data.is_private || data.host_id === user.id) {
                setIsAuthorized(true)
            }
        }
        setLoading(false)
    }

    // Unified, delay-compensated Force Sync handler with anti-spam protection
    const handleForceSync = async () => {
        const now = Date.now()
        // Anti-spam protection: 2s cooldown & prevent re-entry while isSyncing
        if (isSyncing || (now - lastSyncClickRef.current < 2000)) {
            console.log('Force Sync: Cooldown active or already syncing')
            return
        }
        lastSyncClickRef.current = now
        setIsSyncing(true)

        if (isHost) {
            console.log('HOST Force Sync: Re-syncing master state with DB and peers')
            try {
                // 1. Refresh room record from DB
                await fetchRoom()
                // 2. Sample current master player time
                const currentTime = playerRef.current ? playerRef.current.getCurrentTime() : 0
                // 3. Broadcast authoritative state to all peers with host timestamp
                broadcastData({
                    type: 'sync-state',
                    _fromHost: true,
                    hostSentAt: Date.now(),
                    state: {
                        ...stateRef.current,
                        time: currentTime
                    }
                })
                broadcastData({
                    type: 'sync-remotes',
                    remotes: Array.from(remoteUsersRef.current),
                    _fromHost: true
                })
                // 4. Update Supabase progress
                if (stateRef.current.currentVideo) {
                    supabase.from('rooms').update({
                        is_playing: stateRef.current.isPlaying,
                        progress: currentTime,
                        last_updated_at: new Date()
                    }).eq('id', id).then()
                }
                setSyncToast('Broadcast master sync to peers')
            } catch (err) {
                console.error('Error during host sync:', err)
                setSyncToast('Sync error')
            } finally {
                setTimeout(() => {
                    setIsSyncing(false)
                    setTimeout(() => setSyncToast(''), 2500)
                }, 800)
            }
        } else {
            console.log('PEER Force Sync: Sending timestamped sync request')
            const clientSentAt = Date.now()
            clientSentAtRef.current = clientSentAt

            broadcastData({
                type: 'request-sync',
                clientSentAt,
                requesterId: user?.id
            })

            // Hardened fallback timeout (3.5s):
            // If the host is unresponsive or disconnected, recover state directly from Supabase DB!
            if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
            syncTimeoutRef.current = setTimeout(async () => {
                console.warn('Host sync timeout — recovering state directly from DB')
                try {
                    await fetchRoom()
                    setSyncToast('Synced via cloud database')
                } catch {
                    setSyncToast('Sync timed out')
                }
                setIsSyncing(false)
                setTimeout(() => setSyncToast(''), 2500)
            }, 3500)
        }
    }

    // Helper to update Queue State everywhere (Local + DB + Peers)
    const handleQueueUpdate = (newQueue, shouldBroadcast = true) => {
        // Assign unique queueItemIds to any new items that don't have one yet
        const queueWithIds = newQueue.map(v => v.queueItemId ? v : { ...v, queueItemId: `${v.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` })
        setQueue(queueWithIds)

        // Broadcast change to peers
        if (shouldBroadcast) {
            const prevLen = queueRef.current.length
            const addedItems = queueWithIds.slice(prevLen)
            if (addedItems.length === 1) {
                // Single add: targeted event
                broadcastData({ type: 'queue-add', video: addedItems[0] })
            } else if (addedItems.length > 1) {
                // Batch add (playlist import): send all new items at once
                broadcastData({ type: 'queue-add-batch', videos: addedItems })
            }
        }

        // Persist to DB (Host Only) — debounced 500ms to avoid hammering on rapid updates
        if (isHost) {
            if (dbQueueDebounceRef.current) clearTimeout(dbQueueDebounceRef.current)
            dbQueueDebounceRef.current = setTimeout(() => {
                supabase.from('rooms').update({ queue: queueWithIds }).eq('id', id)
                    .then(() => console.log('DB queue persisted (debounced)'))
                dbQueueDebounceRef.current = null
            }, 500)
        }
    }

    // Helper to delete selected or specific items from the Queue
    const handleDeleteQueueItems = (itemKeysToDelete) => {
        if (!hasRemote) return
        const keysSet = itemKeysToDelete instanceof Set ? itemKeysToDelete : new Set(itemKeysToDelete)
        if (keysSet.size === 0) return

        const newQueue = queue.filter((v, idx) => {
            const key = v.queueItemId || `${v.id}-${idx}`
            return !keysSet.has(key) && !keysSet.has(v.id)
        })

        setQueue(newQueue)
        setSelectedQueueItems(new Set())
        setIsQueueSelectMode(false)

        broadcastData({
            type: 'queue-remove-batch',
            itemIds: Array.from(keysSet)
        })

        if (isHost) {
            if (dbQueueDebounceRef.current) clearTimeout(dbQueueDebounceRef.current)
            dbQueueDebounceRef.current = setTimeout(() => {
                supabase.from('rooms').update({ queue: newQueue }).eq('id', id)
                    .then(() => console.log('DB queue updated after delete'))
                dbQueueDebounceRef.current = null
            }, 300)
        }
    }

    const handleDeleteSingleQueueItem = (video, index) => {
        if (!hasRemote) return
        const key = video.queueItemId || `${video.id}-${index}`
        handleDeleteQueueItems(new Set([key]))
    }

    const handleClearQueue = () => {
        if (!hasRemote) return
        if (queue.length === 0) return
        if (window.confirm('Are you sure you want to clear the entire queue?')) {
            setQueue([])
            setSelectedQueueItems(new Set())
            setIsQueueSelectMode(false)

            broadcastData({ type: 'queue-clear' })

            if (isHost) {
                supabase.from('rooms').update({ queue: [] }).eq('id', id).then()
            }
        }
    }

    const handlePasswordSubmit = (e) => {
        e.preventDefault()
        if (room.password_hash === passwordInput) {
            setPasswordError('')
            setIsAuthorized(true)
        } else {
            setPasswordError('Incorrect password. Please try again.')
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

        // PERSISTENCE (Host Only)
        if (isHost) {
            supabase.from('rooms').update({
                current_video: video,
                is_playing: true,
                progress: 0,
                last_updated_at: new Date()
            }).eq('id', id).then()
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
            // If guest: Request song — use inline notification instead of blocking alert
            broadcastData({ type: 'request-song', video })
            setSongRequestNotif('Song request sent to host!')
            setTimeout(() => setSongRequestNotif(''), 3000)
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

        const newRemoteArray = Array.from(newSet)

        // Broadcast with _fromHost flag so peers trust and apply it
        broadcastData({ type: 'grant-remote', targetEmail, value: !isGranted, _fromHost: true })

        // Persist to DB so grants survive host page refresh
        supabase.from('rooms').update({ remote_users: newRemoteArray }).eq('id', id)
            .then(() => console.log('remote_users persisted to DB'))
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
        setMessages(prev => [...prev, { id: user?.email ? Date.now() : Date.now() + 1, user: user?.user_metadata?.username || user?.email || 'Guest', text: newMessage }])
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

    const handleDeleteFromPlaylistPreview = (videoId) => {
        setPlaylistData(prev => {
            if (!prev) return null
            return {
                ...prev,
                videos: prev.videos.filter(v => v.id !== videoId)
            }
        })
        setSelectedSongs(prev => {
            const next = new Set(prev)
            next.delete(videoId)
            return next
        })
    }

    const handleDeleteSelectedFromPlaylistPreview = () => {
        if (!playlistData || selectedSongs.size === 0) return
        setPlaylistData(prev => {
            if (!prev) return null
            return {
                ...prev,
                videos: prev.videos.filter(v => !selectedSongs.has(v.id))
            }
        })
        setSelectedSongs(new Set())
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

        // Update progress state for Music UI
        setProgress(currentTime)

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

    const onDuration = (duration) => {
        setDuration(duration)
    }

    const onBuffer = () => {
        isBufferingRef.current = true
    }

    // Critical fix: reset buffering flag when buffer clears so future pause events work correctly
    const onBufferEnd = () => {
        isBufferingRef.current = false
    }

    // Periodic drift correction — host broadcasts current time every 8s.
    // Peers self-correct if drift > 2s (handled in onData 'time-ping' handler).
    // This achieves near-realtime sync without interrupting normal playback.
    useEffect(() => {
        if (!isHost || !isAuthorized) return

        const interval = setInterval(() => {
            if (stateRef.current.isPlaying && playerRef.current) {
                const currentTime = playerRef.current.getCurrentTime()
                // Include hostSentAt so peers can compensate for network transit delay
                broadcastDataRef.current({
                    type: 'time-ping',
                    time: currentTime,
                    hostSentAt: Date.now()
                })
            }
        }, 8000)

        return () => clearInterval(interval)
    }, [isHost, isAuthorized])

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
        const time = playerRef.current?.getCurrentTime() || 0
        broadcastData({ type: 'play', time })

        if (isHost) {
            supabase.from('rooms').update({
                is_playing: true,
                progress: time,
                last_updated_at: new Date()
            }).eq('id', id).then()
        }
    }

    const handleTogglePlay = () => {
        if (!hasRemote) return

        if (isPlaying) {
            // User Explicit Pause - Bypass Debounce for UI responsiveness
            console.log('User Toggled Pause')
            if (pauseDebounceRef.current) clearTimeout(pauseDebounceRef.current)
            pauseDebounceRef.current = null

            setIsPlaying(false)
            broadcastData({ type: 'pause' })

            if (isHost) {
                const time = playerRef.current?.getCurrentTime() || 0
                supabase.from('rooms').update({
                    is_playing: false,
                    progress: time,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
        } else {
            // User Explicit Play
            console.log('User Toggled Play')
            onPlay()
        }
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

        // Prevent redundant pause logic if state is already paused (e.g. via TogglePlay)
        if (!isPlaying) return

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

            if (isHost) {
                const time = playerRef.current?.getCurrentTime() || 0
                supabase.from('rooms').update({
                    is_playing: false,
                    progress: time,
                    last_updated_at: new Date()
                }).eq('id', id).then()
            }
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

        // Critical Fix: Perform the seek locally for the sender!
        if (playerRef.current) {
            playerRef.current.seekTo(seconds)
            setProgress(seconds) // Optimistic UI update
        }

        if (isHost) {
            supabase.from('rooms').update({
                progress: seconds,
                last_updated_at: new Date()
            }).eq('id', id).then()
        }
    }

    const onEnded = () => {
        if (isHost) {
            handleNext()
        }
    }

    if (loading) return <div className="container" style={{ paddingTop: '4rem', textAlign: 'center' }}>Loading Room...</div>

    if (!isAuthorized) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', minHeight: '100dvh', padding: '1rem', boxSizing: 'border-box' }}>
                <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '400px', padding: '1.5rem', boxSizing: 'border-box' }}>
                    <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', fontSize: '1.5rem' }}>Private Room</h2>
                    <form onSubmit={handlePasswordSubmit}>
                        <input className="input" type="password" placeholder="Enter Room Password" value={passwordInput} onChange={e => { setPasswordInput(e.target.value); setPasswordError('') }} autoFocus />
                        {passwordError && (
                            <p style={{ color: '#ff6b6b', fontSize: '0.875rem', marginTop: '0.5rem' }}>{passwordError}</p>
                        )}
                        <button type="submit" className="btn btn-primary" style={{ marginTop: '1rem', width: '100%' }}>Enter Room</button>
                    </form>
                </div>
            </div>
        )
    }

    return (
        <div style={{
            minHeight: '100vh',
            minHeight: '100dvh',
            width: '100%',
            background: 'radial-gradient(circle at top right, hsl(var(--primary) / 0.35), transparent 50%), radial-gradient(circle at bottom left, hsl(var(--secondary) / 0.1), transparent 50%)',
            overflowX: 'hidden',
            display: 'flex', flexDirection: 'column'
        }}>
            <div className="container room-layout" style={{
                padding: 'clamp(0.5rem, 2vw, 1.25rem)',
                flex: 1,
                maxWidth: '100%',
                boxSizing: 'border-box'
            }}>
                <style>{`
                .room-layout {
                    display: grid;
                    grid-template-columns: 1fr 340px;
                    align-items: start;
                    gap: 1.5rem;
                    width: 100%;
                    box-sizing: border-box;
                }
                .room-mobile-tabs {
                    display: none !important;
                }
                .room-queue-card {
                    flex: 1;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    min-height: 550px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .room-right-col {
                    display: flex;
                    flex-direction: column;
                    height: calc(100vh - 4rem);
                    padding: 0;
                    overflow: hidden;
                    position: sticky;
                    top: 2rem;
                    width: 100%;
                    box-sizing: border-box;
                }
                
                @media (max-width: 900px) {
                    .room-layout {
                        display: flex !important;
                        flex-direction: column !important;
                        align-items: stretch !important;
                        height: auto !important;
                        overflow-y: visible !important;
                        gap: 0.85rem !important;
                        padding: 0.5rem 0.5rem 1.5rem 0.5rem !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    .room-layout > * {
                        width: 100% !important;
                        max-width: 100% !important;
                        min-width: 0 !important;
                        box-sizing: border-box !important;
                    }
                    .room-mobile-tabs {
                        display: flex !important;
                        gap: 0.35rem;
                        background: hsla(var(--surface)/0.9);
                        padding: 0.25rem;
                        border-radius: var(--radius-md);
                        border: 1px solid hsl(var(--border));
                        width: 100% !important;
                        max-width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    .room-mobile-tab-btn {
                        flex: 1 1 0 !important;
                        min-width: 0 !important;
                        padding: 0.5rem 0.2rem !important;
                        min-height: 38px !important;
                        font-size: 0.8rem !important;
                        border-radius: var(--radius-sm) !important;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 0.25rem;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .room-mobile-tab-btn span {
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .tab-badge {
                        background: hsl(var(--primary));
                        color: white;
                        font-size: 0.65rem;
                        padding: 0.1rem 0.35rem;
                        border-radius: var(--radius-full);
                        line-height: 1;
                        flex-shrink: 0;
                    }
                    .tab-badge-warning {
                        background: #f59e0b;
                        color: black;
                        font-size: 0.65rem;
                        font-weight: bold;
                        padding: 0.1rem 0.35rem;
                        border-radius: var(--radius-full);
                        line-height: 1;
                        flex-shrink: 0;
                    }
                    .room-queue-card {
                        min-height: 380px !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    .room-right-col {
                        height: 480px !important;
                        position: static !important;
                        top: auto !important;
                        width: 100% !important;
                        max-width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    .mobile-hidden-section {
                        display: none !important;
                    }
                    .mobile-hide-text span {
                        display: none;
                    }
                    .btn-mobile-compact {
                        padding: 0.35rem !important;
                        min-height: 36px !important;
                        width: 36px !important;
                        flex-shrink: 0 !important;
                        justify-content: center !important;
                    }
                    .room-header {
                        flex-wrap: wrap;
                        gap: 0.5rem !important;
                    }
                    .room-header h2 {
                        font-size: 1.15rem !important;
                    }
                }
            `}</style>

                {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} onAddParams={handleVideoAction} isRequest={!hasRemote} />}

                {/* Song request notification toast */}
                {songRequestNotif && (
                    <div style={{
                        position: 'fixed', top: '1.5rem', left: '50%', transform: 'translateX(-50%)',
                        zIndex: 2000, background: 'hsl(var(--primary))', color: 'white',
                        padding: '0.75rem 1.25rem', borderRadius: '8px', fontWeight: '600',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)', pointerEvents: 'none',
                        maxWidth: 'calc(100% - 2rem)', boxSizing: 'border-box', textAlign: 'center'
                    }}>
                        {songRequestNotif}
                    </div>
                )}

                {/* Sync status toast (precision feedback) */}
                {(isSyncing || syncToast) && (
                    <div style={{
                        position: 'fixed', top: songRequestNotif ? '4.5rem' : '1.5rem', left: '50%', transform: 'translateX(-50%)',
                        zIndex: 1999,
                        background: isSyncing ? 'hsla(var(--surface)/0.95)' : 'hsla(140,60%,20%,0.95)',
                        border: `1px solid ${isSyncing ? 'hsl(var(--border))' : 'hsl(140,60%,40%)'}`,
                        color: 'white', padding: '0.55rem 1rem', borderRadius: '8px',
                        fontWeight: '500', fontSize: '0.88rem',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.4)', pointerEvents: 'none',
                        maxWidth: 'calc(100% - 2rem)', boxSizing: 'border-box',
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        backdropFilter: 'blur(8px)'
                    }}>
                        {isSyncing && (
                            <RefreshCw size={14} className="spin-animation" style={{ flexShrink: 0 }} />
                        )}
                        {isSyncing ? (isHost ? 'Syncing master state…' : 'Requesting sync from host…') : syncToast}
                    </div>
                )}

                {/* Network Debug */}
                {showDebug && (
                    <div style={{ position: 'fixed', bottom: '1rem', right: '1rem', left: 'auto', maxWidth: 'calc(100% - 2rem)', width: '300px', background: 'rgba(0,0,0,0.92)', padding: '1rem', borderRadius: '8px', zIndex: 9999, border: '1px solid #333', color: '#0f0', fontFamily: 'monospace', fontSize: '0.8rem', boxSizing: 'border-box' }}>
                        <button onClick={() => setShowDebug(false)} style={{ color: 'white', marginBottom: '0.5rem' }}>Close</button>
                        <pre style={{ overflowX: 'auto' }}>{JSON.stringify({ peers: peers.length, remote: hasRemote }, null, 2)}</pre>
                    </div>
                )}

                {/* Left Column - Natural Height */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0, minWidth: 0, flex: 1, width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>
                    <header className="room-header" style={{ marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <h2 style={{ fontSize: 'clamp(1.15rem, 3.5vw, 1.5rem)', marginBottom: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room?.name}</h2>
                            <p className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem' }} onClick={() => setShowDebug(!showDebug)}>
                                {peers.length > 0 ? <Wifi size={14} color="limegreen" /> : <WifiOff size={14} color="red" />}
                                <span title="Click for Network Details">
                                    <span>{peers.length} {peers.length === 1 ? 'peer' : 'peers'}</span>
                                </span>
                            </p>
                        </div>

                        <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0, alignItems: 'center' }}>
                            <button
                                className="btn btn-ghost btn-mobile-compact"
                                style={{
                                    padding: '0.4rem',
                                    minHeight: '36px',
                                    opacity: isSyncing ? 0.6 : 1,
                                    cursor: isSyncing ? 'not-allowed' : 'pointer',
                                    transition: 'opacity 0.2s ease'
                                }}
                                onClick={handleForceSync}
                                disabled={isSyncing}
                                title={isSyncing ? 'Syncing...' : 'Force Sync'}
                            >
                                <RefreshCw size={18} className={isSyncing ? 'spin-animation' : ''} />
                            </button>
                            <button className="btn btn-ghost btn-mobile-compact" style={{ padding: '0.4rem', minHeight: '36px' }} onClick={() => navigate('/')} title="Go Home">
                                <Home size={18} />
                            </button>

                            <button className="btn btn-ghost btn-mobile-compact" style={{ padding: '0.4rem', minHeight: '36px' }} onClick={() => setShowDebug(!showDebug)} title="Network Debug">
                                <Activity size={18} />
                            </button>

                            <button className={`btn ${isMusicMode ? 'btn-primary' : 'btn-ghost'} btn-mobile-compact mobile-hide-text`} style={{ padding: '0.4rem 0.75rem', minHeight: '36px' }} onClick={() => {
                                const newMode = !isMusicMode
                                setIsMusicMode(newMode)
                                localStorage.setItem('syncytm_music_mode', newMode.toString())
                            }}>
                                <Music2 size={18} /> <span>Music Mode</span>
                            </button>
                            <button className="btn btn-primary btn-mobile-compact mobile-hide-text" style={{ padding: '0.4rem 0.75rem', minHeight: '36px' }} onClick={() => setShowSearch(true)}>
                                {hasRemote ? <><Plus size={18} /> <span>Add</span></> : <><SearchIcon size={18} /> <span>Request</span></>}
                            </button>
                        </div>
                    </header>

                    {/* Player Area - Swappable */}
                    <div style={{ flexShrink: 0 }}>
                        <div style={{
                            visibility: isMusicMode ? 'hidden' : 'visible',
                            height: isMusicMode ? '0' : 'auto',
                            overflow: isMusicMode ? 'hidden' : 'visible',
                            position: 'relative'
                        }}>
                            {url ? (
                                <Player
                                    url={url}
                                    isPlaying={isPlaying}
                                    playerRef={playerRef}
                                    onProgress={onProgress}
                                    onDuration={onDuration}
                                    onPlay={onPlay}
                                    onPause={onPause}
                                    onBuffer={onBuffer}
                                    onBufferEnd={onBufferEnd}
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
                        </div>

                        {isMusicMode && (
                            <div style={{ height: 'auto', minHeight: '300px' }}>
                                <MusicModeUI
                                    currentVideo={currentVideo}
                                    isPlaying={isPlaying}
                                    progress={progress}
                                    duration={duration}
                                    onPlayPause={handleTogglePlay}
                                    onNext={handleNext}
                                    onPrev={handlePrev}
                                    onSeek={onSeek}
                                    onExit={() => {
                                        setIsMusicMode(false)
                                        localStorage.setItem('syncytm_music_mode', 'false')
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Mobile Segmented Tab Controller */}
                    <div className="room-mobile-tabs">
                        <button
                            className={`btn room-mobile-tab-btn ${mobileTab === 'queue' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => setMobileTab('queue')}
                        >
                            <ListMusic size={16} /> <span>Queue</span> {queue.length > 0 && <span className="tab-badge">{queue.length}</span>}
                        </button>
                        <button
                            className={`btn room-mobile-tab-btn ${mobileTab === 'chat' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => {
                                setMobileTab('chat')
                                setActiveTab('chat')
                                setUnreadChatCount(0)
                            }}
                        >
                            <MessageCircle size={16} /> <span>Chat</span> {unreadChatCount > 0 && <span className="tab-badge">{unreadChatCount}</span>}
                        </button>
                        <button
                            className={`btn room-mobile-tab-btn ${mobileTab === 'users' ? 'btn-primary' : 'btn-ghost'}`}
                            onClick={() => {
                                setMobileTab('users')
                                setActiveTab('users')
                            }}
                        >
                            <Users size={16} /> <span>Users</span> {peers.length > 0 && <span className="tab-badge">{peers.length + 1}</span>}
                            {isHost && songRequests.length > 0 && <span className="tab-badge-warning">{songRequests.length}</span>}
                        </button>
                    </div>

                    {/* Queue List with Tabs */}
                    <div className={`glass-card room-queue-card ${mobileTab !== 'queue' ? 'mobile-hidden-section' : ''}`}>
                        {/* Queue Tabs Header */}
                        <div style={{ display: 'flex', borderBottom: '1px solid hsl(var(--border))', width: '100%', boxSizing: 'border-box' }}>
                            <button
                                onClick={() => setQueueTab('queue')}
                                style={{
                                    flex: '1 1 0',
                                    minWidth: 0,
                                    padding: '0.75rem 0.5rem',
                                    background: queueTab === 'queue' ? 'hsl(var(--surface))' : 'transparent',
                                    border: 'none',
                                    color: queueTab === 'queue' ? 'white' : 'grey',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.4rem',
                                    fontWeight: 'bold',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <ListMusic size={18} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Queue</span>
                            </button>
                            <button
                                onClick={() => setQueueTab('playlists')}
                                style={{
                                    flex: '1 1 0',
                                    minWidth: 0,
                                    padding: '0.75rem 0.5rem',
                                    background: queueTab === 'playlists' ? 'hsl(var(--surface))' : 'transparent',
                                    border: 'none',
                                    color: queueTab === 'playlists' ? 'white' : 'grey',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.4rem',
                                    fontWeight: 'bold',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <Music size={18} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Playlists</span>
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {/* QUEUE TAB */}
                            {queueTab === 'queue' && (
                                <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {/* Queue Management Toolbar */}
                                    {queue.length > 0 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem', borderBottom: '1px solid hsla(var(--border)/0.5)', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                <span>{queue.length} {queue.length === 1 ? 'song' : 'songs'}</span>
                                                {isQueueSelectMode && selectedQueueItems.size > 0 && (
                                                    <span style={{ color: 'hsl(var(--primary))', fontWeight: 'bold' }}>
                                                        • {selectedQueueItems.size} selected
                                                    </span>
                                                )}
                                            </div>

                                            {hasRemote && (
                                                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {isQueueSelectMode ? (
                                                        <>
                                                            <button
                                                                className="btn btn-ghost"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', minHeight: '32px' }}
                                                                onClick={() => {
                                                                    if (selectedQueueItems.size === queue.length) {
                                                                        setSelectedQueueItems(new Set())
                                                                    } else {
                                                                        const allKeys = new Set(queue.map((v, i) => v.queueItemId || `${v.id}-${i}`))
                                                                        setSelectedQueueItems(allKeys)
                                                                    }
                                                                }}
                                                            >
                                                                {selectedQueueItems.size === queue.length ? 'Deselect All' : 'Select All'}
                                                            </button>

                                                            <button
                                                                className="btn btn-primary"
                                                                style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem', minHeight: '32px', background: 'hsl(var(--error))', boxShadow: 'none' }}
                                                                disabled={selectedQueueItems.size === 0}
                                                                onClick={() => handleDeleteQueueItems(selectedQueueItems)}
                                                                title="Delete selected songs from queue"
                                                            >
                                                                <Trash2 size={14} /> Delete ({selectedQueueItems.size})
                                                            </button>

                                                            <button
                                                                className="btn btn-ghost"
                                                                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', minHeight: '32px' }}
                                                                onClick={() => {
                                                                    setIsQueueSelectMode(false)
                                                                    setSelectedQueueItems(new Set())
                                                                }}
                                                            >
                                                                Done
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                className="btn btn-ghost"
                                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', minHeight: '32px', border: '1px solid hsla(var(--border)/0.5)' }}
                                                                onClick={() => setIsQueueSelectMode(true)}
                                                                title="Select entries to delete"
                                                            >
                                                                <CheckSquare size={14} /> Select
                                                            </button>
                                                            <button
                                                                className="btn btn-ghost"
                                                                style={{ padding: '0.3rem 0.65rem', fontSize: '0.8rem', minHeight: '32px', color: 'hsl(var(--error))' }}
                                                                onClick={handleClearQueue}
                                                                title="Clear entire queue"
                                                            >
                                                                <Trash2 size={14} /> Clear
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Queue Items */}
                                    {queue.map((video, i) => {
                                        const isCurrent = currentVideo && currentVideo.id === video.id
                                        const itemKey = video.queueItemId || `${video.id}-${i}`
                                        const isSelected = selectedQueueItems.has(itemKey)

                                        return (
                                            <div
                                                key={itemKey}
                                                onClick={() => {
                                                    if (isQueueSelectMode) {
                                                        setSelectedQueueItems(prev => {
                                                            const next = new Set(prev)
                                                            if (next.has(itemKey)) next.delete(itemKey)
                                                            else next.add(itemKey)
                                                            return next
                                                        })
                                                    } else if (hasRemote) {
                                                        playVideo(video)
                                                    }
                                                }}
                                                style={{
                                                    display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.5rem',
                                                    borderRadius: '8px',
                                                    background: isSelected ? 'hsla(var(--primary)/0.15)' : (isCurrent ? 'hsla(var(--primary)/0.1)' : 'transparent'),
                                                    border: isSelected ? '1px solid hsl(var(--primary))' : (isCurrent ? '1px solid hsl(var(--primary))' : '1px solid transparent'),
                                                    cursor: hasRemote ? 'pointer' : 'default',
                                                    opacity: isCurrent || isSelected ? 1 : 0.8,
                                                    transition: 'all 0.15s ease',
                                                    width: '100%',
                                                    maxWidth: '100%',
                                                    minWidth: 0,
                                                    boxSizing: 'border-box'
                                                }}
                                                className="queue-item"
                                            >
                                                {isQueueSelectMode ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => { }} // Handled by parent div onClick
                                                        style={{ width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                                                    />
                                                ) : (
                                                    isCurrent && (
                                                        <div style={{ color: 'hsl(var(--primary))', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                                            <Play size={12} fill="currentColor" />
                                                        </div>
                                                    )
                                                )}

                                                <div style={{ width: '40px', height: '40px', background: 'black', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                                                    <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                                </div>

                                                <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                                    <div title={video.title} style={{ fontWeight: '600', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isCurrent ? 'hsl(var(--primary))' : 'inherit' }}>
                                                        {video.title}
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {video.channel}
                                                    </div>
                                                </div>

                                                {hasRemote && !isQueueSelectMode && (
                                                    <button
                                                        className="btn btn-ghost"
                                                        style={{ padding: '0.35rem', minHeight: '30px', color: 'hsl(var(--text-muted))', flexShrink: 0 }}
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleDeleteSingleQueueItem(video, i)
                                                        }}
                                                        title="Remove from queue"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
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
                                <div style={{ flex: 1, overflowY: 'visible', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid hsl(var(--border))', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                <div>
                                                    <h4 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{playlistData.title}</h4>
                                                    <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>{playlistData.videos.length} songs</p>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => setSelectedSongs(selectedSongs.size === playlistData.videos.length ? new Set() : new Set(playlistData.videos.map(v => v.id)))}
                                                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', minHeight: '32px' }}
                                                    >
                                                        {selectedSongs.size === playlistData.videos.length ? 'Deselect All' : 'Select All'}
                                                    </button>
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={handleDeleteSelectedFromPlaylistPreview}
                                                        disabled={selectedSongs.size === 0}
                                                        style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', minHeight: '32px', color: 'hsl(var(--error))' }}
                                                        title="Remove selected songs from list"
                                                    >
                                                        <Trash2 size={14} /> Remove ({selectedSongs.size})
                                                    </button>
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={handleImportSelected}
                                                        disabled={selectedSongs.size === 0}
                                                        style={{ padding: '0.35rem 0.85rem', fontSize: '0.85rem', minHeight: '32px' }}
                                                    >
                                                        Import {selectedSongs.size > 0 ? `(${selectedSongs.size})` : ''}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Song List with Checkboxes */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: 'none', paddingRight: '0.5rem' }}>
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
                                                                transition: 'background-color 0.2s ease, border-color 0.2s ease',
                                                                width: '100%',
                                                                maxWidth: '100%',
                                                                minWidth: 0,
                                                                boxSizing: 'border-box'
                                                            }}
                                                        >
                                                            {/* Checkbox */}
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => { }} // Handled by parent div onClick
                                                                style={{ cursor: 'pointer', width: '16px', height: '16px', flexShrink: 0 }}
                                                            />

                                                            {/* Thumbnail */}
                                                            <div style={{ width: '40px', height: '40px', background: 'black', borderRadius: '4px', overflow: 'hidden', flexShrink: 0 }}>
                                                                <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                                                            </div>

                                                            {/* Title & Channel */}
                                                            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                                                <div title={video.title} style={{ fontWeight: '600', fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                    {video.title}
                                                                </div>
                                                                <div style={{ fontSize: '0.8rem', opacity: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{video.channel}</div>
                                                            </div>

                                                            <button
                                                                className="btn btn-ghost"
                                                                style={{ padding: '0.35rem', minHeight: '30px', color: 'hsl(var(--text-muted))', flexShrink: 0 }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleDeleteFromPlaylistPreview(video.id)
                                                                }}
                                                                title="Remove from list"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
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
                <div className={`glass-card room-right-col ${mobileTab === 'queue' ? 'mobile-hidden-section' : ''}`}>

                    {/* Tabs Header */}
                    <div style={{ display: 'flex', borderBottom: '1px solid hsl(var(--border))', width: '100%', boxSizing: 'border-box' }}>
                        <button
                            onClick={() => {
                                setActiveTab('chat')
                                setMobileTab('chat')
                                setUnreadChatCount(0)
                            }}
                            style={{ flex: '1 1 0', minWidth: 0, padding: '0.75rem 0.5rem', background: activeTab === 'chat' ? 'hsl(var(--surface))' : 'transparent', border: 'none', color: activeTab === 'chat' ? 'white' : 'grey', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.9rem' }}
                        >
                            <MessageCircle size={18} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Chat</span> {unreadChatCount > 0 && <span className="tab-badge">{unreadChatCount}</span>}
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab('users')
                                setMobileTab('users')
                            }}
                            style={{ flex: '1 1 0', minWidth: 0, padding: '0.75rem 0.5rem', background: activeTab === 'users' ? 'hsl(var(--surface))' : 'transparent', border: 'none', color: activeTab === 'users' ? 'white' : 'grey', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontWeight: 'bold', fontSize: '0.9rem' }}
                        >
                            <Users size={18} style={{ flexShrink: 0 }} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Users</span>
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
                                <form onSubmit={handleSendMessage} style={{ padding: '0.75rem 1rem', borderTop: '1px solid hsl(var(--border))', display: 'flex', gap: '0.5rem', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                                    <input className="input" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type a message..." style={{ padding: '0.5rem 0.75rem', minHeight: '38px', flex: 1, minWidth: 0 }} />
                                    <button type="submit" className="btn btn-primary" style={{ padding: '0.5rem 1rem', minHeight: '38px', flexShrink: 0 }}><Send size={18} /></button>
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
                                        {/* Show Me First */}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem', background: 'hsla(var(--surface-hover)/0.5)', borderRadius: 'var(--radius-md)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'hsl(var(--success))', flexShrink: 0 }} />
                                                <span style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.user_metadata?.username || user.email}</span>
                                                <span style={{
                                                    fontSize: '0.7rem',
                                                    background: 'hsl(var(--primary))',
                                                    color: 'white',
                                                    padding: '0.1rem 0.4rem',
                                                    borderRadius: '10px',
                                                    fontWeight: 'bold'
                                                }}>YOU</span>
                                            </div>
                                            {isHost ? (
                                                <Shield size={16} color="hsl(var(--primary))" title="Host" />
                                            ) : (
                                                hasRemote && <Shield size={16} color="hsl(var(--secondary))" title="Remote Control Active" />
                                            )}
                                        </div>

                                        {peers.map(p => {
                                            const isThisUserHost = p.peerId === room?.host_id
                                            const isRemote = remoteUsers.has(p.userEmail) || isThisUserHost
                                            const displayName = p.username || p.userEmail

                                            return (
                                                <div key={p.peerId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem', background: 'hsl(var(--surface))', borderRadius: '8px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: 1 }}>
                                                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'hsl(var(--primary))', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold', flexShrink: 0 }}>
                                                            {displayName[0].toUpperCase()}
                                                        </div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                                                            <span style={{ fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</span>
                                                            <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                                                                {isThisUserHost ? 'Host' : (isRemote ? 'Remote Access' : 'Guest')}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Host Controls */}
                                                    {isHost && (
                                                        <button
                                                            onClick={() => toggleRemote(p.userEmail)}
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
            <Footer />
        </div>
    )
}
