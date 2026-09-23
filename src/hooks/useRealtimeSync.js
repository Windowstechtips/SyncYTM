import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export const useRealtimeSync = (roomId, user, onMessage, onPeerConnect) => {
    const [peers, setPeers] = useState([])
    const channelRef = useRef(null)
    const userRef = useRef(user)

    // Keep callbacks fresh without re-running the channel setup effect
    const onMessageRef = useRef(onMessage)
    const onPeerConnectRef = useRef(onPeerConnect)
    const sendToPeerRef = useRef(null)

    // Track which peer IDs we've already called onPeerConnect for,
    // so we only fire it on genuinely NEW joins — not on every presence sync.
    const seenPeerIdsRef = useRef(new Set())

    useEffect(() => {
        onMessageRef.current = onMessage
        onPeerConnectRef.current = onPeerConnect
        userRef.current = user
    }, [onMessage, onPeerConnect, user])

    // sendToPeer: targeted unicast via broadcast with a `target` field.
    // Receivers filter by target; non-targets drop the message.
    const sendToPeer = async (peerId, data) => {
        if (!channelRef.current) return

        const payload = {
            sender: userRef.current.id,
            senderEmail: userRef.current.email,
            senderName: userRef.current.user_metadata?.username || userRef.current.email,
            target: peerId,
            data: data
        }

        await channelRef.current.send({
            type: 'broadcast',
            event: 'message',
            payload: payload
        })
    }

    useEffect(() => {
        sendToPeerRef.current = sendToPeer
    }, [])

    useEffect(() => {
        if (!roomId || !user) return

        console.log('Mounting useRealtimeSync for room:', roomId)
        // Reset seen peers on room mount / remount
        seenPeerIdsRef.current = new Set()

        const channel = supabase.channel(`room:${roomId}`, {
            config: {
                // self: false → Supabase won't echo our own broadcasts back to us (server-side filter)
                broadcast: { self: false },
                presence: {
                    key: user.id,
                },
            },
        })

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState()
                const presentUsers = []

                Object.keys(state).forEach(key => {
                    state[key].forEach(presence => {
                        if (key !== user.id) {
                            presentUsers.push({
                                peerId: key,
                                userEmail: presence.user_email || 'Unknown',
                                username: presence.username || presence.user_email,
                                peer: { connected: true }
                            })
                        }
                    })
                })

                setPeers(presentUsers)
                console.log('Presence synced:', presentUsers.length, 'peers')

                // Only fire onPeerConnect for peers we haven't seen yet
                const currentIds = new Set(presentUsers.map(p => p.peerId))
                presentUsers.forEach(p => {
                    if (!seenPeerIdsRef.current.has(p.peerId)) {
                        console.log('New peer detected:', p.userEmail)
                        if (onPeerConnectRef.current && sendToPeerRef.current) {
                            onPeerConnectRef.current(p.peerId, p.userEmail, sendToPeerRef.current)
                        }
                        seenPeerIdsRef.current.add(p.peerId)
                    }
                })

                // Remove left peers from seen set so they trigger onPeerConnect again if they rejoin
                seenPeerIdsRef.current.forEach(id => {
                    if (!currentIds.has(id)) {
                        seenPeerIdsRef.current.delete(id)
                    }
                })
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                console.log('User joined:', key, newPresences)
            })
            .on('presence', { event: 'leave' }, ({ key }) => {
                console.log('User left:', key)
                seenPeerIdsRef.current.delete(key)
            })
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                // payload: { sender, senderEmail, senderName, data, target? }

                // Filter targeted messages not meant for us
                if (payload.target && payload.target !== user.id) {
                    return
                }

                if (payload.sender === user.id) return

                if (onMessageRef.current) {
                    onMessageRef.current(payload.data, payload.senderEmail, payload.senderName, payload.sender)
                }
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({
                        user_email: user.email,
                        username: user.user_metadata?.username || user.email
                    })
                }
            })

        channelRef.current = channel

        return () => {
            console.log('Cleaning up Realtime hook')
            seenPeerIdsRef.current = new Set()
            supabase.removeChannel(channel)
        }
    }, [roomId, user?.id])

    const broadcastData = async (data) => {
        if (!channelRef.current) return

        const payload = {
            sender: userRef.current.id,
            senderEmail: userRef.current.email,
            senderName: userRef.current.user_metadata?.username || userRef.current.email,
            data: data
        }

        await channelRef.current.send({
            type: 'broadcast',
            event: 'message',
            payload: payload
        })
    }

    return {
        peers,
        broadcastData,
        sendToPeer
    }
}
