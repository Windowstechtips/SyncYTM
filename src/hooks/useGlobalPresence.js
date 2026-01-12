import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * Hook for the Home page to get a map of active user counts per room.
 * Subscribes to 'public:rooms_global' channel.
 */
export const useRoomCounts = () => {
    const [counts, setCounts] = useState({})

    useEffect(() => {
        const channel = supabase.channel('public:rooms_global')

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState()

                // State structure: { [presenceId]: [{ room_id: '...', user_id: '...' }, ...] }
                // We want to count how many presences have room_id = X

                const newCounts = {}

                Object.values(state).flat().forEach(presence => {
                    const roomId = presence.room_id
                    if (roomId) {
                        newCounts[roomId] = (newCounts[roomId] || 0) + 1
                    }
                })

                setCounts(newCounts)
            })
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    return counts
}

/**
 * Hook for the Room page to announce presence.
 * Users join 'public:rooms_global' with their current room_id.
 */
export const useTrackRoomPresence = (roomId, userId) => {
    useEffect(() => {
        if (!roomId || !userId) return

        const channel = supabase.channel('public:rooms_global')

        channel
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    // Track presence: I am in this room
                    await channel.track({
                        room_id: roomId,
                        user_id: userId,
                        online_at: new Date().toISOString()
                    })
                }
            })

        return () => {
            // Cleanup handled by removeChannel, but explicitly untracking is clean too.
            // supabase.removeChannel handles unsubscribe.
            supabase.removeChannel(channel)
        }
    }, [roomId, userId])
}
