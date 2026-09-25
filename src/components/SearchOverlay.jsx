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
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.94)', backdropFilter: 'blur(12px)',
            display: 'flex', flexDirection: 'column', padding: 'clamp(1rem, 3vw, 2rem)',
            overflowY: 'auto'
        }} className="animate-fade-in">
            <style>{`
                .search-item {
                    display: flex;
                    gap: 0.75rem;
                    padding: 0.85rem;
                    align-items: center;
                    border-color: hsla(var(--border) / 0.3);
                }
                .search-thumb {
                    width: 90px;
                    height: 52px;
                    object-fit: cover;
                    border-radius: 6px;
                    flex-shrink: 0;
                }
                @media (min-width: 600px) {
                    .search-item {
                        gap: 1rem;
                        padding: 1rem;
                    }
                    .search-thumb {
                        width: 120px;
                        height: 67px;
                        border-radius: 8px;
                    }
                }
            `}</style>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h2 style={{ fontSize: 'clamp(1.35rem, 4vw, 2rem)' }}>Search Music</h2>
                <button className="btn btn-ghost" onClick={onClose} style={{ padding: '0.5rem', minHeight: '36px' }}><X size={24} /></button>
            </div>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <input
                    className="input"
                    placeholder="Search songs, artists..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoFocus
                    style={{ fontSize: '1rem', padding: '0.75rem 1rem' }}
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '0 1.25rem', flexShrink: 0 }}>
                    {loading ? '...' : <Search size={20} />}
                </button>
            </form>

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {results.map(video => (
                    <div key={video.id} className="glass-card search-item">
                        <img
                            src={video.thumbnail}
                            alt={video.title}
                            className="search-thumb"
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ margin: '0 0 0.2rem 0', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {video.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}
                            </h3>
                            <p className="text-muted" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{video.channel}</p>
                        </div>
                        <button
                            className="btn btn-primary"
                            style={{ padding: '0.4rem 0.8rem', minHeight: '36px', fontSize: '0.85rem', flexShrink: 0 }}
                            onClick={() => {
                                onAddParams(video)
                            }}
                        >
                            <Plus size={16} /> Add
                        </button>
                    </div>
                ))}
            </div>
        </div>
    )
}
