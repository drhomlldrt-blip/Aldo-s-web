// ============================================================
// CONFIGURACIÓN FIREBASE
// No modificar este archivo
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAXDYH2Fxc3-3k1zU-YVvFFqPpdvL4wlOY",
  authDomain: "gym-control-40a40.firebaseapp.com",
  projectId: "gym-control-40a40",
  storageBucket: "gym-control-40a40.firebasestorage.app",
  messagingSenderId: "715804426202",
  appId: "1:715804426202:web:e73704036043427062cae3"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
