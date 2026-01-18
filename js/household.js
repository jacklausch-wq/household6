// Household Management Module
const Household = {
    currentHousehold: null,
    members: [],

    // Generate a random invite code
    generateInviteCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    },

    // Create a new household
    async create(name = 'My Household') {
        if (!Auth.currentUser) throw new Error('Not authenticated');

        const inviteCode = this.generateInviteCode();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const householdData = {
            name,
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            inviteCode,
            inviteCodeExpiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
            members: [Auth.currentUser.uid],
            selectedCalendarId: null
        };

        const docRef = await db.collection('households').add(householdData);

        // Update user's household reference
        await Auth.updateUserProfile({ householdId: docRef.id });
        localStorage.setItem('householdId', docRef.id);

        this.currentHousehold = { id: docRef.id, ...householdData };
        return this.currentHousehold;
    },

    // Join an existing household with invite code
    async join(inviteCode) {
        if (!Auth.currentUser) throw new Error('Not authenticated');

        // Rate limit invite code attempts to prevent brute-force attacks
        const rateLimitKey = `invite_${Auth.currentUser.uid}`;
        if (typeof Security !== 'undefined' && Security.rateLimiter) {
            if (!Security.rateLimiter.check(rateLimitKey, 5, 60000)) {
                const waitTime = Math.ceil(Security.rateLimiter.getWaitTime(rateLimitKey, 60000) / 1000);
                throw new Error(`Too many attempts. Please wait ${waitTime} seconds.`);
            }
        }

        // Find household with this invite code
        const snapshot = await db.collection('households')
            .where('inviteCode', '==', inviteCode.toUpperCase())
            .get();

        if (snapshot.empty) {
            throw new Error('Invalid invite code');
        }

        const householdDoc = snapshot.docs[0];
        const householdData = householdDoc.data();

        // Check if code is expired
        if (householdData.inviteCodeExpiresAt.toDate() < new Date()) {
            throw new Error('Invite code has expired');
        }

        // Check if already a member
        if (householdData.members.includes(Auth.currentUser.uid)) {
            throw new Error('You are already a member of this household');
        }

        // Add user to household
        await db.collection('households').doc(householdDoc.id).update({
            members: firebase.firestore.FieldValue.arrayUnion(Auth.currentUser.uid)
        });

        // Update user's household reference
        await Auth.updateUserProfile({ householdId: householdDoc.id });
        localStorage.setItem('householdId', householdDoc.id);

        // Reset rate limit on successful join
        if (typeof Security !== 'undefined' && Security.rateLimiter) {
            Security.rateLimiter.reset(`invite_${Auth.currentUser.uid}`);
        }

        this.currentHousehold = { id: householdDoc.id, ...householdData };
        return this.currentHousehold;
    },

    // Load current household
    async load() {
        if (!Auth.currentUser) return null;

        const userData = await Auth.getUserData();
        if (!userData?.householdId) return null;

        const doc = await db.collection('households').doc(userData.householdId).get();
        if (!doc.exists) return null;

        this.currentHousehold = { id: doc.id, ...doc.data() };
        localStorage.setItem('householdId', doc.id);

        await this.loadMembers();
        return this.currentHousehold;
    },

    // Load household members
    async loadMembers() {
        if (!this.currentHousehold) return [];

        const memberPromises = this.currentHousehold.members.map(async (uid) => {
            const doc = await db.collection('users').doc(uid).get();
            return doc.exists ? { uid, ...doc.data() } : null;
        });

        this.members = (await Promise.all(memberPromises)).filter(Boolean);
        return this.members;
    },

    // Refresh invite code
    async refreshInviteCode() {
        if (!this.currentHousehold) throw new Error('No household');

        const inviteCode = this.generateInviteCode();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await db.collection('households').doc(this.currentHousehold.id).update({
            inviteCode,
            inviteCodeExpiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
        });

        this.currentHousehold.inviteCode = inviteCode;
        this.currentHousehold.inviteCodeExpiresAt = firebase.firestore.Timestamp.fromDate(expiresAt);

        return inviteCode;
    },

    // Update household settings
    async update(data) {
        if (!this.currentHousehold) throw new Error('No household');

        await db.collection('households').doc(this.currentHousehold.id).update({
            ...data,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        Object.assign(this.currentHousehold, data);
        return this.currentHousehold;
    },

    // Leave household
    async leave() {
        if (!this.currentHousehold || !Auth.currentUser) return;

        await db.collection('households').doc(this.currentHousehold.id).update({
            members: firebase.firestore.FieldValue.arrayRemove(Auth.currentUser.uid)
        });

        await Auth.updateUserProfile({ householdId: null });
        localStorage.removeItem('householdId');

        this.currentHousehold = null;
        this.members = [];
    },

    // Get member by UID
    getMember(uid) {
        return this.members.find(m => m.uid === uid);
    },

    // Get member display name
    getMemberName(uid) {
        const member = this.getMember(uid);
        return member?.displayName || 'Unknown';
    }
};

window.Household = Household;
