// src/firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: "lavadevi-43a98.firebaseapp.com",
  projectId: "lavadevi-43a98",
  storageBucket: "lavadevi-43a98.firebasestorage.app",
  messagingSenderId: "855166865955",
  appId: "1:855166865955:web:45b60b5c81f5e5df905796"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);