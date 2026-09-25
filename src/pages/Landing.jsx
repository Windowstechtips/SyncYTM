
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Music, Zap, Users, Shield, Play } from 'lucide-react';

import { useAuth } from '../context/AuthContext';

export default function Landing() {
    const navigate = useNavigate();
    const { user } = useAuth();

    React.useEffect(() => {
        if (user) {
            navigate('/dashboard');
        }
    }, [user, navigate]);

    return (
        <div style={{ minHeight: '100vh', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
            <style>{`
                .landing-hero-actions {
                    display: flex;
                    gap: 1rem;
                    justify-content: center;
                    align-items: center;
                    flex-wrap: wrap;
                }
                @media (max-width: 640px) {
                    .landing-hero-actions {
                        flex-direction: column;
                        width: 100%;
                    }
                    .landing-hero-actions .btn {
                        width: 100%;
                        max-width: 320px;
                    }
                    .landing-nav-btns .btn {
                        padding: 0.5rem 0.8rem;
                        font-size: 0.875rem;
                    }
                }
            `}</style>

            {/* Navbar */}
            <nav className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.4rem', fontWeight: 'bold' }}>
                    <Music color="hsl(var(--primary))" size={26} />
                    <span>SyncYTM</span>
                </div>
                <div className="landing-nav-btns" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button className="btn btn-ghost" onClick={() => navigate('/auth')}>Log In</button>
                    <button className="btn btn-primary" onClick={() => navigate('/auth')}>Get Started</button>
                </div>
            </nav>

            {/* Hero Section */}
            <header className="container" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: '3rem 1rem 4rem' }}>
                <div className="animate-fade-in" style={{ width: '100%', maxWidth: '800px' }}>
                    <h1 style={{ fontSize: 'clamp(2.2rem, 7vw, 4.5rem)', lineHeight: 1.15, marginBottom: '1.5rem', fontWeight: 800 }}>
                        Experience Music <br />
                        <span style={{ color: 'hsl(var(--primary))', textShadow: '0 0 30px hsla(var(--primary)/0.4)' }}>Together, Anywhere.</span>
                    </h1>
                    <p className="text-muted" style={{ fontSize: 'clamp(1rem, 3vw, 1.25rem)', maxWidth: '600px', margin: '0 auto 2.5rem' }}>
                        Stream YouTube Music in perfect sync with friends. High quality audio, real-time chat, and seamless remote control.
                    </p>
                    <div className="landing-hero-actions">
                        <button className="btn btn-primary" style={{ padding: '0.9rem 2rem', fontSize: '1.05rem' }} onClick={() => navigate('/auth')}>
                            Start Listening Now <Play size={20} fill="currentColor" />
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '0.9rem 2rem', fontSize: '1.05rem', border: '1px solid hsl(var(--border))' }} onClick={() => document.getElementById('features').scrollIntoView({ behavior: 'smooth' })}>
                            Learn More
                        </button>
                    </div>
                </div>
            </header>

            {/* Features Grid */}
            <section id="features" style={{ background: 'hsl(var(--surface))', padding: '4rem 1rem' }}>
                <div className="container" style={{ padding: 0 }}>
                    <h2 style={{ textAlign: 'center', fontSize: 'clamp(1.75rem, 5vw, 2.5rem)', marginBottom: '2.5rem' }}>Why SyncYTM?</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '1.5rem' }}>
                        <FeatureCard
                            icon={<Zap size={32} color="hsl(var(--primary))" />}
                            title="Instant Sync"
                            desc="Playback synchronization ensures everyone hears the song at the exact same moment."
                        />
                        <FeatureCard
                            icon={<Users size={32} color="#00d4ff" />}
                            title="Interactive Rooms"
                            desc="Create rooms, manage queues, and chat in real-time. Grant remote control to friends easily."
                        />
                        <FeatureCard
                            icon={<Shield size={32} color="#00ff9d" />}
                            title="Private & Secure"
                            desc="Password-protect your rooms to keep your sessions exclusive. All data is encrypted and secured by Supabase"
                        />
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer style={{ padding: '2rem', textAlign: 'center', color: 'hsl(var(--text-muted))', borderTop: '1px solid hsl(var(--border))' }}>
                <p>&copy; {new Date().getFullYear()} SyncYTM. Built by WTTexe a Project by Jehan.</p>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, desc }) {
    return (
        <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', background: 'hsla(var(--background)/0.5)' }}>
            <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'hsla(var(--surface-hover))', borderRadius: '50%' }}>
                {icon}
            </div>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>{title}</h3>
            <p className="text-muted">{desc}</p>
        </div>
    )
}
