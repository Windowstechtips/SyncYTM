/**
 * Discord Rich Presence Service via Discord Gateway WebSocket
 * 
 * Connects directly to Discord's Gateway (wss://gateway.discord.gg)
 * to broadcast the user's current track, room info, progress bar,
 * and a "Join Room" button directly to their Discord profile.
 * 
 * Token and configuration are stored exclusively in localStorage
 * on the client and never sent to any external server.
 */

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=9&encoding=json'
const STORAGE_KEY = 'syncytm_discord_rpc_config'

// Default fallback application ID if none provided (Registered YouTube Music RPC ID)
const DEFAULT_APP_ID = '463151177696149514'

class DiscordRPCService {
    constructor() {
        this.ws = null
        this.heartbeatInterval = null
        this.lastSequence = null
        this.status = 'disconnected' // 'disconnected' | 'connecting' | 'connected' | 'error'
        this.user = null
        this.errorMessage = null
        this.listeners = new Set()
        this.reconnectTimeout = null
        this.lastPresenceUpdate = 0
        this.pendingPresence = null
        this.presenceThrottleTimer = null
        this.currentActivityData = null

        // Load config from localStorage
        this.config = this.loadConfig()

        // Auto-connect if enabled
        if (this.config.enabled && this.config.token) {
            this.connect(this.config.token, this.config.applicationId)
        }
    }

