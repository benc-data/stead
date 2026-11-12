import { lazy, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { isDemo, login, logout, useSession } from './data.js';
import { Brand } from './ui.jsx';
import './style.css';

const Dashboard = lazy(() => import('./dashboard.jsx'));

function GoogleIcon() {
  return <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#4285f4" d="M44 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11.2a9.6 9.6 0 0 1-4.2 6.3v5.2h6.7c3.9-3.6 6.3-8.9 6.3-15.2Z" />
    <path fill="#34a853" d="M24 45c5.6 0 10.3-1.9 13.7-5.3L31 34.5a12.5 12.5 0 0 1-18.6-6.6H5.5v5.3A21 21 0 0 0 24 45Z" />
    <path fill="#fbbc05" d="M12.4 27.9a12.6 12.6 0 0 1 0-7.8v-5.3H5.5a21 21 0 0 0 0 18.4l6.9-5.3Z" />
    <path fill="#ea4335" d="M24 11.3c3.1 0 5.9 1.1 8.1 3.2l6-5.9A20.2 20.2 0 0 0 24 3 21 21 0 0 0 5.5 14.8l6.9 5.3A12.4 12.4 0 0 1 24 11.3Z" />
  </svg>;
}

function SignIn({ session }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function connect() {
    setError('');
    setPending(true);
    try {
      await login();
    } catch (problem) {
      setError(problem.code === 'auth/operation-not-allowed'
        ? 'Google sign-in needs to be enabled in Firebase Authentication.'
        : 'Google sign-in could not finish. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return <main className="auth-screen">
    <div className="auth-card">
      <Brand />
      <div className="auth-badge"><LockKeyhole size={14} /> Private household workspace</div>
      <h1>Household budgeting</h1>
      {session.status === 'loading' ? <p role="status">Checking your session…</p> :
        session.status === 'denied' ? <><p>This Google account hasn’t been added to the household. Switch to an approved account.</p>
          <button className="button primary" onClick={() => logout()}>Switch account <ArrowRight size={17} /></button></> :
        session.status === 'error' ? <><p>Stead couldn’t load your household access. Try reloading.</p>
          <button className="button" onClick={() => location.reload()}>Reload</button></> :
          <><p>Sign in with an approved Google account to view your shared finances.</p>
            <button className="button google-button" onClick={connect} disabled={pending}><GoogleIcon /> {pending ? 'Connecting…' : 'Continue with Google'}</button></>}
      {(error || session.loginError) && <p className="notice error" role="alert">{error || session.loginError}</p>}
    </div>
  </main>;
}

function App() {
  const session = useSession();
  return isDemo || session.status === 'ready'
    ? <Suspense fallback={<SignIn session={{ status: 'loading' }} />}><Dashboard session={session} key={session.uid || 'demo'} /></Suspense>
    : <SignIn session={session} />;
}

createRoot(document.getElementById('root')).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
