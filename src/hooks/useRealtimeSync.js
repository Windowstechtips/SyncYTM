import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export const useRealtimeSync = (roomId, user, onMessage, onPeerConnect) => {
    const [peers, setPeers] = useState([])
    const channelRef = useRef(null)
    const userRef = useRef(user)

    // Keep refs fresh
    const onMessageRef = useRef(onMessage)
    const onPeerConnectRef = useRef(onPeerConnect)
    const sendToPeerRef = useRef(null)

    useEffect(() => {
        onMessageRef.current = onMessage
        onPeerConnectRef.current = onPeerConnect
        userRef.current = user
    }, [onMessage, onPeerConnect, user])

    // Define sendToPeer function and store in ref so it can be called from within effects
    const sendToPeer = async (peerId, data) => {
        if (!channelRef.current) return

        // For Supabase, a "Direct Message" is just a broadcast with a target field
        // that clients filter out.
        const payload = {
            sender: userRef.current.id,
            senderEmail: userRef.current.user_metadata?.username || userRef.current.email,
            target: peerId,
            data: data
        }

        await channelRef.current.send({
            type: 'broadcast',
            event: 'message',
            payload: payload
        })
    }

    // Store sendToPeer in ref for use in callbacks
    useEffect(() => {
        sendToPeerRef.current = sendToPeer
    }, [])

    useEffect(() => {
        if (!roomId || !user) return

        console.log('Mounting useRealtimeSync for room:', roomId)

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
                const presentUsers = []

                // Convert presence state to simple peer list format
                Object.keys(state).forEach(key => {
                    state[key].forEach(presence => {
                        // Don't list ourselves as a peer (consistent with useWebRTC)
                        if (key !== user.id) {
                            presentUsers.push({
                                peerId: key,
                                userEmail: presence.user_email || 'Unknown', // Note: This comes from presence tracking.
                                // We need to ensure presence tracking sends username too?
                                // Ah, the channel.track call needs to include username!
                                username: presence.username || presence.user_email, // Add explicit username field
                                // Add fake 'peer' object if legacy code expects it, 
                                // but ideally we shouldn't access it. 
                                // We'll add a dummy connected flag for safety.
                                peer: { connected: true }
                            })
                        }
                    })
                })

                setPeers(presentUsers)
                console.log('Presence synced:', presentUsers.length, 'peers')

                // Notify about "new" connections to trigger any init logic
                // In Supabase, we don't get individual "connect" events easily on sync,
                // but we can check if we have new peers. 
                // For simplicity/robustness, we can iterate all.
                // However, preserving existing logic: "onPeerConnect" was for P2P handshake.
                // Here we might not strictly need it, BUT Room.jsx uses it to sync state to new users.
                // So let's trigger it for everyone we see.
                presentUsers.forEach(p => {
                    if (onPeerConnectRef.current && sendToPeerRef.current) {
                        onPeerConnectRef.current(p.peerId, p.userEmail, sendToPeerRef.current)
                    }
                })
            })
            .on('presence', { event: 'join' }, ({ key, newPresences }) => {
                console.log('User joined:', key, newPresences)
                // Sync event will usually follow and handle the list update
            })
            .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
                console.log('User left:', key)
            })
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                // payload: { type, sender, senderEmail, data, target }

                // Filter if it's a direct message meant for someone else
                if (payload.target && payload.target !== user.id) {
                    return
                }

                // Avoid processing own messages (broadcast sends to everyone including self sometimes? 
                // Supabase broadcast usually excludes sender, but let's be safe)
                if (payload.sender === user.id) return

                if (onMessageRef.current) {
                    // Pass directly to Room.jsx's onData
                    // Room.jsx expects (data, senderEmail)
                    onMessageRef.current(payload.data, payload.senderEmail)
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
            supabase.removeChannel(channel)
        }
    }, [roomId, user?.id])

    const broadcastData = async (data) => {
        if (!channelRef.current) return

        // Wrap data in our envelope
        const payload = {
            sender: userRef.current.id,
            senderEmail: userRef.current.user_metadata?.username || userRef.current.email,
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
