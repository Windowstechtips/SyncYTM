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

    // Refactored Drag Logic using Window Listeners
    const handleMouseDown = (e) => {
        if (!duration) return
        e.preventDefault() // Prevent text selection
        setIsSeeking(true)

        // Calculate initial position immediately
        updateSeekPosition(e.clientX)

        const onMouseMove = (moveEvent) => {
            updateSeekPosition(moveEvent.clientX)
        }

        const onMouseUp = (upEvent) => {
            // Commit the seek
            const finalTime = calculateTime(upEvent.clientX)
            if (onSeek) onSeek(finalTime)

            setIsSeeking(false)
            setSeekPosition(0) // Reset temp seek position (optional, or keep it)

            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }

    const calculateTime = (clientX) => {
        if (!progressBarRef.current) return 0
        const rect = progressBarRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
        const percentage = x / rect.width
        return percentage * duration
    }

    const updateSeekPosition = (clientX) => {
        const time = calculateTime(clientX)
        setSeekPosition(time)
    }

    // Remove old useEffect for mouseup since we handle it in handleMouseDown closure
    // React.useEffect(() => { ... }, [isSeeking])

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
                <div style={{ textAlign: 'center', width: '100%', overflow: 'hidden' }}>
                    <style>{`
                        @keyframes marquee {
                            0% { transform: translateX(0%); }
                            100% { transform: translateX(-50%); }
                        }
                        .scrolling-title {
                            display: inline-block;
                            padding-left: 100%;
                            animation: marquee 15s linear infinite;
                        }
                        .scrolling-title.static {
                            animation: none;
                            padding-left: 0;
                        }
                    `}</style>
                    <div style={{
                        width: '100%',
                        overflow: 'hidden',
                        position: 'relative',
                        WebkitMaskImage: 'linear-gradient(90deg, transparent, black 10%, black 90%, transparent)'
                    }}>
                        <h2
                            className={currentVideo && currentVideo.title.length > 30 ? 'scrolling-title' : 'scrolling-title static'}
                            style={{
                                fontSize: '1.5rem',
                                marginBottom: '0.25rem',
                                whiteSpace: 'nowrap',
                                fontWeight: 'bold',
                                display: 'inline-block'
                            }}
                        >
                            {currentVideo ? `${currentVideo.title}     ${currentVideo.title}` : 'No Video Playing'}
                        </h2>
                    </div>
                    <p className="text-muted" style={{ fontSize: '1rem', marginTop: '0.25rem' }}>
                        {currentVideo ? currentVideo.channel : 'Add songs to queue'}
                    </p>
                </div>

                {/* Progress Bar */}
                {currentVideo && (
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div
                            ref={progressBarRef}
                            onClick={handleProgressClick}
                            onMouseDown={handleMouseDown}
                            // onMouseMove and onMouseUp handled by window listeners initiated by onMouseDown
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
