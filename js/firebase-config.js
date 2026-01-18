// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyAxzXoHTqB0O0OBa_P14_YJGdGcWa6BCL4",
    authDomain: "household6-3dc14.firebaseapp.com",
    projectId: "household6-3dc14",
    storageBucket: "household6-3dc14.firebasestorage.app",
    messagingSenderId: "45342878370",
    appId: "1:45342878370:web:8f1e714f5e0984f55d45fb"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize services
const auth = firebase.auth();
const db = firebase.firestore();

// Export for use in other modules
// Note: GoogleAuthProvider is created fresh in auth.js for each sign-in
window.firebaseConfig = firebaseConfig;
window.auth = auth;
window.db = db;
