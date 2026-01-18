// Inventory Module - Track freezer, fridge, and pantry items with expiration
const Inventory = {
    items: [],
    unsubscribe: null,

    // Storage locations
    LOCATIONS: {
        FREEZER: 'Freezer',
        FRIDGE: 'Refrigerator',
        PANTRY: 'Pantry'
    },

    // Subscribe to real-time inventory updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('inventory')
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

    // Add item to inventory
    async add(itemData) {
        if (!Household.currentHousehold) throw new Error('No household');

        // Handle string input
        if (typeof itemData === 'string') {
            itemData = { name: itemData };
        }

        const item = {
            name: itemData.name,
            quantity: itemData.quantity || 1,
            unit: itemData.unit || null,
            category: itemData.category || this.guessCategory(itemData.name),
            location: itemData.location || this.guessLocation(itemData.name),
            expirationDate: itemData.expirationDate || null,
            notes: itemData.notes || null,
            addedBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('inventory')
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

    // Update an inventory item
    async update(itemId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('inventory')
            .doc(itemId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Remove item from inventory
    async remove(itemId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('inventory')
            .doc(itemId)
            .delete();
    },

    // Use an item (decrement quantity or remove if zero)
    async useItem(itemId, amountUsed = 1) {
        const item = this.items.find(i => i.id === itemId);
        if (!item) throw new Error('Item not found');

        const newQuantity = (item.quantity || 1) - amountUsed;

        if (newQuantity <= 0) {
            await this.remove(itemId);
            return null;
        } else {
            await this.update(itemId, { quantity: newQuantity });
            return { ...item, quantity: newQuantity };
        }
    },

    // Get items by location
    getByLocation(location) {
        return this.items.filter(i => i.location === location);
    },

    // Get items grouped by location
    getGroupedByLocation() {
        const groups = {
            [this.LOCATIONS.FREEZER]: [],
            [this.LOCATIONS.FRIDGE]: [],
            [this.LOCATIONS.PANTRY]: []
        };

        this.items.forEach(item => {
            const location = item.location || this.LOCATIONS.PANTRY;
            if (groups[location]) {
                groups[location].push(item);
            } else {
                groups[this.LOCATIONS.PANTRY].push(item);
            }
        });

        // Sort each group by expiration date (earliest first), then by name
        Object.keys(groups).forEach(loc => {
            groups[loc].sort((a, b) => {
                if (a.expirationDate && b.expirationDate) {
                    return new Date(a.expirationDate) - new Date(b.expirationDate);
                }
                if (a.expirationDate) return -1;
                if (b.expirationDate) return 1;
                return a.name.localeCompare(b.name);
            });
        });

        return groups;
    },

    // Get items expiring within X days
    getExpiringSoon(days = 7) {
        const now = new Date();
        const futureDate = new Date();
        futureDate.setDate(now.getDate() + days);

        return this.items.filter(item => {
            if (!item.expirationDate) return false;
            const expiry = new Date(item.expirationDate);
            return expiry >= now && expiry <= futureDate;
        }).sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));
    },

    // Get expired items
    getExpired() {
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        return this.items.filter(item => {
            if (!item.expirationDate) return false;
            const expiry = new Date(item.expirationDate);
            return expiry < now;
        });
    },

    // Check if we have an ingredient (fuzzy match)
    checkHaveIngredient(ingredientName) {
        const lowerName = ingredientName.toLowerCase();

        return this.items.find(item => {
            const itemName = item.name.toLowerCase();
            // Exact match
            if (itemName === lowerName) return true;
            // Partial match (ingredient contains item name or vice versa)
            if (itemName.includes(lowerName) || lowerName.includes(itemName)) return true;
            // Common variations
            const variations = this.getIngredientVariations(lowerName);
            return variations.some(v => itemName.includes(v) || v.includes(itemName));
        });
    },

    // Get common ingredient name variations
    getIngredientVariations(name) {
        const variations = [name];

        // Plural/singular
        if (name.endsWith('s')) {
            variations.push(name.slice(0, -1));
        } else {
            variations.push(name + 's');
        }

        // Common substitutions
        const subs = {
            'tomato': ['tomatoes', 'roma tomato', 'cherry tomato'],
            'onion': ['onions', 'yellow onion', 'white onion', 'red onion'],
            'pepper': ['peppers', 'bell pepper', 'green pepper', 'red pepper'],
            'chicken': ['chicken breast', 'chicken thigh', 'chicken leg'],
            'beef': ['ground beef', 'beef steak', 'stew beef'],
            'pasta': ['spaghetti', 'penne', 'fettuccine', 'linguine', 'noodles'],
            'cheese': ['cheddar', 'mozzarella', 'parmesan', 'swiss'],
            'milk': ['whole milk', '2% milk', 'skim milk'],
            'oil': ['olive oil', 'vegetable oil', 'canola oil', 'cooking oil']
        };

        for (const [base, alts] of Object.entries(subs)) {
            if (name.includes(base) || alts.some(a => name.includes(a))) {
                variations.push(base, ...alts);
            }
        }

        return [...new Set(variations)];
    },

    // Check inventory against recipe ingredients
    checkRecipeIngredients(recipeIngredients) {
        return recipeIngredients.map(ing => {
            const inventoryItem = this.checkHaveIngredient(ing.name);
            return {
                ...ing,
                have: !!inventoryItem,
                inventoryItem: inventoryItem || null,
                inventoryQuantity: inventoryItem ? inventoryItem.quantity : 0
            };
        });
    },

    // Get missing ingredients for a recipe
    getMissingIngredients(recipeIngredients) {
        return this.checkRecipeIngredients(recipeIngredients)
            .filter(ing => !ing.have);
    },

    // Calculate how many recipe ingredients we have
    getIngredientMatchCount(recipeIngredients) {
        const checked = this.checkRecipeIngredients(recipeIngredients);
        const have = checked.filter(ing => ing.have).length;
        return {
            have,
            total: recipeIngredients.length,
            missing: recipeIngredients.length - have,
            percentage: recipeIngredients.length > 0
                ? Math.round((have / recipeIngredients.length) * 100)
                : 0
        };
    },

    // Guess category based on item name
    guessCategory(name) {
        const lowerName = name.toLowerCase();

        const categories = {
            'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'lettuce', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'celery', 'pepper', 'broccoli', 'spinach', 'kale', 'cucumber', 'zucchini', 'squash', 'mushroom', 'avocado', 'berry', 'fruit', 'vegetable', 'herb', 'basil', 'cilantro', 'parsley'],
            'Dairy': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'sour cream', 'cottage', 'ricotta', 'mozzarella', 'parmesan', 'cheddar'],
            'Meat': ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'ham', 'steak', 'ground'],
            'Seafood': ['fish', 'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'tilapia', 'cod'],
            'Bakery': ['bread', 'bagel', 'muffin', 'croissant', 'roll', 'bun', 'tortilla'],
            'Frozen': ['frozen', 'ice cream', 'pizza', 'fries'],
            'Pantry': ['rice', 'pasta', 'flour', 'sugar', 'oil', 'vinegar', 'sauce', 'broth', 'soup', 'can', 'bean', 'spice', 'salt', 'pepper'],
            'Beverages': ['water', 'juice', 'soda', 'coffee', 'tea', 'beer', 'wine'],
            'Condiments': ['ketchup', 'mustard', 'mayo', 'mayonnaise', 'dressing', 'hot sauce', 'soy sauce']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => lowerName.includes(keyword))) {
                return category;
            }
        }

        return 'Other';
    },

    // Guess storage location based on item name
    guessLocation(name) {
        const lowerName = name.toLowerCase();

        // Freezer items
        const freezerItems = ['frozen', 'ice cream', 'popsicle', 'ice', 'freezer'];
        if (freezerItems.some(f => lowerName.includes(f))) {
            return this.LOCATIONS.FREEZER;
        }

        // Fridge items
        const fridgeItems = ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'juice', 'meat', 'chicken', 'beef', 'pork', 'fish', 'salmon', 'shrimp', 'deli', 'lettuce', 'spinach', 'salad', 'leftover', 'produce', 'vegetable', 'fruit', 'apple', 'berry', 'grape'];
        if (fridgeItems.some(f => lowerName.includes(f))) {
            return this.LOCATIONS.FRIDGE;
        }

        // Default to pantry
        return this.LOCATIONS.PANTRY;
    },

    // Search inventory
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.items.filter(item =>
            item.name.toLowerCase().includes(lowerQuery) ||
            (item.notes && item.notes.toLowerCase().includes(lowerQuery))
        );
    },

    // Format item for display
    formatItem(item) {
        let text = item.name;
        if (item.quantity && item.quantity !== 1) {
            text = `${item.quantity}${item.unit ? ' ' + item.unit : ''} ${item.name}`;
        } else if (item.unit) {
            text = `${item.unit} ${item.name}`;
        }
        return text;
    },

    // Get days until expiration
    getDaysUntilExpiry(item) {
        if (!item.expirationDate) return null;

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const expiry = new Date(item.expirationDate);
        expiry.setHours(0, 0, 0, 0);

        const diffTime = expiry - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays;
    },

    // Format expiration display
    formatExpiry(item) {
        const days = this.getDaysUntilExpiry(item);
        if (days === null) return null;

        if (days < 0) return 'Expired';
        if (days === 0) return 'Expires today';
        if (days === 1) return 'Expires tomorrow';
        if (days <= 7) return `Expires in ${days} days`;

        const expiry = new Date(item.expirationDate);
        return `Expires ${expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    },

    // Clear expired items
    async clearExpired() {
        const expired = this.getExpired();
        const batch = db.batch();

        expired.forEach(item => {
            const ref = db.collection('households')
                .doc(Household.currentHousehold.id)
                .collection('inventory')
                .doc(item.id);
            batch.delete(ref);
        });

        await batch.commit();
        return expired.length;
    }
};

window.Inventory = Inventory;
