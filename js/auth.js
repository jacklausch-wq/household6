// Authentication Module
const Auth = {
    currentUser: null,
    accessToken: null,
    initResolved: false,
    calendarConnected: false,
    isConnectingCalendar: false, // Flag to prevent auth state disruption during calendar connect

    // Allowed emails - only these can access the app
    // Leave empty [] to allow anyone, or add specific emails
    ALLOWED_EMAILS: [
        // 'yourname@gmail.com',
        // 'spouse@gmail.com',
    ],

    // Check if email is authorized
    isEmailAllowed(email) {
        // If no allowlist configured, allow everyone
        if (this.ALLOWED_EMAILS.length === 0) return true;
        return this.ALLOWED_EMAILS.includes(email.toLowerCase());
    },

    // Check if Google provider is linked to the account
    isGoogleLinked() {
        if (!this.currentUser) return false;
        return this.currentUser.providerData.some(
            provider => provider.providerId === 'google.com'
        );
    },

    // Initialize auth state listener
    init() {
        return new Promise((resolve) => {
            let resolved = false;
            const resolveOnce = (value) => {
                if (!resolved) {
                    resolved = true;
                    this.initResolved = true;
                    resolve(value);
                }
            };

            auth.onAuthStateChanged(async (user) => {
                // If we're in the middle of connecting calendar, just update user reference
                // but don't trigger any redirects or state resets
                if (this.isConnectingCalendar) {
                    if (user) {
                        this.currentUser = user;
                        this.calendarConnected = this.isGoogleLinked();
                    }
                    return;
                }

                if (user) {
                    // Check if returning user is still allowed
                    if (!this.isEmailAllowed(user.email)) {
                        // User email no longer authorized
                        await auth.signOut();
                        this.currentUser = null;
                        this.accessToken = null;
                        resolveOnce(null);
                        return;
                    }

                    this.currentUser = user;

                    // Check if Google Calendar was previously connected
                    this.calendarConnected = this.isGoogleLinked();

                    // Try to restore access token from localStorage (survives app restarts)
                    this.accessToken = localStorage.getItem('googleAccessToken');

                    resolveOnce(user);
                } else {
                    this.currentUser = null;
                    this.accessToken = null;
                    this.calendarConnected = false;
                    resolveOnce(null);
                }
            });
        });
    },

    // Check if we have calendar access - NEVER triggers popup
    // Returns the token if we have one, null otherwise
    // User must manually click "Connect Calendar" to get a new token
    ensureCalendarAccess() {
        // Just return whatever token we have (or null)
        // We can't auto-refresh because popups get blocked when not from user click
        return this.accessToken;
    },

    // Sign in with email and password
    async signIn(email, password) {
        try {
            // Check if email is allowed before attempting sign in
            if (!this.isEmailAllowed(email)) {
                throw new Error('Access denied. Your email is not authorized to use this app.');
            }

            const result = await auth.signInWithEmailAndPassword(email, password);
            this.currentUser = result.user;
            return result.user;
        } catch (error) {
            // Translate Firebase error codes to user-friendly messages
            if (error.code === 'auth/user-not-found') {
                throw new Error('No account found with this email. Please sign up first.');
            } else if (error.code === 'auth/wrong-password') {
                throw new Error('Incorrect password. Please try again.');
            } else if (error.code === 'auth/invalid-email') {
                throw new Error('Please enter a valid email address.');
            } else if (error.code === 'auth/too-many-requests') {
                throw new Error('Too many failed attempts. Please try again later.');
            }
            throw error;
        }
    },

    // Sign up with email and password
    async signUp(email, password, displayName) {
        try {
            // Check if email is allowed
            if (!this.isEmailAllowed(email)) {
                throw new Error('Access denied. Your email is not authorized to use this app.');
            }

            const result = await auth.createUserWithEmailAndPassword(email, password);

            // Update profile with display name
            if (displayName) {
                await result.user.updateProfile({ displayName: displayName });
            }

            this.currentUser = result.user;
            return result.user;
        } catch (error) {
            // Translate Firebase error codes to user-friendly messages
            if (error.code === 'auth/email-already-in-use') {
                throw new Error('An account with this email already exists. Please sign in.');
            } else if (error.code === 'auth/invalid-email') {
                throw new Error('Please enter a valid email address.');
            } else if (error.code === 'auth/weak-password') {
                throw new Error('Password must be at least 6 characters long.');
            }
            throw error;
        }
    },

    // Send password reset email
    async sendPasswordReset(email) {
        try {
            await auth.sendPasswordResetEmail(email);
            return true;
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                throw new Error('No account found with this email.');
            } else if (error.code === 'auth/invalid-email') {
                throw new Error('Please enter a valid email address.');
            }
            throw error;
        }
    },

    // Connect Google Calendar (used after login, in Settings)
    // Uses signInWithPopup which is most reliable for getting OAuth tokens
    // The popup MUST be the first async operation after the click to avoid blocking
    async connectGoogleCalendar() {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/calendar');
        provider.addScope('https://www.googleapis.com/auth/calendar.events');
        provider.setCustomParameters({
            prompt: 'consent',
            access_type: 'offline'
        });

        // Set flag to prevent auth state changes from disrupting the app
        this.isConnectingCalendar = true;

        try {
            // Use signInWithPopup - this works even for email/password users
            // It will sign them in with Google (which is fine, we just need the token)
            const result = await auth.signInWithPopup(provider);
            const credential = firebase.auth.GoogleAuthProvider.credentialFromResult(result);

            // Extract token from result
            const token = credential?.accessToken || result?.credential?.accessToken;

            if (token) {
                this.accessToken = token;
                localStorage.setItem('googleAccessToken', token);
                this.calendarConnected = true;
                this.currentUser = result.user; // Update current user reference
                return token;
            }

            throw new Error('Could not get calendar access token');
        } catch (error) {
            if (error.code === 'auth/popup-blocked') {
                throw new Error('Popup was blocked. Please allow popups for this site and try again.');
            }
            if (error.code === 'auth/popup-closed-by-user') {
                throw new Error('Sign-in was cancelled.');
            }
            console.error('Calendar connection error:', error);
            throw error;
        } finally {
            // Always reset the flag
            this.isConnectingCalendar = false;
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

    // Refresh Google access token - just calls connectGoogleCalendar
    // This is called when an existing token expires
    async refreshAccessToken() {
        return this.connectGoogleCalendar();
    }
};

window.Auth = Auth;
