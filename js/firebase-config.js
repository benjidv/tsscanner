// Firebase SDK (CDN compat modules)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// *** PASTE YOUR FIREBASE CONFIG HERE ***
const firebaseConfig = {
  apiKey: "AIzaSyDys1cE_YELAieOx9VOeuIeZzHJ5OUNl_8",

  authDomain: "scanner-3c9df.firebaseapp.com",

  projectId: "scanner-3c9df",

  storageBucket: "scanner-3c9df.firebasestorage.app",

  messagingSenderId: "791070221979",

  appId: "1:791070221979:web:13bbd6bf7cd0d2366f083e",

  measurementId: "G-3RXRC1QL44"

};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const analytics = getAnalytics(app);


export { db };
