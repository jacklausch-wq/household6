// Agenda Module - Household Meeting Agenda Management
const Agenda = {
    items: [],
    unsubscribe: null,

    // Subscribe to real-time agenda updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('agenda')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                this.items = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.items);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Create a new agenda item
    async create(itemData) {
        if (!Household.currentHousehold) throw new Error('No household');

        const item = {
            topic: itemData.topic,
            description: itemData.description || '',
            priority: itemData.priority || 'normal',
            resolved: false,
            addedBy: Auth.currentUser.uid,
            addedByName: Auth.currentUser.displayName || 'Unknown',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('agenda')
            .add(item);

        return { id: docRef.id, ...item };
    },

    // Update an agenda item
    async update(itemId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('agenda')
            .doc(itemId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete an agenda item
    async delete(itemId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('agenda')
            .doc(itemId)
            .delete();
    },

    // Toggle resolved status
    async toggleResolved(itemId) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error('Item not found');

        await this.update(itemId, {
            resolved: !item.resolved,
            resolvedAt: !item.resolved ? firebase.firestore.FieldValue.serverTimestamp() : null
        });
        return { ...item, resolved: !item.resolved };
    },

    // Get pending (unresolved) items sorted by priority
    getPending() {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        return this.items
            .filter(item => !item.resolved)
            .sort((a, b) => {
                // First by priority
                const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
                if (priorityDiff !== 0) return priorityDiff;
                // Then by date (newest first)
                return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
            });
    },

    // Get resolved items
    getResolved() {
        return this.items
            .filter(item => item.resolved)
            .sort((a, b) => (b.resolvedAt?.toMillis() || 0) - (a.resolvedAt?.toMillis() || 0));
    },

    // Clear all resolved items
    async clearResolved() {
        if (!Household.currentHousehold) throw new Error('No household');

        const resolved = this.getResolved();
        const batch = db.batch();

        resolved.forEach(item => {
            const ref = db.collection('households')
                .doc(Household.currentHousehold.id)
                .collection('agenda')
                .doc(item.id);
            batch.delete(ref);
        });

        await batch.commit();
    },

    // Get item by ID
    getById(itemId) {
        return this.items.find(item => item.id === itemId);
    },

    // Get count of pending items (for badge)
    getPendingCount() {
        return this.items.filter(item => !item.resolved).length;
    },

    // Get high priority items count
    getHighPriorityCount() {
        return this.items.filter(item => !item.resolved && item.priority === 'high').length;
    },

    // Format date for display
    formatDate(timestamp) {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diff = now - date;

        // Less than 24 hours
        if (diff < 86400000) {
            if (diff < 3600000) {
                const minutes = Math.floor(diff / 60000);
                return minutes <= 1 ? 'Just now' : `${minutes}m ago`;
            }
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        }

        // Less than 7 days
        if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return `${days}d ago`;
        }

        // Show date
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
};

window.Agenda = Agenda;
