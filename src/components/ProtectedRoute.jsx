import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requireFullAccount = false }) {
    const { user, isGuest } = useAuth();

    if (!user) {
        return <Navigate to="/auth" replace />;
    }

    // Some routes (e.g. /dashboard create-room action) require a full account
    if (requireFullAccount && isGuest) {
        return <Navigate to="/auth" replace />;
    }

    return children;
}
