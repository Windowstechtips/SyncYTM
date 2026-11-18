import React, { useRef, useEffect } from 'react'
import ReactPlayer from 'react-player/youtube'

const Player = ({
    url,
    isPlaying,
    onProgress,
    onDuration,
    onBuffer,
    onBufferEnd,
    onEnded,
    onReady,
    onPlay,
    onPause,
    onSeek,
    playerRef,
    onIframeClick
}) => {
    const containerRef = useRef(null)
    const isOverPlayerRef = useRef(false)

    useEffect(() => {
        const handleBlur = () => {
            // When the user clicks inside an iframe, the parent window loses focus (blur event).
            // We verify that the user was either hovering/interacting with the player container,
            // or the newly focused element is an iframe within our container.
            const activeEl = document.activeElement
            const isPlayerIframe = activeEl?.tagName === 'IFRAME' && containerRef.current?.contains(activeEl)
            if (isOverPlayerRef.current || isPlayerIframe) {
                console.log('[Player] Detected user click on YouTube iframe -> triggering sync')
                if (onIframeClick) {
                    onIframeClick()
                }
            }
        }

        window.addEventListener('blur', handleBlur)
        return () => {
            window.removeEventListener('blur', handleBlur)
        }
    }, [onIframeClick])

    return (
        <div
            ref={containerRef}
            onMouseEnter={() => { isOverPlayerRef.current = true }}
            onMouseLeave={() => { isOverPlayerRef.current = false }}
            onPointerEnter={() => { isOverPlayerRef.current = true }}
            onPointerLeave={() => { isOverPlayerRef.current = false }}
            onTouchStart={() => { isOverPlayerRef.current = true }}
            onClick={() => {
                if (onIframeClick) {
                    onIframeClick()
                }
            }}
            style={{
                position: 'relative',
                paddingTop: '56.25%', /* 16:9 Aspect Ratio */
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                background: 'black',
                boxShadow: '0 10px 30px -5px rgba(0,0,0,0.5)'
            }}
        >
            <ReactPlayer
                ref={playerRef}
                url={url}
                playing={isPlaying}
                controls={true}
                width='100%'
                height='100%'
                style={{ position: 'absolute', top: 0, left: 0 }}
                progressInterval={500}
                onProgress={onProgress}
                onDuration={onDuration}
                onBuffer={onBuffer}
                onBufferEnd={onBufferEnd}
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
                            referrerPolicy: 'no-referrer-when-downgrade'
                        }
                    }
                }}
            />
        </div>
    )
}

export default Player
