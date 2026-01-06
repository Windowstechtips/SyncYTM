import React, { useState } from 'react'
import { searchYoutube } from '../services/youtube'
import { Search, Plus, X } from 'lucide-react'

export default function SearchOverlay({ onClose, onAddParams }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState([])
    const [loading, setLoading] = useState(false)

    const handleSearch = async (e) => {
        e.preventDefault()
        if (!query.trim()) return

        setLoading(true)
        const items = await searchYoutube(query)
        setResults(items)
        setLoading(false)
    }

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(10px)',
            display: 'flex', flexDirection: 'column', padding: '2rem'
        }} className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ fontSize: '2rem' }}>Search Music</h2>
                <button className="btn btn-ghost" onClick={onClose}><X size={24} /></button>
            </div>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
                <input
                    className="input"
                    placeholder="Search for songs, artists..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                    style={{ fontSize: '1.25rem', padding: '1rem' }}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '0 2rem' }}>
                    {loading ? '...' : <Search />}
                </button>
            </form>

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {results.map(video => (
                    <div key={video.id} className="glass-card" style={{
                        display: 'flex', gap: '1rem', padding: '1rem', alignItems: 'center',
                        borderColor: 'hsla(var(--border) / 0.3)'
                    }}>
                        <img
                            src={video.thumbnail}
                            alt={video.title}
                            style={{ width: '120px', height: '67px', objectFit: 'cover', borderRadius: '8px' }}
                        />
                        <div style={{ flex: 1 }}>
                            <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>
                                {video.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}
                            </h3>
                            <p className="text-muted" style={{ fontSize: '0.9rem' }}>{video.channel}</p>
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => {
                                onAddParams(video)
                                // Optional message "Added!"
                            }}
                        >
                            <Plus size={18} /> Add
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
