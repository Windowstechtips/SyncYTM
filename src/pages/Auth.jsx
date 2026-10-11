import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { UserRound } from 'lucide-react';

export default function Auth() {
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');

    // Guest mode state
    const [showGuestInput, setShowGuestInput] = useState(false);
    const [guestName, setGuestName] = useState('');

    const { signIn, signUp, continueAsGuest } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        let error = null;

        if (isLogin) {
            const { error: signInError } = await signIn(email, password);
            error = signInError;
        } else {
            const { error: signUpError } = await signUp(email, password, username);
            error = signUpError;
        }

        if (error) {
            alert(error.message);
        } else {
            navigate('/dashboard');
        }
        setLoading(false);
    };

    const handleGuestSubmit = (e) => {
        e.preventDefault();
        if (!guestName.trim()) return;
        continueAsGuest(guestName);
        navigate('/dashboard');
    };

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            minHeight: '100dvh',
            padding: '1rem',
            background: 'radial-gradient(circle at top right, hsl(var(--primary) / 0.2), transparent 40%)'
        }}>
            <div className="glass-card animate-fade-in" style={{ width: '100%', maxWidth: '400px' }}>
                <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', fontSize: '2rem', fontWeight: '700' }}>
                    {isLogin ? 'Welcome Back' : 'Create Account'}
                </h2>

                {showGuestInput ? (
                    /* ── Guest name form ── */
                    <form onSubmit={handleGuestSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                            Pick a display name. Guest accounts can join rooms but cannot create them.
                        </p>
                        <input
                            className="input"
                            type="text"
                            placeholder="Display name"
                            value={guestName}
                            onChange={(e) => setGuestName(e.target.value)}
                            autoFocus
                            required
                            maxLength={32}
                        />
                        <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem' }}>
                            Continue as Guest
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setShowGuestInput(false)}
                            style={{ fontSize: '0.9rem' }}
                        >
                            ← Back to Sign In
                        </button>
                    </form>
                ) : (
                    /* ── Regular sign-in / sign-up form ── */
                    <>
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {!isLogin && (
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                            )}
                            <input
                                className="input"
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />
                            <input
                                className="input"
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />

                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={loading}
                                style={{ marginTop: '1rem' }}
                            >
                                {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
                            </button>
                        </form>

                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                            <button
                                className="btn btn-ghost"
                                onClick={() => setIsLogin(!isLogin)}
                                style={{ fontSize: '0.9rem' }}
                            >
                                {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                            </button>

                            {/* Divider */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', margin: '0.25rem 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'hsl(var(--border))' }} />
                                <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>or</span>
                                <div style={{ flex: 1, height: '1px', background: 'hsl(var(--border))' }} />
                            </div>

                            <button
                                className="btn btn-ghost"
                                onClick={() => setShowGuestInput(true)}
                                style={{
                                    fontSize: '0.9rem',
                                    border: '1px solid hsl(var(--border))',
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '0.5rem'
                                }}
                            >
                                <UserRound size={16} />
                                Continue as Guest
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
