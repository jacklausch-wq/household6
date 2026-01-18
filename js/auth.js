// Authentication Module
const Auth = {
    currentUser: null,
    accessToken: null,

    // Allowed emails - only these can access the app
    // Leave empty [] to allow anyone, or add specific emails
    ALLOWED_EMAILS: [
        // 'yourname@gmail.com',
        // 'spouse@gmail.com',
    ],

    // Detect if running as iOS standalone PWA
    isIOSPWA() {
        return window.navigator.standalone === true ||
               (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches &&
                /iPhone|iPad|iPod/.test(navigator.userAgent));
    },

    // Check if email is authorized
    isEmailAllowed(email) {
        // If no allowlist configured, allow everyone
        if (this.ALLOWED_EMAILS.length === 0) return true;
        return this.ALLOWED_EMAILS.includes(email.toLowerCase());
    },

    // Initialize auth state listener
    init() {
        return new Promise((resolve) => {
            // Handle redirect result first (for iOS PWA)
            auth.getRedirectResult().then((result) => {
                if (result && result.user) {
                    // Check if email is allowed
                    if (!this.isEmailAllowed(result.user.email)) {
                        auth.signOut();
                        return;
                    }
                    // Get the OAuth access token from redirect result
                    const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
                    if (credential && credential.accessToken) {
                        this.accessToken = credential.accessToken;
                        sessionStorage.setItem('googleAccessToken', this.accessToken);
                    }
                }
            }).catch((error) => {
                // Redirect error - will be handled by onAuthStateChanged
                console.error('Redirect result error:', error);
            });

            auth.onAuthStateChanged(async (user) => {
                if (user) {
                    // Check if returning user is still allowed
                    if (!this.isEmailAllowed(user.email)) {
                        // User email no longer authorized
                        await auth.signOut();
                        this.currentUser = null;
                        this.accessToken = null;
                        resolve(null);
                        return;
                    }

                    this.currentUser = user;
                    // Get the access token for Google Calendar API
                    const credential = await user.getIdTokenResult();
                    this.accessToken = sessionStorage.getItem('googleAccessToken');
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

            // Use redirect for iOS PWA (popups don't work in standalone mode)
            if (this.isIOSPWA()) {
                await auth.signInWithRedirect(provider);
                // This won't return - page will redirect
                return null;
            }

            // Use popup for desktop/browser
            const result = await auth.signInWithPopup(provider);

            // Check if email is allowed
            if (!this.isEmailAllowed(result.user.email)) {
                await auth.signOut();
                throw new Error('Access denied. Your email is not authorized to use this app.');
            }

            // Get the OAuth access token from the credential
            const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);
            if (credential && credential.accessToken) {
                this.accessToken = credential.accessToken;
                sessionStorage.setItem('googleAccessToken', this.accessToken);
            } else if (result.credential && result.credential.accessToken) {
                // Fallback for older Firebase versions
                this.accessToken = result.credential.accessToken;
                sessionStorage.setItem('googleAccessToken', this.accessToken);
            }
            return result.user;
        } catch (error) {
            // If popup fails, try redirect as fallback
            if (error.code === 'auth/popup-blocked' ||
                error.code === 'auth/popup-closed-by-user' ||
                error.code === 'auth/internal-error') {
                const provider = new firebase.auth.GoogleAuthProvider();
                provider.addScope('https://www.googleapis.com/auth/calendar');
                provider.addScope('https://www.googleapis.com/auth/calendar.events');
                await auth.signInWithRedirect(provider);
                return null;
            }
            throw error;
        }
    },

    // Sign out
    async signOut() {
        try {
            await auth.signOut();
            sessionStorage.removeItem('googleAccessToken');
            localStorage.removeItem('householdId');
            this.currentUser = null;
            this.accessToken = null;
        } catch (error) {
            // Sign out error handled by throw
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
                sessionStorage.setItem('googleAccessToken', this.accessToken);
            } else if (result.credential && result.credential.accessToken) {
                this.accessToken = result.credential.accessToken;
                sessionStorage.setItem('googleAccessToken', this.accessToken);
            }
            return this.accessToken;
        } catch (error) {
            // Token refresh error handled by throw
            throw error;
        }
    }
};

window.Auth = Auth;
