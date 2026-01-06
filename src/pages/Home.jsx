import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, Lock, Music } from 'lucide-react'

export default function Home() {
    const { user, signOut } = useAuth()
    const navigate = useNavigate()
    const [rooms, setRooms] = useState([])
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newRoomName, setNewRoomName] = useState('')
    const [isPrivate, setIsPrivate] = useState(false)
    const [password, setPassword] = useState('')

    useEffect(() => {
        fetchRooms()
        const channel = supabase
            .channel('public:rooms')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchRooms)
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    const fetchRooms = async () => {
        const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false })
        if (data) setRooms(data)
    }

    const createRoom = async (e) => {
        e.preventDefault()
        if (!newRoomName) return

        const { data, error } = await supabase.from('rooms').insert([{
            name: newRoomName,
            is_private: isPrivate,
            password_hash: isPrivate ? password : null, // In real app, hash this!
            host_id: user.id
        }]).select()

        if (error) {
            alert(error.message)
        } else {
            setShowCreateModal(false)
            setNewRoomName('')
            setPassword('')
            navigate(`/room/${data[0].id}`)
        }
    }

    return (
        <div className="container" style={{ paddingTop: '2rem' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '2rem' }}>
                    <Music color="hsl(var(--primary))" /> SyncYTM
                </h1>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ color: 'hsl(var(--text-muted))' }}>{user.email}</span>
                    <button className="btn btn-ghost" onClick={signOut}>Log Out</button>
                </div>
            </header>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem' }}>Active Rooms</h2>
                <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                    <Plus size={20} /> Create Room
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {rooms.map(room => (
                    <div key={room.id} className="glass-card" style={{ padding: '1.5rem', transition: 'all 0.2s', cursor: 'pointer' }} onClick={() => navigate(`/room/${room.id}`)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>{room.name}</h3>
                            {room.is_private && <Lock size={16} color="hsl(var(--text-muted))" />}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                                Join Room <Play size={14} style={{ marginLeft: '4px' }} />
                            </button>
                        </div>
                    </div>
                ))}
                {rooms.length === 0 && (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: 'hsl(var(--text-muted))' }}>
                        <p>No active rooms found. Create one to get started!</p>
                    </div>
                )}
            </div>

            {
                showCreateModal && (
                    <div style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                    }}>
                        <div className="glass-card animate-fade-in" style={{ width: '400px', background: 'hsl(var(--surface))' }}>
                            <h2 style={{ marginBottom: '1.5rem' }}>Create a Room</h2>
                            <form onSubmit={createRoom}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Room Name</label>
                                        <input className="input" autoFocus value={newRoomName} onChange={e => setNewRoomName(e.target.value)} required />
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            type="checkbox"
                                            id="isPrivate"
                                            checked={isPrivate}
                                            onChange={e => setIsPrivate(e.target.checked)}
                                            style={{ width: 'auto' }}
                                        />
                                        <label htmlFor="isPrivate">Private Room (Password protected)</label>
                                    </div>

                                    {isPrivate && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Password</label>
                                            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                        <button type="button" className="btn btn-ghost" onClick={() => setShowCreateModal(false)} style={{ flex: 1 }}>Cancel</button>
                                        <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Create</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    )
}
