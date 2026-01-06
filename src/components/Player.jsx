import React, { useRef, useEffect } from 'react'
import ReactPlayer from 'react-player/youtube'

const Player = ({ url, isPlaying, onProgress, onDuration, onBuffer, onEnded, onReady, onPlay, onPause, onSeek, playerRef }) => {
    return (
        <div style={{
            position: 'relative',
            paddingTop: '56.25%', /* 16:9 Aspect Ratio */
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            background: 'black',
            boxShadow: '0 10px 30px -5px rgba(0,0,0,0.5)'
        }}>
            <ReactPlayer
                ref={playerRef}
                url={url}
                playing={isPlaying}
                controls={true}
                width='100%'
                height='100%'
                style={{ position: 'absolute', top: 0, left: 0 }}
                onProgress={onProgress}
                onDuration={onDuration}
                onBuffer={onBuffer}
                onEnded={onEnded}
                onReady={onReady}
                onPlay={onPlay}
                onPause={onPause}
                onSeek={onSeek}
                config={{
                    youtube: {
                        playerVars: {
                            showinfo: 1,
                            autoplay: 1,
                            controls: 1,
                            origin: window.location.origin,
                            widget_referrer: window.location.origin,
                            enablejsapi: 1,
                            rel: 0,
                            modestbranding: 1,
                        },
                        attributes: {
                            referrerPolicy: 'strict-origin-when-cross-origin'
                        }
                    }
                }}
            />
        </div>
    )
}

export default Player
