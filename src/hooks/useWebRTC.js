import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import SimplePeer from 'simple-peer'

export const useWebRTC = (roomId, user, onMessage, onPeerConnect) => {
    const [peers, setPeers] = useState([])
    const peersRef = useRef([]) // Store peer objects: { peerId, peer, userEmail }
    const channelRef = useRef(null)
    const presenceRef = useRef({}) // Store current presence state

    // Store latest callbacks in refs to avoid stale closures in event listeners
    const onMessageRef = useRef(onMessage)
    const onPeerConnectRef = useRef(onPeerConnect)

    useEffect(() => {
        onMessageRef.current = onMessage
        onPeerConnectRef.current = onPeerConnect
    }, [onMessage, onPeerConnect])

    // Force update helper to ensure UI reflects peer state mutations
    const [, forceUpdate] = useState({})

    useEffect(() => {
        if (!roomId || !user) return

        // Join the room channel
        const channel = supabase.channel(`room:${roomId}`, {
            config: {
                presence: {
                    key: user.id,
                },
            },
        })

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState()
                presenceRef.current = state
                console.log('Presence sync:', state)
                reconcilePeers(state)
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                console.log('Presence join:', key, newPresences)
                // Wait for sync or handle immediate
                // Sync usually fires after join, so reconcilePeers will handle it.
            })
            .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                console.log('Presence leave:', key)
                // If user leaves presence, disconnect peer
                // The peer might have already closed, but let's be safe
                if (key !== user.id) {
                    removePeer(key)
                }
            })
            .on('broadcast', { event: 'signal' }, ({ payload }) => {
                handleSignal(payload)
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ user_email: user.email })
                }
            })

        channelRef.current = channel

        return () => {
            console.log('Cleaning up WebRTC hook')
            peersRef.current.forEach(({ peer }) => peer.destroy())
            peersRef.current = []
            setPeers([])
            supabase.removeChannel(channel)
        }
    }, [roomId, user?.id])

    // Reconcile Peers based on Presence (Deterministic Connection)
    const reconcilePeers = (presenceState) => {
        const activeUserIds = new Set(Object.keys(presenceState))

        // 1. Cleanup Stale Peers (in case 'leave' event missed)
        const currentPeers = peersRef.current.map(p => p.peerId)
        currentPeers.forEach(peerId => {
            if (!activeUserIds.has(peerId)) {
                console.log('Removing stale peer via reconcile:', peerId)
                removePeer(peerId)
            }
        })

        // 2. Connect to New Peers
        activeUserIds.forEach(otherUserId => {
            if (otherUserId === user.id) return

            // Check if we already have a peer
            if (peersRef.current.find(p => p.peerId === otherUserId)) return

            // Unique ID Comparison for Deterministic Initiator
            if (user.id > otherUserId) {
                console.log(`I (${user.id}) am greater than (${otherUserId}). Initiating connection.`)
                const otherUserEmail = presenceState[otherUserId]?.[0]?.user_email || 'Unknown'
                createPeer(otherUserId, otherUserEmail, true)
            }
        })
    }

    // Track pending reconnect intervals per user ID
    const pendingReconnects = useRef(new Map())

    const createPeer = (targetUserId, targetEmail, initiator) => {
        if (peersRef.current.find(p => p.peerId === targetUserId)) {
            console.warn('Peer already exists for', targetEmail)
            return
        }

        // Clear any pending reconnects for this user since we are creating a new peer
        if (pendingReconnects.current.has(targetUserId)) {
            clearTimeout(pendingReconnects.current.get(targetUserId))
            pendingReconnects.current.delete(targetUserId)
        }

        console.log('Creating Peer for', targetEmail, 'Initiator:', initiator)

        const peer = new SimplePeer({
            initiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                ]
            }
        })

        const peerObj = { peerId: targetUserId, peer, userEmail: targetEmail }
        peersRef.current.push(peerObj)
        setPeers(prev => [...prev, peerObj])

        peer.on('signal', signal => {
            channelRef.current.send({
                type: 'broadcast',
                event: 'signal',
                payload: {
                    target: targetUserId,
                    sender: user.id,
                    senderEmail: user.email,
                    signal
                }
            })
        })

        peer.on('data', data => {
            try {
                const decoded = new TextDecoder().decode(data)
                const parsed = JSON.parse(decoded)

                if (onMessageRef.current) {
                    onMessageRef.current(parsed, targetEmail)
                }
            } catch (e) {
                console.error('Error parsing data:', e)
            }
        })

        peer.on('connect', () => {
            console.log('Connected to peer:', targetEmail)
            forceUpdate({}) // Ensure UI shows Green
            if (onPeerConnectRef.current) {
                // Pass sendToPeer to the callback to avoid closure issues
                onPeerConnectRef.current(targetUserId, targetEmail, sendToPeer)
            }
        })

        const handleDisconnect = () => {
            console.log('Peer disconnected:', targetEmail)
            removePeer(targetUserId)

            // Auto-Reconnect Logic
            const isUserOnline = Object.keys(presenceRef.current).includes(targetUserId)
            if (isUserOnline && initiator && !pendingReconnects.current.has(targetUserId)) {
                console.log(`User ${targetEmail} is still online. Attempting reconnect in 3s...`)
                const timeoutId = setTimeout(() => {
                    pendingReconnects.current.delete(targetUserId)
                    console.log(`Reconnecting to ${targetEmail}...`)
                    createPeer(targetUserId, targetEmail, true)
                }, 3000)
                pendingReconnects.current.set(targetUserId, timeoutId)
            }
        }

        peer.on('close', () => {
            console.log('Peer closed event', targetEmail)
            handleDisconnect()
        })

        peer.on('error', (err) => {
            console.error('Peer error:', targetEmail, err)
            handleDisconnect()
        })
    }

    const handleSignal = (payload) => {
        const { target, sender, senderEmail, signal } = payload
        if (target !== user.id) return // Not for us

        const existingPeer = peersRef.current.find(p => p.peerId === sender)

        if (existingPeer) {
            // Defensive Signaling: Ignore SDP signals (offer/answer) if already stable or connected
            // This prevents "InvalidStateError: stable" crashes
            if (existingPeer.peer.connected && (signal.type === 'offer' || signal.type === 'answer')) {
                console.log(`SYNC: Ignored redundant ${signal.type} from ${senderEmail} (Already connected)`)
                return
            }

            try {
                console.log(`SYNC: Signaling ${senderEmail} (${signal.type || 'candidate'})`)
                existingPeer.peer.signal(signal)
            } catch (err) {
                console.error(`SYNC: Signal error from ${senderEmail}:`, err)
            }
        } else {
            console.log(`Received signal from ${sender} (${senderEmail}). Creating responder peer.`)
            // Force create responder peer
            createPeer(sender, senderEmail, false)

            // Peer is now in peersRef immediately
            const newPeerObj = peersRef.current.find(p => p.peerId === sender)
            if (newPeerObj) {
                try {
                    newPeerObj.peer.signal(signal)
                } catch (err) {
                    console.error(`SYNC: Initial signal error from ${senderEmail}:`, err)
                }
            } else {
                console.warn('Could not find newly created peer to signal')
            }
        }
    }

    const removePeer = (id) => {
        const peerObj = peersRef.current.find(p => p.peerId === id)
        if (peerObj) {
            console.log('SYNC: Destroying peer:', peerObj.userEmail)
            try {
                peerObj.peer.destroy()
            } catch (e) {
                console.error('Error during peer destruction:', e)
            }
        }
        peersRef.current = peersRef.current.filter(p => p.peerId !== id)
        setPeers(prev => prev.filter(p => p.peerId !== id))
    }

    const broadcastData = (data) => {
        const msg = JSON.stringify(data)
        peersRef.current.forEach(({ peer }) => {
            if (peer.connected) {
                try {
                    peer.send(msg)
                } catch (e) {
                    console.error('Broadcast failed to peer', e)
                }
            }
        })
    }

    const sendToPeer = (peerId, data) => {
        const peerObj = peersRef.current.find(p => p.peerId === peerId)
        if (peerObj && peerObj.peer.connected) {
            try {
                const msg = JSON.stringify(data)
                peerObj.peer.send(msg)
            } catch (e) {
                console.error('Send to peer failed', e)
            }
        }
    }

    return {
        peers,
        broadcastData,
        sendToPeer
    }
}
