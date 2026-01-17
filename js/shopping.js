// Shopping List Module
const Shopping = {
    items: [],
    unsubscribe: null,

    // Subscribe to real-time shopping list updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('shopping')
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

    // Add item to shopping list
    async add(itemData) {
        if (!Household.currentHousehold) throw new Error('No household');

        // Handle string input (just the item name)
        if (typeof itemData === 'string') {
            itemData = { name: itemData };
        }

        const item = {
            name: itemData.name,
            quantity: itemData.quantity || null,
            unit: itemData.unit || null,
            category: itemData.category || this.guessCategory(itemData.name),
            notes: itemData.notes || null,
            checked: false,
            addedBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('shopping')
            .add(item);

        return { id: docRef.id, ...item };
    },

    // Add multiple items at once
    async addMultiple(items) {
        const results = [];
        for (const item of items) {
            const result = await this.add(item);
            results.push(result);
        }
        return results;
    },

    // Toggle item checked state
    async toggleChecked(itemId) {
        if (!Household.currentHousehold) throw new Error('No household');

        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error('Item not found');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('shopping')
            .doc(itemId)
            .update({
                checked: !item.checked,
                checkedAt: item.checked ? null : firebase.firestore.FieldValue.serverTimestamp(),
                checkedBy: item.checked ? null : Auth.currentUser.uid
            });

        return { ...item, checked: !item.checked };
    },

    // Update item
    async update(itemId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('shopping')
            .doc(itemId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete item
    async delete(itemId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('shopping')
            .doc(itemId)
            .delete();
    },

    // Clear all checked items
    async clearChecked() {
        if (!Household.currentHousehold) throw new Error('No household');

        const checked = this.items.filter(i => i.checked);
        const batch = db.batch();

        checked.forEach(item => {
            const ref = db.collection('households')
                .doc(Household.currentHousehold.id)
                .collection('shopping')
                .doc(item.id);
            batch.delete(ref);
        });

        await batch.commit();
        return checked.length;
    },

    // Get unchecked items
    getUnchecked() {
        return this.items.filter(i => !i.checked);
    },

    // Get checked items
    getChecked() {
        return this.items.filter(i => i.checked);
    },

    // Get items grouped by category
    getGroupedByCategory() {
        const unchecked = this.getUnchecked();
        const groups = {};

        unchecked.forEach(item => {
            const category = item.category || 'Other';
            if (!groups[category]) groups[category] = [];
            groups[category].push(item);
        });

        // Sort categories in a logical order
        const categoryOrder = [
            'Produce', 'Dairy', 'Meat', 'Seafood', 'Bakery',
            'Frozen', 'Pantry', 'Beverages', 'Snacks',
            'Household', 'Personal Care', 'Other'
        ];

        const sorted = {};
        categoryOrder.forEach(cat => {
            if (groups[cat]) sorted[cat] = groups[cat];
        });

        // Add any categories not in the order
        Object.keys(groups).forEach(cat => {
            if (!sorted[cat]) sorted[cat] = groups[cat];
        });

        return sorted;
    },

    // Guess category based on item name
    guessCategory(name) {
        const lowerName = name.toLowerCase();

        const categories = {
            'Produce': ['apple', 'banana', 'orange', 'lettuce', 'tomato', 'onion', 'potato', 'carrot', 'broccoli', 'spinach', 'fruit', 'vegetable', 'salad', 'avocado', 'pepper', 'garlic', 'lemon', 'lime', 'berry', 'grape', 'melon'],
            'Dairy': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'sour cream'],
            'Meat': ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'ham', 'steak', 'ground'],
            'Seafood': ['fish', 'salmon', 'shrimp', 'tuna', 'crab', 'lobster', 'tilapia'],
            'Bakery': ['bread', 'bagel', 'muffin', 'croissant', 'roll', 'bun', 'tortilla'],
            'Frozen': ['frozen', 'ice cream', 'pizza', 'fries'],
            'Pantry': ['rice', 'pasta', 'cereal', 'flour', 'sugar', 'oil', 'sauce', 'soup', 'can', 'bean', 'spice', 'salt', 'pepper', 'paprika', 'cinnamon', 'vanilla', 'honey', 'syrup', 'peanut butter', 'jelly', 'jam'],
            'Beverages': ['water', 'juice', 'soda', 'coffee', 'tea', 'beer', 'wine', 'drink'],
            'Snacks': ['chip', 'cracker', 'cookie', 'candy', 'chocolate', 'nut', 'popcorn', 'pretzel'],
            'Household': ['paper towel', 'toilet paper', 'soap', 'detergent', 'cleaner', 'trash bag', 'foil', 'wrap', 'sponge', 'battery'],
            'Personal Care': ['shampoo', 'conditioner', 'toothpaste', 'deodorant', 'lotion', 'razor', 'tissue']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => lowerName.includes(keyword))) {
                return category;
            }
        }

        return 'Other';
    },

    // Find items by keywords
    findByKeywords(keywords) {
        const lowerKeywords = keywords.toLowerCase();
        return this.items.filter(i =>
            i.name.toLowerCase().includes(lowerKeywords)
        );
    },

    // Format item for display
    formatItem(item) {
        let text = item.name;
        if (item.quantity) {
            text = `${item.quantity}${item.unit ? ' ' + item.unit : ''} ${item.name}`;
        }
        return text;
    }
};

window.Shopping = Shopping;
