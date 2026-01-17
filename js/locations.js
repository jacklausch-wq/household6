// Saved Locations Module
const Locations = {
    locations: [],
    unsubscribe: null,

    // Subscribe to real-time location updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('locations')
            .orderBy('name')
            .onSnapshot((snapshot) => {
                this.locations = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.locations);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Add a new saved location
    async add(name, address) {
        if (!Household.currentHousehold) throw new Error('No household');

        // Generate keywords for matching
        const keywords = this.generateKeywords(name);

        const locationData = {
            name,
            address,
            keywords,
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('locations')
            .add(locationData);

        return { id: docRef.id, ...locationData };
    },

    // Generate keywords from location name for fuzzy matching
    generateKeywords(name) {
        const words = name.toLowerCase().split(/\s+/);
        const keywords = [...words];

        // Add full name as keyword
        keywords.push(name.toLowerCase());

        // Add without possessives
        words.forEach(word => {
            if (word.endsWith("'s")) {
                keywords.push(word.slice(0, -2));
            }
        });

        return [...new Set(keywords)];
    },

    // Update a saved location
    async update(locationId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        if (updates.name) {
            updates.keywords = this.generateKeywords(updates.name);
        }

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('locations')
            .doc(locationId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete a saved location
    async delete(locationId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('locations')
            .doc(locationId)
            .delete();
    },

    // Find location by keyword (for voice matching)
    findByKeyword(keyword) {
        const lowerKeyword = keyword.toLowerCase();

        // First try exact name match
        let match = this.locations.find(loc =>
            loc.name.toLowerCase() === lowerKeyword
        );

        if (match) return match;

        // Try keyword match
        match = this.locations.find(loc =>
            loc.keywords?.some(kw => kw === lowerKeyword)
        );

        if (match) return match;

        // Try partial match
        match = this.locations.find(loc =>
            loc.name.toLowerCase().includes(lowerKeyword) ||
            loc.keywords?.some(kw => kw.includes(lowerKeyword))
        );

        return match || null;
    },

    // Get location by ID
    getById(locationId) {
        return this.locations.find(loc => loc.id === locationId);
    },

    // Get all locations
    getAll() {
        return this.locations;
    }
};

window.Locations = Locations;
