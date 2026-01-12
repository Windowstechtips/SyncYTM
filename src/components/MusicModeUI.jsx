import React, { useState, useRef } from 'react'
import { Disc, SkipBack, SkipForward, Play, Pause, Maximize2 } from 'lucide-react'

export default function MusicModeUI({
    currentVideo,
    isPlaying,
    progress = 0,
    duration = 0,
    onPlayPause,
    onNext,
    onPrev,
    onSeek,
    onExit,
    className
}) {
    const [isSeeking, setIsSeeking] = useState(false)
    const [seekPosition, setSeekPosition] = useState(0)
    const progressBarRef = useRef(null)

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00'
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const handleProgressClick = (e) => {
        if (!duration || !onSeek) return

        const rect = progressBarRef.current.getBoundingClientRect()
        const clickX = e.clientX - rect.left
        const percentage = clickX / rect.width
        const newTime = percentage * duration

        onSeek(newTime)
    }

    const handleProgressMouseDown = (e) => {
        setIsSeeking(true)
        handleProgressMove(e)
    }

    const handleProgressMove = (e) => {
        if (!duration) return

        const rect = progressBarRef.current.getBoundingClientRect()
        const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
        const percentage = clickX / rect.width
        const newTime = percentage * duration

        if (isSeeking) {
            setSeekPosition(newTime)
        }
    }

    const handleProgressMouseUp = (e) => {
        if (isSeeking && onSeek) {
            handleProgressMove(e)
            const rect = progressBarRef.current.getBoundingClientRect()
            const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
            const percentage = clickX / rect.width
            const newTime = percentage * duration

            onSeek(newTime)
        }
        setIsSeeking(false)
    }

    React.useEffect(() => {
        if (isSeeking) {
            const handleMouseUp = () => setIsSeeking(false)
            window.addEventListener('mouseup', handleMouseUp)
            return () => window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isSeeking])

    const currentProgress = isSeeking ? seekPosition : progress
    const progressPercentage = duration > 0 ? (currentProgress / duration) * 100 : 0

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
                        <img src={currentVideo.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt={currentVideo.title} />
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

                {/* Progress Bar */}
                {currentVideo && (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div
                            ref={progressBarRef}
                            onClick={handleProgressClick}
                            onMouseDown={handleProgressMouseDown}
                            onMouseMove={isSeeking ? handleProgressMove : undefined}
                            onMouseUp={handleProgressMouseUp}
                            style={{
                                width: '100%',
                                height: '6px',
                                background: 'hsla(var(--surface)/0.5)',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                position: 'relative',
                                overflow: 'visible'
                            }}
                        >
                            {/* Progress Fill */}
                            <div
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    height: '100%',
                                    width: `${progressPercentage}%`,
                                    background: 'hsl(var(--primary))',
                                    borderRadius: '3px',
                                    transition: isSeeking ? 'none' : 'width 0.1s linear'
                                }}
                            />
                            {/* Seek Handle */}
                            <div
                                style={{
                                    position: 'absolute',
                                    left: `${progressPercentage}%`,
                                    top: '50%',
                                    transform: 'translate(-50%, -50%)',
                                    width: isSeeking ? '16px' : '12px',
                                    height: isSeeking ? '16px' : '12px',
                                    background: 'white',
                                    borderRadius: '50%',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                    transition: isSeeking ? 'none' : 'all 0.1s ease',
                                    cursor: 'grab'
                                }}
                            />
                        </div>

                        {/* Time Display */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', opacity: 0.7 }}>
                            <span>{formatTime(currentProgress)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>
                )}

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
