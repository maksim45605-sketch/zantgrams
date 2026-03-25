import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ZantGrams Firebase (provided by you)
export const firebaseConfig = {
  apiKey: "AIzaSyBqphYa6U73FoqREYeeT3z0xwUNmnvd1Yo",
  authDomain: "zantgramss.firebaseapp.com",
  projectId: "zantgramss",
  storageBucket: "zantgramss.firebasestorage.app",
  messagingSenderId: "51004241043",
  appId: "1:51004241043:web:ea771d801069ec3b6f0966",
  measurementId: "G-333P441X54"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Keep users signed in between reloads
setPersistence(auth, browserLocalPersistence).catch(() => {
  // ignore
});
