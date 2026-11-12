import { connectFirestoreEmulator, doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { app, emulator } from './data.js';

export const db = getFirestore(app);
if (emulator) connectFirestoreEmulator(db, '127.0.0.1', 8080);

export function subscribeToAllowlist(email, onAllow, onError) {
  return onSnapshot(doc(db, 'settings', 'household'), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.fromCache) return;
    const household = snapshot.data();
    if (email !== household?.primaryEmail && email !== household?.spouseEmail) {
      onError({ code: 'permission-denied' });
      return;
    }
    onAllow(email === household.primaryEmail ? 'primary' : 'spouse');
  }, onError);
}
