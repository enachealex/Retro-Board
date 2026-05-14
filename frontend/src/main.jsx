import React, { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import LoginPage from './LoginPage.jsx'
import RegisterPage from './RegisterPage.jsx'
import { initConnection } from './config.js'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '50px', color: 'red', backgroundColor: '#fee', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Root Level Render Error</h2>
          <p style={{ fontWeight: 'bold' }}>{this.state.error && this.state.error.toString()}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: '14px', background: '#fff', padding: '20px', border: '1px solid #fcc' }}>
            {this.state.error && this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthGate() {
  const { isAuthenticated, token } = useAuth();
  const [view, setView] = useState('login'); // 'login' | 'register'

  useEffect(() => {
    document.title = 'Vault Jump Retro';
  }, []);

  // Reveal the root div now that React has determined what to show
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.style.visibility = 'visible';
  }, []);

  // Always return to login screen when the user signs out
  useEffect(() => {
    if (!isAuthenticated && !token) setView('login');
  }, [isAuthenticated, token]);

  // Trust the token from localStorage — if it exists, show the app immediately.
  // The background /me check will kick back to login if it's actually expired.
  if (token) {
    return <App />;
  }

  if (view === 'register') {
    return <RegisterPage onGoToLogin={() => setView('login')} />;
  }
  return <LoginPage onGoToRegister={() => setView('register')} />;
}

// Render immediately — don't block on server detection.
// initConnection runs in parallel and updates the resolved URL;
// the first API call will use the correct URL.
initConnection();
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)

