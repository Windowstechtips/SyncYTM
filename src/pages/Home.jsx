
import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, Lock, Music, Trash2, Edit2, Users } from 'lucide-react'
import { containsBadWords } from '../lib/badWords'
import { useRoomCounts } from '../hooks/useGlobalPresence' // Import the hook
import Footer from '../components/Footer'

export default function Home() {
    const { user, signOut } = useAuth()
    const navigate = useNavigate()

    const [activeRooms, setActiveRooms] = useState([])
    const [myRooms, setMyRooms] = useState([])
    const roomCounts = useRoomCounts() // Get realtime counts

    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingRoom, setEditingRoom] = useState(null)

    const [formName, setFormName] = useState('')
    const [isPrivate, setIsPrivate] = useState(false)
    const [password, setPassword] = useState('')

    // Profile Edit State
    const [showProfileModal, setShowProfileModal] = useState(false)
    const [newUsername, setNewUsername] = useState('')

    useEffect(() => {
        fetchRooms()
        const channel = supabase
            .channel('public:rooms')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchRooms)
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [user.id])

    const fetchRooms = async () => {
        const { data } = await supabase.from('rooms').select('*').order('created_at', { ascending: false })
        if (data) {
            // Filter Logic
            // Active: Any room with realtime listener count > 0 (Previously checked db column)
            // But strict "activeRooms" list might need to filter based on checks.
            // Since `roomCounts` updates frequently, we might want to derive activeRooms in render or effect.
            // For now, let's keep `activeRooms` state populated with ALL rooms, and filter in render.
            // Wait, fetchRooms filters? No, selects *.

            const mine = data.filter(r => r.host_id === user.id)

            // We'll store ALL public rooms in 'activeRooms' state, and filter by count in the JSX
            setActiveRooms(data)
            setMyRooms(mine)
        }
    }

    const resetForm = () => {
        setFormName('')
        setIsPrivate(false)
        setPassword('')
        setEditingRoom(null)
        setShowCreateModal(false)
        setShowEditModal(false)
    }

    const createRoom = async (e) => {
        e.preventDefault()
        if (!formName) return

        if (containsBadWords(formName)) {
            alert("Room name contains inappropriate language. Please choose another name.")
            return
        }

        const { data, error } = await supabase.from('rooms').insert([{
            name: formName,
            is_private: isPrivate,
            password_hash: isPrivate ? password : null,
            host_id: user.id,
            active_listeners: 0
        }]).select()

        if (error) {
            alert(error.message)
        } else {
            resetForm()
            navigate(`/room/${data[0].id}`)
        }
    }

    const updateRoom = async (e) => {
        e.preventDefault()
        if (!formName || !editingRoom) return

        if (containsBadWords(formName)) {
            alert("Room name contains inappropriate language. Please choose another name.")
            return
        }

        const updateData = {
            name: formName,
            is_private: isPrivate,
            password_hash: isPrivate ? password : null // Note: Passing null removes password if switching to public
        }

        const { error } = await supabase.from('rooms').update(updateData).eq('id', editingRoom.id)

        if (error) {
            alert(error.message)
        } else {
            resetForm()
            fetchRooms()
        }
    }

    const confirmDelete = async (roomId) => {
        if (window.confirm('Are you sure you want to delete this room?')) {
            const { error } = await supabase.from('rooms').delete().eq('id', roomId)
            if (error) alert(error.message)
            else fetchRooms()
        }
    }

    const updateProfile = async (e) => {
        e.preventDefault()
        if (!newUsername.trim()) return

        const { error } = await supabase.auth.updateUser({
            data: { username: newUsername }
        })

        if (error) {
            alert(error.message)
        } else {
            setShowProfileModal(false)
            // Force reload to see changes or rely on AuthContext subscription update?
            // AuthContext listens to onAuthStateChange, providing the UI updates optimistically or via event.
            // updateUser triggers USER_UPDATED event usually.
        }
    }

    const openEditModal = (room) => {
        setEditingRoom(room)
        setFormName(room.name)
        setIsPrivate(room.is_private)
        setPassword(room.password_hash || '') // Pre-fill if exists (simplified)
        setShowEditModal(true)
    }

    return (
        <div className="container" style={{
            paddingTop: '2rem',
            paddingBottom: '2rem',
            flex: 1,
            background: 'radial-gradient(circle at top right, hsl(var(--primary) / 0.35), transparent 50%), radial-gradient(circle at bottom left, hsl(var(--secondary) / 0.1), transparent 50%)',
        }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '2rem' }}>
                    <Music color="hsl(var(--primary))" /> SyncYTM
                </h1>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'hsl(var(--text-muted))' }}>{user.user_metadata?.username || user.email}</span>
                        <button className="btn btn-ghost" style={{ padding: '0.2rem' }} onClick={() => { setNewUsername(user.user_metadata?.username || ''); setShowProfileModal(true) }}>
                            <Edit2 size={14} />
                        </button>
                    </div>
                    <button className="btn btn-ghost" onClick={signOut}>Log Out</button>
                </div>
            </header>

            {/* My Rooms Section */}
            <div style={{ marginBottom: '3rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.5rem' }}>My Rooms</h2>
                    <button className="btn btn-primary" onClick={() => { resetForm(); setShowCreateModal(true) }}>
                        <Plus size={20} /> Create Room
                    </button>
                </div>

                {myRooms.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', border: '1px dashed hsl(var(--border))', borderRadius: 'var(--radius-lg)', color: 'hsl(var(--text-muted))' }}>
                        <p>You haven't created any rooms yet.</p>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {myRooms.map(room => (
                            <div key={room.id} className="glass-card" style={{ padding: '1.5rem', transition: 'all 0.2s', position: 'relative' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', cursor: 'pointer' }} onClick={() => navigate(`/room/${room.id}`)}>
                                    <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>{room.name}</h3>
                                    {room.is_private && <Lock size={16} color="hsl(var(--text-muted))" />}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                                        <Users size={14} /> {roomCounts[room.id] || 0}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button className="btn btn-ghost" style={{ padding: '0.4rem' }} onClick={(e) => { e.stopPropagation(); openEditModal(room) }} title="Edit">
                                            <Edit2 size={16} />
                                        </button>
                                        <button className="btn btn-ghost" style={{ padding: '0.4rem', color: 'hsl(var(--destructive))' }} onClick={(e) => { e.stopPropagation(); confirmDelete(room.id) }} title="Delete">
                                            <Trash2 size={16} />
                                        </button>
                                        <button className="btn btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }} onClick={() => navigate(`/room/${room.id}`)}>
                                            Enter <Play size={14} style={{ marginLeft: '4px' }} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Active Rooms Section */}
            <div style={{ marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Active Public Rooms</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {activeRooms.filter(r => r.host_id !== user.id && (roomCounts[r.id] > 0)).map(room => (
                        <div key={room.id} className="glass-card" style={{ padding: '1.5rem', transition: 'all 0.2s', cursor: 'pointer' }} onClick={() => navigate(`/room/${room.id}`)}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>{room.name}</h3>
                                {room.is_private && <Lock size={16} color="hsl(var(--text-muted))" />}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.9rem', color: 'hsl(var(--primary))' }}>
                                    <Users size={16} /> {roomCounts[room.id] || 0} Active
                                </div>
                                <button className="btn btn-ghost" style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                                    Join <Play size={14} style={{ marginLeft: '4px' }} />
                                </button>
                            </div>
                        </div>

                    ))}
                    {activeRooms.filter(r => r.host_id !== user.id && (roomCounts[r.id] > 0)).length === 0 && (
                        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '3rem', color: 'hsl(var(--text-muted))' }}>
                            <p>No other active rooms right now.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit Modal */}
            {
                (showCreateModal || showEditModal) && (
                    <div style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                    }}>
                        <div className="glass-card animate-fade-in" style={{ width: '400px', background: 'hsl(var(--surface))' }}>
                            <h2 style={{ marginBottom: '1.5rem' }}>{showEditModal ? 'Edit Room' : 'Create a Room'}</h2>
                            <form onSubmit={showEditModal ? updateRoom : createRoom}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Room Name</label>
                                        <input className="input" autoFocus value={formName} onChange={e => setFormName(e.target.value)} required />
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
                                            <input className="input" type="text" value={password} onChange={e => setPassword(e.target.value)} required placeholder={showEditModal ? "Enter new password" : ""} />
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                        <button type="button" className="btn btn-ghost" onClick={resetForm} style={{ flex: 1 }}>Cancel</button>
                                        <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>{showEditModal ? 'Save Changes' : 'Create'}</button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }

            {/* Profile Edit Modal */}
            {showProfileModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100
                }}>
                    <div className="glass-card animate-fade-in" style={{ width: '400px', background: 'hsl(var(--surface))' }}>
                        <h2 style={{ marginBottom: '1.5rem' }}>Update Profile</h2>
                        <form onSubmit={updateProfile}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem' }}>Username</label>
                                    <input className="input" autoFocus value={newUsername} onChange={e => setNewUsername(e.target.value)} required />
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                    <button type="button" className="btn btn-ghost" onClick={() => setShowProfileModal(false)} style={{ flex: 1 }}>Cancel</button>
                                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Save</button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <Footer />
        </div >
    )
}
