// Authentication Module
const Auth = {
    currentUser: null,
    accessToken: null,

    // Initialize auth state listener
    init() {
        return new Promise((resolve) => {
            auth.onAuthStateChanged(async (user) => {
                if (user) {
                    this.currentUser = user;
                    // Get the access token for Google Calendar API
                    const credential = await user.getIdTokenResult();
                    this.accessToken = localStorage.getItem('googleAccessToken');
                    resolve(user);
                } else {
                    this.currentUser = null;
                    this.accessToken = null;
                    resolve(null);
                }
            });
        });
    },

    // Sign in with Google
    async signIn() {
        try {
            // Create a FRESH provider instance every time (fixes scope issues)
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.addScope('https://www.googleapis.com/auth/calendar');
            provider.addScope('https://www.googleapis.com/auth/calendar.events');
            provider.setCustomParameters({
                prompt: 'consent',
                access_type: 'offline'
            });

            const result = await auth.signInWithPopup(provider);
            // Get the OAuth access token from the credential
            const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
            if (credential && credential.accessToken) {
                this.accessToken = credential.accessToken;
                localStorage.setItem('googleAccessToken', this.accessToken);
                console.log('Access token obtained successfully');
            } else if (result.credential && result.credential.accessToken) {
                // Fallback for older Firebase versions
                this.accessToken = result.credential.accessToken;
                localStorage.setItem('googleAccessToken', this.accessToken);
                console.log('Access token obtained (fallback)');
            } else {
                console.warn('No access token in credential - calendar sync may not work');
            }
            return result.user;
        } catch (error) {
            console.error('Sign in error:', error);
            throw error;
        }
    },

    // Sign out
    async signOut() {
        try {
            await auth.signOut();
            localStorage.removeItem('googleAccessToken');
            localStorage.removeItem('householdId');
            this.currentUser = null;
            this.accessToken = null;
        } catch (error) {
            console.error('Sign out error:', error);
            throw error;
        }
    },

    // Get current user data from Firestore
    async getUserData() {
        if (!this.currentUser) return null;

        const doc = await db.collection('users').doc(this.currentUser.uid).get();
        return doc.exists ? doc.data() : null;
    },

    // Create or update user profile in Firestore
    async updateUserProfile(data = {}) {
        if (!this.currentUser) return;

        const userData = {
            uid: this.currentUser.uid,
            email: this.currentUser.email,
            displayName: this.currentUser.displayName,
            photoURL: this.currentUser.photoURL,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...data
        };

        await db.collection('users').doc(this.currentUser.uid).set(userData, { merge: true });
        return userData;
    },

    // Refresh Google access token
    async refreshAccessToken() {
        try {
            // Create a FRESH provider instance every time
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.addScope('https://www.googleapis.com/auth/calendar');
            provider.addScope('https://www.googleapis.com/auth/calendar.events');
            provider.setCustomParameters({
                prompt: 'consent',
                access_type: 'offline'
            });

            const result = await auth.currentUser.reauthenticateWithPopup(provider);
            const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
            if (credential && credential.accessToken) {
                this.accessToken = credential.accessToken;
                localStorage.setItem('googleAccessToken', this.accessToken);
            } else if (result.credential && result.credential.accessToken) {
                this.accessToken = result.credential.accessToken;
                localStorage.setItem('googleAccessToken', this.accessToken);
            }
            return this.accessToken;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
    }
};

window.Auth = Auth;
