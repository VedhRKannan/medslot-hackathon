import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCJODkolN1kuV2EcJrK0IpE5ANmC0LP9tU",
  authDomain: "medslot-a4e5d.firebaseapp.com",
  projectId: "medslot-a4e5d",
  storageBucket: "medslot-a4e5d.firebasestorage.app",
  messagingSenderId: "1099047165072",
  appId: "1:1099047165072:web:590ff76f75cb7470cc8c15"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };