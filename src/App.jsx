import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Auth from './pages/Auth';
import Home from './pages/Home';
import Room from './pages/Room';
import Landing from './pages/Landing';

function App() {
    return (
        <AuthProvider>
            <div className="app-container">
                <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/auth" element={<Auth />} />
                    <Route path="/dashboard" element={
                        <ProtectedRoute>
                            <Home />
                        </ProtectedRoute>
                    } />
                    <Route path="/room/:id" element={<ProtectedRoute><Room /></ProtectedRoute>} />
                </Routes>
            </div>
        </AuthProvider>
    );
}

export default App;
