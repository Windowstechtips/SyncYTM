import React, { useState, useEffect } from 'react'
import { discordRPC } from '../services/discordRPC'
import { X, Eye, EyeOff, ShieldCheck, HelpCircle, Check, AlertCircle, RefreshCw, Radio } from 'lucide-react'

// Discord Logo SVG Component
export function DiscordIcon({ size = 20, color = 'currentColor', className = '' }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill={color}
            className={className}
            style={{ display: 'inline-block', verticalAlign: 'middle' }}
        >
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
    )
}

export default function DiscordRPCModal({ isOpen, onClose }) {
    const [state, setState] = useState(() => discordRPC.getState())
    const [token, setToken] = useState(state.token)
    const [applicationId, setApplicationId] = useState(state.applicationId)
    const [enabled, setEnabled] = useState(state.enabled)
    const [showToken, setShowToken] = useState(false)
    const [showGuide, setShowGuide] = useState(false)
    const [copySuccess, setCopySuccess] = useState(false)

    useEffect(() => {
        const unsubscribe = discordRPC.subscribe((newState) => {
            setState(newState)
            setToken(newState.token)
            setApplicationId(newState.applicationId)
            setEnabled(newState.enabled)
        })
        return unsubscribe
    }, [])

    if (!isOpen) return null

    const handleSaveAndConnect = (e) => {
        e.preventDefault()
        const trimmedToken = token.trim()
        const trimmedAppId = applicationId.trim()

        discordRPC.saveConfig({
            enabled: true,
            token: trimmedToken,
            applicationId: trimmedAppId
        })

        if (trimmedToken) {
            discordRPC.connect(trimmedToken, trimmedAppId)
        }
    }

    const handleDisconnect = () => {
        discordRPC.saveConfig({
            enabled: false
        })
        discordRPC.disconnect()
    }

    const handleToggleEnabled = (checked) => {
        setEnabled(checked)
        discordRPC.saveConfig({ enabled: checked })
        if (checked) {
            if (token.trim()) {
                discordRPC.connect(token.trim(), applicationId.trim())
            }
        } else {
            discordRPC.disconnect()
        }
    }

    const tokenSnippet = `(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()`

    const copySnippet = () => {
        navigator.clipboard.writeText(tokenSnippet)
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
    }

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 99999,
            padding: '1rem',
            boxSizing: 'border-box'
        }} onClick={onClose}>
            <div style={{
                backgroundColor: '#2b2d31',
                color: '#dbdee1',
                borderRadius: '12px',
                width: '100%',
                maxWidth: '520px',
                boxShadow: '0 12px 36px rgba(0,0,0,0.6)',
                border: '1px solid #3f4147',
                overflow: 'hidden',
                animation: 'modalSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }} onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div style={{
                    padding: '1.25rem 1.5rem',
                    background: 'linear-gradient(135deg, #5865F2 0%, #4752C4 100%)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{
                            background: 'rgba(255, 255, 255, 0.2)',
                            borderRadius: '8px',
                            padding: '0.5rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <DiscordIcon size={24} color="white" />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', color: 'white' }}>
                                Discord Rich Presence
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.9 }}>
                                Broadcast your playing song & room link on Discord
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            padding: '0.4rem',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0.85,
                            transition: 'opacity 0.15s'
                        }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '1.5rem', maxHeight: 'calc(80vh - 80px)', overflowY: 'auto' }}>
                    
                    {/* Status Card */}
                    <div style={{
                        backgroundColor: '#1e1f22',
                        borderRadius: '8px',
                        padding: '1rem',
                        marginBottom: '1.25rem',
                        border: '1px solid #35373c',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            {state.user ? (
                                <img
                                    src={state.user.avatar}
                                    alt={state.user.username}
                                    style={{
                                        width: '42px',
                                        height: '42px',
                                        borderRadius: '50%',
                                        border: '2px solid #23a55a'
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '50%',
                                    backgroundColor: '#35373c',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <DiscordIcon size={22} color="#949ba4" />
                                </div>
                            )}

                            <div>
                                <div style={{ fontWeight: '600', fontSize: '0.95rem', color: '#f2f3f5' }}>
                                    {state.user ? (state.user.globalName || state.user.username) : 'Discord Account'}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                                    {state.status === 'connected' && (
                                        <span style={{ color: '#23a55a', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#23a55a', display: 'inline-block' }} />
                                            Active • Showing Rich Presence
                                        </span>
                                    )}
                                    {state.status === 'connecting' && (
                                        <span style={{ color: '#f0b232', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <RefreshCw size={12} className="spin-animation" /> Connecting to Gateway...
                                        </span>
                                    )}
                                    {state.status === 'error' && (
                                        <span style={{ color: '#f23f43', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <AlertCircle size={12} /> {state.errorMessage || 'Connection failed'}
                                        </span>
                                    )}
                                    {state.status === 'disconnected' && (
                                        <span style={{ color: '#949ba4' }}>Not connected</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Enable Switch */}
                        <label style={{
                            position: 'relative',
                            display: 'inline-block',
                            width: '46px',
                            height: '26px',
                            cursor: 'pointer'
                        }}>
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={e => handleToggleEnabled(e.target.checked)}
                                style={{ opacity: 0, width: 0, height: 0 }}
                            />
                            <span style={{
                                position: 'absolute',
                                cursor: 'pointer',
                                top: 0, left: 0, right: 0, bottom: 0,
                                backgroundColor: enabled ? '#23a55a' : '#4e5058',
                                transition: '0.2s',
                                borderRadius: '34px'
                            }}>
                                <span style={{
                                    position: 'absolute',
                                    content: '""',
                                    height: '20px',
                                    width: '20px',
                                    left: enabled ? '23px' : '3px',
                                    bottom: '3px',
                                    backgroundColor: 'white',
                                    transition: '0.2s',
                                    borderRadius: '50%'
                                }} />
                            </span>
                        </label>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSaveAndConnect}>
                        {/* Token Input */}
                        <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '600', color: '#b5bac1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                    Discord User Token <span style={{ color: '#f23f43' }}>*</span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => setShowGuide(!showGuide)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: '#00a8fc',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '0.25rem',
                                        padding: 0
                                    }}
                                >
                                    <HelpCircle size={14} /> How to get token?
                                </button>
                            </div>

                            <div style={{ position: 'relative' }}>
                                <input
                                    type={showToken ? 'text' : 'password'}
                                    value={token}
                                    onChange={e => setToken(e.target.value)}
                                    placeholder="Enter your Discord user token"
                                    style={{
                                        width: '100%',
                                        padding: '0.65rem 2.75rem 0.65rem 0.85rem',
                                        backgroundColor: '#1e1f22',
                                        border: '1px solid #3f4147',
                                        borderRadius: '6px',
                                        color: '#f2f3f5',
                                        fontSize: '0.9rem',
                                        boxSizing: 'border-box',
                                        outline: 'none',
                                        fontFamily: showToken ? 'monospace' : 'inherit'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    style={{
                                        position: 'absolute',
                                        right: '0.65rem',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        color: '#949ba4',
                                        cursor: 'pointer',
                                        padding: '0.25rem'
                                    }}
                                >
                                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Guide Dropdown */}
                        {showGuide && (
                            <div style={{
                                backgroundColor: '#1e1f22',
                                borderRadius: '8px',
                                padding: '1rem',
                                marginBottom: '1.25rem',
                                border: '1px solid #35373c',
                                fontSize: '0.85rem',
                                lineHeight: '1.5',
                                color: '#dbdee1'
                            }}>
                                <div style={{ fontWeight: '600', color: '#f2f3f5', marginBottom: '0.4rem' }}>
                                    How to get your Discord token:
                                </div>
                                <ol style={{ margin: '0 0 0.75rem 1.25rem', padding: 0 }}>
                                    <li>Open Discord in your browser at <a href="https://discord.com/app" target="_blank" rel="noreferrer" style={{ color: '#00a8fc' }}>discord.com/app</a> and log in.</li>
                                    <li>Press <kbd style={{ background: '#2b2d31', padding: '1px 5px', borderRadius: '4px', border: '1px solid #4e5058' }}>Ctrl</kbd> + <kbd style={{ background: '#2b2d31', padding: '1px 5px', borderRadius: '4px', border: '1px solid #4e5058' }}>Shift</kbd> + <kbd style={{ background: '#2b2d31', padding: '1px 5px', borderRadius: '4px', border: '1px solid #4e5058' }}>I</kbd> (or <kbd style={{ background: '#2b2d31', padding: '1px 5px', borderRadius: '4px', border: '1px solid #4e5058' }}>F12</kbd>) to open DevTools.</li>
                                    <li>Go to the <strong>Console</strong> tab and paste the snippet below:</li>
                                </ol>

                                <div style={{ position: 'relative', marginBottom: '0.6rem' }}>
                                    <pre style={{
                                        background: '#111214',
                                        padding: '0.6rem 2.5rem 0.6rem 0.75rem',
                                        borderRadius: '6px',
                                        overflowX: 'auto',
                                        fontSize: '0.75rem',
                                        margin: 0,
                                        color: '#5865F2'
                                    }}>
                                        {tokenSnippet}
                                    </pre>
                                    <button
                                        type="button"
                                        onClick={copySnippet}
                                        style={{
                                            position: 'absolute',
                                            right: '0.4rem',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: '#2b2d31',
                                            border: '1px solid #3f4147',
                                            color: copySuccess ? '#23a55a' : '#dbdee1',
                                            borderRadius: '4px',
                                            padding: '0.25rem 0.5rem',
                                            fontSize: '0.72rem',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {copySuccess ? <Check size={12} /> : 'Copy'}
                                    </button>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: '#949ba4' }}>
                                    Press Enter in the Console, copy the token inside the quotes (without quotes), and paste it above.
                                </div>
                            </div>
                        )}

                        {/* Application ID (Optional) */}
                        <div style={{ marginBottom: '1.25rem' }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: '#b5bac1', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>
                                Discord Application ID <span style={{ color: '#949ba4', fontSize: '0.78rem', textTransform: 'none' }}>(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={applicationId}
                                onChange={e => setApplicationId(e.target.value)}
                                placeholder="e.g. 1200000000000000000 (Defaults to SyncYTM app)"
                                style={{
                                    width: '100%',
                                    padding: '0.65rem 0.85rem',
                                    backgroundColor: '#1e1f22',
                                    border: '1px solid #3f4147',
                                    borderRadius: '6px',
                                    color: '#f2f3f5',
                                    fontSize: '0.9rem',
                                    boxSizing: 'border-box',
                                    outline: 'none'
                                }}
                            />
                            <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: '#949ba4' }}>
                                If you have created a Discord Application in the Discord Developer Portal, paste its Client ID here for custom icons and verified buttons.
                            </p>
                        </div>

                        {/* Security Callout */}
                        <div style={{
                            display: 'flex',
                            gap: '0.6rem',
                            backgroundColor: 'rgba(88, 101, 242, 0.1)',
                            border: '1px solid rgba(88, 101, 242, 0.3)',
                            borderRadius: '8px',
                            padding: '0.75rem',
                            marginBottom: '1.25rem',
                            fontSize: '0.78rem',
                            color: '#c9cdfb',
                            alignItems: 'flex-start'
                        }}>
                            <ShieldCheck size={18} style={{ color: '#5865F2', flexShrink: 0, marginTop: '2px' }} />
                            <span>
                                <strong>Client-Side Privacy:</strong> Your token is saved only in your local browser storage. It connects directly to Discord Gateway from your device and is never sent to our servers.
                            </span>
                        </div>

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            {state.status === 'connected' && (
                                <button
                                    type="button"
                                    onClick={handleDisconnect}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        backgroundColor: '#da373c',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontWeight: '600',
                                        fontSize: '0.9rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Disconnect
                                </button>
                            )}

                            <button
                                type="submit"
                                style={{
                                    padding: '0.65rem 1.5rem',
                                    backgroundColor: '#5865F2',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    fontWeight: '600',
                                    fontSize: '0.9rem',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    transition: 'background-color 0.15s'
                                }}
                            >
                                <DiscordIcon size={18} color="white" />
                                {state.status === 'connected' ? 'Save & Update' : 'Connect & Enable'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
