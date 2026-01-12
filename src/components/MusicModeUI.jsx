import React from 'react'
import { Disc, SkipBack, SkipForward, Play, Pause, Maximize2 } from 'lucide-react'

export default function MusicModeUI({
    currentVideo,
    isPlaying,
    onPlayPause,
    onNext,
    onPrev,
    onExit,
    className
}) {
    return (
        <div
            className={`glass-card ${className || ''}`}
            style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                padding: '2rem', height: '100%', minHeight: '400px',
                background: 'linear-gradient(to bottom, hsl(var(--surface-hover)), hsl(var(--surface)))',
                border: '1px solid hsl(var(--border))',
                position: 'relative'
            }}
        >

            <div style={{ position: 'absolute', top: '1rem', right: '1rem' }}>
                <button className="btn btn-ghost" onClick={onExit} title="Switch to Video">
                    <Maximize2 size={20} />
                </button>
            </div>

            <div style={{ width: '100%', maxWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1.5rem', alignItems: 'center' }}>
                {/* Album Art */}
                <div style={{
                    width: '100%', aspectRatio: '1/1',
                    background: 'hsla(var(--surface)/0.5)',
                    borderRadius: 'var(--radius-lg)',
                    overflow: 'hidden',
                    boxShadow: '0 20px 40px -10px hsla(0,0%,0%,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative'
                }}>
                    {currentVideo ? (
                        <img src={currentVideo.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        <Disc size={64} style={{ opacity: 0.2 }} />
                    )}
                </div>

                {/* Metadata */}
                <div style={{ textAlign: 'center', width: '100%' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'bold' }}>
                        {currentVideo ? currentVideo.title : 'No Video Playing'}
                    </h2>
                    <p className="text-muted" style={{ fontSize: '1rem' }}>
                        {currentVideo ? currentVideo.channel : 'Add songs to queue'}
                    </p>
                </div>

                {/* Controls */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', marginTop: '1rem' }}>
                    <button className="btn btn-ghost" onClick={onPrev} disabled={!currentVideo}>
                        <SkipBack size={28} />
                    </button>

                    <button
                        onClick={onPlayPause}
                        className="btn btn-primary"
                        style={{
                            width: '64px', height: '64px', borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 0 20px hsla(var(--primary)/0.4)',
                            padding: 0
                        }}
                        disabled={!currentVideo}
                    >
                        {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: '4px' }} />}
                    </button>

                    <button className="btn btn-ghost" onClick={onNext} disabled={!currentVideo}>
                        <SkipForward size={28} />
                    </button>
                </div>
            </div>

        </div>
    )
}
