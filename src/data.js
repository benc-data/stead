import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, getRedirectResult, GoogleAuthProvider, onAuthStateChanged,
  signInWithPopup, signInWithRedirect, signOut,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { firebaseConfig } from './firebase-config.js';

export const emulator = import.meta.env.VITE_USE_EMULATORS === 'true';
export const isDemo = import.meta.env.DEV && !emulator && !new URLSearchParams(location.search).has('live');
export const app = initializeApp(emulator || isDemo ? {
  projectId: 'demo-stead', apiKey: 'demo-key', authDomain: 'demo-stead.firebaseapp.com',
} : firebaseConfig);
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
if (emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
}

export function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (location.hostname === firebaseConfig.authDomain) {
    sessionStorage.setItem('stead-google-redirect', 'pending');
    return signInWithRedirect(auth, provider, browserPopupRedirectResolver);
  }
  return signInWithPopup(auth, provider, browserPopupRedirectResolver);
}
export const logout = () => signOut(auth);

export function useSession() {
  const [session, setSession] = useState({ status: 'loading' });
  useEffect(() => {
    if (isDemo) return;
    let active = true;
    let stopAuth;
    let stopAllowlist;
    const start = () => {
      let loginError;
      let redirectPending = false;
      try { redirectPending = sessionStorage.getItem('stead-google-redirect') === 'pending'; } catch {}
      if (redirectPending) {
        getRedirectResult(auth, browserPopupRedirectResolver).catch((error) => {
          loginError = error.code === 'auth/operation-not-allowed'
            ? 'Google sign-in needs to be enabled in Firebase Authentication.'
            : 'Google sign-in could not finish. Please try again.';
          if (active && !auth.currentUser) setSession({ status: 'signed-out', loginError });
        }).finally(() => { try { sessionStorage.removeItem('stead-google-redirect'); } catch {} });
      }
      let revision = 0;
      stopAuth = onAuthStateChanged(auth, async (user) => {
        const request = ++revision;
        stopAllowlist?.();
        if (!user) return setSession({ status: 'signed-out', loginError });
        if (!user.emailVerified) return setSession({ status: 'denied' });
        try {
          const { subscribeToAllowlist } = await import('./firestore-client.js');
          if (!active || request !== revision) return;
          stopAllowlist = subscribeToAllowlist(user.email, (role) => {
            setSession({ status: 'ready', profile: { email: user.email, role }, uid: user.uid });
          }, (error) => setSession({ status: error.code === 'permission-denied' ? 'denied' : 'error' }));
        } catch {
          if (active && request === revision) setSession({ status: 'error' });
        }
      });
    };
    start();
    return () => { active = false; stopAuth?.(); stopAllowlist?.(); };
  }, []);
  return session;
}
