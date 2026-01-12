import React from 'react'

export default function Footer() {
    return (
        <footer style={{
            padding: '2rem 1rem',
            textAlign: 'center',
            color: 'hsl(var(--text-muted))',
            fontSize: '0.85rem',
            marginTop: 'auto', // Pushes to bottom if in flex-col
            width: '100%',
            opacity: 0.7
        }}>
            <p>Made by <span style={{ color: 'hsl(var(--primary))' }}>WTTexe/jehan</span></p>
        </footer>
    )
}
