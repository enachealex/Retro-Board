import React, { StrictMode, useState, useEffect, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider, useAuth } from './AuthContext.jsx'
import { initConnection } from './config.js'
import { APP_NAME } from './branding.js'

const App = lazy(() => import('./App.jsx'))
const LoginPage = lazy(() => import('./LoginPage.jsx'))
const RegisterPage = lazy(() => import('./RegisterPage.jsx'))

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

function AuthLoading() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444' }}>
      Loading {APP_NAME}…
    </div>
  );
}

function AuthGate() {
  const { isAuthenticated, token } = useAuth();
  const [view, setView] = useState('login');

  useEffect(() => {
    document.title = APP_NAME;
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    if (root) root.style.visibility = 'visible';
  }, []);

  useEffect(() => {
    if (!isAuthenticated && !token) setView('login');
  }, [isAuthenticated, token]);

  if (token) {
    return (
      <Suspense fallback={<AuthLoading />}>
        <App />
      </Suspense>
    );
  }

  if (view === 'register') {
    return (
      <Suspense fallback={<AuthLoading />}>
        <RegisterPage onGoToLogin={() => setView('login')} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<AuthLoading />}>
      <LoginPage onGoToRegister={() => setView('register')} />
    </Suspense>
  );
}

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
