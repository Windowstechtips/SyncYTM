import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext({})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Check active sessions and sets the user
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user)
            } else {
                // Restore guest session from localStorage if no real Supabase session
                const savedGuest = localStorage.getItem('syncytm_guest')
                if (savedGuest) {
                    try { setUser(JSON.parse(savedGuest)) } catch { localStorage.removeItem('syncytm_guest') }
                }
            }
            setLoading(false)
        })

        // Listen for changes on auth state (logged in, signed out, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                // Real Supabase session takes over — clear any lingering guest data
                localStorage.removeItem('syncytm_guest')
                setUser(session.user)
            } else if (_event === 'SIGNED_OUT') {
                localStorage.removeItem('syncytm_guest')
                setUser(null)
            }
            setLoading(false)
        })

        return () => subscription.unsubscribe()
    }, [])

    const signUp = async (email, password, username) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username,
                    avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
                },
            },
        })
        return { data, error }
    }

    const signIn = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })
        return { data, error }
    }

    const signOut = async () => {
        localStorage.removeItem('syncytm_guest')
        const { error } = await supabase.auth.signOut()
        setUser(null)
        return { error }
    }

    /**
     * Creates a temporary guest session stored only in localStorage.
     * The guest user object mimics the Supabase user shape enough to pass
     * existing `user` checks, but uses a random UUID that can never match
     * a real room host_id in the database.
     */
    const continueAsGuest = (displayName) => {
        const trimmed = displayName.trim()
        if (!trimmed) return

        const guestUser = {
            id: `guest-${crypto.randomUUID()}`,
            email: null,
            isGuest: true,
            user_metadata: {
                username: trimmed,
                avatar_url: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(trimmed)}`,
            },
        }
        localStorage.setItem('syncytm_guest', JSON.stringify(guestUser))
        setUser(guestUser)
    }

    const value = {
        signUp,
        signIn,
        signOut,
        continueAsGuest,
        user,
        isGuest: !!user?.isGuest,
    }

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    )
}
