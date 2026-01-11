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

    // Track pending reconnect intervals
    const pendingReconnects = useRef(new Set())

    const createPeer = (targetUserId, targetEmail, initiator) => {
        if (peersRef.current.find(p => p.peerId === targetUserId)) {
            console.warn('Peer already exists for', targetEmail)
            return
        }

        console.log('Creating Peer for', targetEmail, 'Initiator:', initiator)

        const peer = new SimplePeer({
            initiator,
            trickle: false,
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
                onPeerConnectRef.current(targetUserId, targetEmail)
            }
        })

        const handleDisconnect = () => {
            console.log('Peer disconnected:', targetEmail)
            removePeer(targetUserId)

            // Auto-Reconnect Logic
            // If the user is present in the room state, and WE are the initiator, try again.
            // This handles network blips or temporary socket drops.
            const isUserOnline = Object.keys(presenceRef.current).includes(targetUserId)
            if (isUserOnline && initiator) {
                console.log(`User ${targetEmail} is still online. Attempting reconnect in 3s...`)
                const timeoutId = setTimeout(() => {
                    pendingReconnects.current.delete(timeoutId)
                    console.log(`Reconnecting to ${targetEmail}...`)
                    createPeer(targetUserId, targetEmail, true)
                }, 3000)
                pendingReconnects.current.add(timeoutId)
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

        const peerObj = { peerId: targetUserId, peer, userEmail: targetEmail }
        peersRef.current.push(peerObj)
        setPeers(prev => [...prev, peerObj])
    }

    const handleSignal = (payload) => {
        const { target, sender, senderEmail, signal } = payload
        if (target !== user.id) return // Not for us

        const existingPeer = peersRef.current.find(p => p.peerId === sender)

        if (existingPeer) {
            existingPeer.peer.signal(signal)
        } else {
            console.log(`Received signal from ${sender} (${senderEmail}). Creating responder peer.`)
            // Force create responder peer
            createPeer(sender, senderEmail, false)

            // Small delay to ensure peer instance is ready before signaling
            setTimeout(() => {
                const newPeerObj = peersRef.current.find(p => p.peerId === sender)
                if (newPeerObj) {
                    newPeerObj.peer.signal(signal)
                } else {
                    console.warn('Could not find newly created peer to signal')
                }
            }, 50)
        }
    }

    const removePeer = (id) => {
        const peerObj = peersRef.current.find(p => p.peerId === id)
        if (peerObj) {
            peerObj.peer.destroy()
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