    loadConfig() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY)
            if (saved) {
                return JSON.parse(saved)
            }
        } catch (e) {
            console.error('[DiscordRPC] Error loading config:', e)
        }
        return {
            enabled: false,
            token: '',
            applicationId: ''
        }
    }

    saveConfig(newConfig) {
        this.config = { ...this.config, ...newConfig }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config))
        } catch (e) {
            console.error('[DiscordRPC] Error saving config:', e)
        }
        this.notifyListeners()
    }

    subscribe(listener) {
        this.listeners.add(listener)
        // Immediately notify with current state
        listener(this.getState())
        return () => this.listeners.delete(listener)
    }

    notifyListeners() {
        const state = this.getState()
        this.listeners.forEach(fn => {
            try { fn(state) } catch (err) { console.error(err) }
        })
    }

    getState() {
        return {
            status: this.status,
            user: this.user,
            errorMessage: this.errorMessage,
            enabled: !!this.config.enabled,
            token: this.config.token || '',
            applicationId: this.config.applicationId || ''
        }
    }

    connect(token = this.config.token, applicationId = this.config.applicationId) {
        if (!token || !token.trim()) {
            this.status = 'error'
            this.errorMessage = 'Discord token is required'
            this.notifyListeners()
            return
        }

        // Clean any existing connection
        this.cleanup(false)

        this.status = 'connecting'
        this.errorMessage = null
        this.notifyListeners()

        try {
            console.log('[DiscordRPC] Connecting to Discord Gateway...')
            this.ws = new WebSocket(GATEWAY_URL)

            this.ws.onopen = () => {
                console.log('[DiscordRPC] WebSocket opened, waiting for Hello (OP 10)...')
            }

            this.ws.onmessage = (event) => {
                try {
                    const packet = JSON.parse(event.data)
                    this.handlePacket(packet, token)
                } catch (err) {
                    console.error('[DiscordRPC] Packet parse error:', err)
                }
            }

            this.ws.onerror = (err) => {
                console.error('[DiscordRPC] WebSocket error:', err)
                this.status = 'error'
                this.errorMessage = 'Connection error to Discord Gateway'
                this.notifyListeners()
            }

            this.ws.onclose = (event) => {
                console.log(`[DiscordRPC] WebSocket closed: code ${event.code}, reason: ${event.reason}`)
                this.stopHeartbeat()
                this.user = null

                if (event.code === 4004) {
                    this.status = 'error'
                    this.errorMessage = 'Authentication failed. Please verify your Discord token.'
                } else if (this.status !== 'disconnected') {
                    this.status = 'disconnected'
                    // If enabled and wasn't explicit disconnect, try reconnect after delay
                    if (this.config.enabled && event.code !== 4004) {
                        this.scheduleReconnect()
                    }
                }
                this.notifyListeners()
            }
        } catch (err) {
            console.error('[DiscordRPC] Connection failure:', err)
            this.status = 'error'
            this.errorMessage = err.message || 'Failed to initialize WebSocket'
            this.notifyListeners()
        }
    }

    scheduleReconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
        this.reconnectTimeout = setTimeout(() => {
            if (this.config.enabled && this.config.token) {
                console.log('[DiscordRPC] Reconnecting...')
                this.connect()
            }
        }, 8000)
    }

    handlePacket(packet, token) {
        const { op, d, s, t } = packet

        if (s !== null && s !== undefined) {
            this.lastSequence = s
        }

        switch (op) {
            case 10: { // Hello
                const heartbeatInterval = d.heartbeat_interval
                this.startHeartbeat(heartbeatInterval)
                this.identify(token)
                break
            }
            case 1: { // Heartbeat requested by Discord
                this.sendHeartbeat()
                break
            }
            case 11: { // Heartbeat ACK
                // Heartbeat acknowledged
                break
            }
            case 0: { // Dispatch
                if (t === 'READY') {
                    console.log('[DiscordRPC] Authenticated as:', d.user.username)
                    this.status = 'connected'
                    this.user = {
                        id: d.user.id,
                        username: d.user.username,
                        globalName: d.user.global_name || d.user.username,
                        avatar: d.user.avatar 
                            ? `https://cdn.discordapp.com/avatars/${d.user.id}/${d.user.avatar}.png` 
                            : 'https://cdn.discordapp.com/embed/avatars/0.png'
                    }
                    this.errorMessage = null
                    this.notifyListeners()

                    // If we have an existing activity queued, push it now
                    if (this.currentActivityData) {
                        this.updateActivity(this.currentActivityData, true)
                    }
                }
                break
            }
            default:
                break
        }
    }

    startHeartbeat(intervalMs) {
        this.stopHeartbeat()
        // Random jitter for first heartbeat as per Discord spec
        const initialDelay = Math.floor(Math.random() * intervalMs)
        this.heartbeatTimeout = setTimeout(() => {
            this.sendHeartbeat()
            this.heartbeatInterval = setInterval(() => {
                this.sendHeartbeat()
            }, intervalMs)
        }, initialDelay)
    }

    sendHeartbeat() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                op: 1,
                d: this.lastSequence
            }))
        }
    }

    stopHeartbeat() {
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout)
            this.heartbeatTimeout = null
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval)
            this.heartbeatInterval = null
        }
    }

    identify(token) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        const identifyPayload = {
            op: 2,
            d: {
                token: token.trim(),
                capabilities: 16381,
                properties: {
                    os: navigator.platform || 'Windows',
                    browser: 'Chrome',
                    device: '',
                    system_locale: navigator.language || 'en-US',
                    browser_user_agent: navigator.userAgent,
                    browser_version: '125.0.0.0',
                    os_version: '10',
                    referrer: '',
                    referring_domain: '',
                    referrer_current: '',
                    referring_domain_current: '',
                    release_channel: 'stable',
                    client_build_number: 290000,
                    client_event_source: null
                },
                presence: {
                    status: 'online',
                    since: 0,
                    activities: [],
                    afk: false
                },
                compress: false,
                client_state: {
                    guild_versions: {}
                }
            }
        }

        this.ws.send(JSON.stringify(identifyPayload))
    }

    /**
     * Updates Discord Rich Presence with current track & room details.
     * Throttled to adhere to Discord's rate limit (max 5 per 20 seconds).
     */
    updateActivity(activityData, immediate = false) {
        this.currentActivityData = activityData

        if (!this.config.enabled || this.status !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return
        }

        const now = Date.now()
        const timeSinceLast = now - this.lastPresenceUpdate

        // Discord rate limit: wait at least 3.5 seconds between status updates
        if (!immediate && timeSinceLast < 3500) {
            if (this.presenceThrottleTimer) clearTimeout(this.presenceThrottleTimer)
            this.presenceThrottleTimer = setTimeout(() => {
                this.sendPresencePayload(this.currentActivityData)
            }, 3500 - timeSinceLast)
            return
        }

        if (this.presenceThrottleTimer) {
            clearTimeout(this.presenceThrottleTimer)
            this.presenceThrottleTimer = null
        }

        this.sendPresencePayload(activityData)
    }

    sendPresencePayload(data) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

        this.lastPresenceUpdate = Date.now()

        const {
            title,
            artist,
            thumbnail,
            videoId,
            progress = 0,
            duration = 0,
            isPlaying = false,
            roomName,
            roomUrl
        } = data || {}

        // If no title, display that user is in room
        const hasTrack = !!title
        const trackTitle = title ? (title.length > 120 ? title.substring(0, 117) + '...' : title) : 'Listening to Music'
        const artistOrRoom = artist 
            ? (artist.length > 120 ? artist.substring(0, 117) + '...' : artist) 
            : (roomName ? `Room: ${roomName}` : 'SyncYTM')

        const now = Date.now()
        // Calculate timestamps for live progress bar
        const startTimestamp = (isPlaying && hasTrack) 
            ? Math.floor(now - (progress * 1000)) 
            : undefined

        const endTimestamp = (isPlaying && hasTrack && duration > 0) 
            ? Math.floor(now - (progress * 1000) + (duration * 1000)) 
            : undefined

        // Build the most reliable thumbnail URL possible:
        // 1. Construct directly from video ID (most reliable, well-known format)
        // 2. Fall back to thumbnail field from API
        // 3. Fall back to site favicon
        const albumArt = videoId
            ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
            : (thumbnail || 'https://syncytm.netlify.app/favicon.ico')

        const activity = {
            name: 'SyncYTM',
            type: 2, // 2 = Listening to
            details: trackTitle,
            state: artistOrRoom,
            assets: {
                large_image: albumArt,
                large_text: trackTitle,
                small_image: isPlaying 
                    ? 'https://cdn-icons-png.flaticon.com/512/0/375.png' 
                    : 'https://cdn-icons-png.flaticon.com/512/16/16427.png',
                small_text: isPlaying ? 'Playing' : 'Paused'
            }
        }

        // Add timestamps if playing
        if (startTimestamp) {
            activity.timestamps = {
                start: startTimestamp,
                ...(endTimestamp ? { end: endTimestamp } : {})
            }
        }

        // NOTE: application_id is intentionally omitted. When set, Discord restricts
        // large_image to pre-registered assets for that app ID, blocking external URLs.
        // Without it, Discord accepts arbitrary external HTTPS image URLs directly.

        // Add Join Room button if roomUrl provided
        if (roomUrl) {
            activity.buttons = ['Join Room']
            activity.metadata = {
                button_urls: [roomUrl]
            }
        }

        const payload = {
            op: 3,
            d: {
                since: 0,
                activities: [activity],
                status: 'online',
                afk: false
            }
        }

        try {
            this.ws.send(JSON.stringify(payload))
            console.log('[DiscordRPC] Sent Presence Update:', trackTitle, isPlaying ? '(Playing)' : '(Paused)')
        } catch (err) {
            console.error('[DiscordRPC] Error sending presence update:', err)
        }
    }

    clearActivity() {
        this.currentActivityData = null
        if (this.presenceThrottleTimer) {
            clearTimeout(this.presenceThrottleTimer)
            this.presenceThrottleTimer = null
        }

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const payload = {
                op: 3,
                d: {
                    since: 0,
                    activities: [],
                    status: 'online',
                    afk: false
                }
            }
            try {
                this.ws.send(JSON.stringify(payload))
                console.log('[DiscordRPC] Activity cleared')
            } catch (err) {
                console.error('[DiscordRPC] Error clearing activity:', err)
            }
        }
    }

    disconnect() {
        this.clearActivity()
        this.cleanup(true)
        this.status = 'disconnected'
        this.user = null
        this.notifyListeners()
    }

    cleanup(explicit = false) {
        if (explicit && this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout)
            this.reconnectTimeout = null
        }
        this.stopHeartbeat()
        if (this.presenceThrottleTimer) {
            clearTimeout(this.presenceThrottleTimer)
            this.presenceThrottleTimer = null
        }
        if (this.ws) {
            this.ws.onopen = null
            this.ws.onmessage = null
            this.ws.onerror = null
            this.ws.onclose = null
            try {
                this.ws.close(1000, 'User disconnect')
            } catch (e) {
                // ignore
            }
            this.ws = null
        }
    }
}

// Export singleton instance
export const discordRPC = new DiscordRPCService()
