// Meal Categories Module - User-defined recipe categories
const MealCategories = {
    categories: [],
    unsubscribe: null,

    // Default categories to start with
    DEFAULT_CATEGORIES: [
        { name: 'Pasta', color: '#E8B4A0' },
        { name: 'Mexican', color: '#A8D5A2' },
        { name: 'Asian', color: '#F5D6BA' },
        { name: 'Comfort Food', color: '#B8C4D4' },
        { name: 'Healthy', color: '#98D4A8' },
        { name: 'Quick & Easy', color: '#F0C8A8' },
        { name: 'Slow Cooker', color: '#D4B8A8' },
        { name: 'Grilling', color: '#C8A090' },
        { name: 'Seafood', color: '#A8C8D4' },
        { name: 'Vegetarian', color: '#B8D8A8' },
        { name: 'Soup & Stew', color: '#D4C4A8' },
        { name: 'Breakfast', color: '#F5E0A8' }
    ],

    // Subscribe to real-time category updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealCategories')
            .orderBy('name', 'asc')
            .onSnapshot((snapshot) => {
                this.categories = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.categories);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Initialize default categories for a new household
    async initializeDefaults() {
        if (!Household.currentHousehold) throw new Error('No household');

        // Check if any categories exist
        const snapshot = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealCategories')
            .limit(1)
            .get();

        if (snapshot.empty) {
            // Add default categories
            const batch = db.batch();
            this.DEFAULT_CATEGORIES.forEach(cat => {
                const ref = db.collection('households')
                    .doc(Household.currentHousehold.id)
                    .collection('mealCategories')
                    .doc();
                batch.set(ref, {
                    ...cat,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }
    },

    // Create a new category
    async create(name, color = null) {
        if (!Household.currentHousehold) throw new Error('No household');

        // Generate a color if not provided
        if (!color) {
            const colors = ['#E8B4A0', '#A8D5A2', '#F5D6BA', '#B8C4D4', '#98D4A8', '#F0C8A8', '#D4B8A8', '#C8A090', '#A8C8D4', '#B8D8A8'];
            color = colors[this.categories.length % colors.length];
        }

        const category = {
            name: name.trim(),
            color,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealCategories')
            .add(category);

        return { id: docRef.id, ...category };
    },

    // Update a category
    async update(categoryId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealCategories')
            .doc(categoryId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete a category
    async delete(categoryId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealCategories')
            .doc(categoryId)
            .delete();
    },

    // Get all category names
    getAll() {
        return this.categories.map(c => c.name);
    },

    // Get category by name
    getByName(name) {
        return this.categories.find(c =>
            c.name.toLowerCase() === name.toLowerCase()
        );
    },

    // Get category color
    getColor(categoryName) {
        const category = this.getByName(categoryName);
        return category ? category.color : '#B8C4D4'; // Default gray
    },

    // Check if category exists
    exists(name) {
        return this.categories.some(c =>
            c.name.toLowerCase() === name.toLowerCase()
        );
    },

    // Get categories with recipe counts
    async getCategoriesWithCounts() {
        if (!Recipes || !Recipes.recipes) return this.categories;

        return this.categories.map(cat => ({
            ...cat,
            recipeCount: Recipes.recipes.filter(r =>
                r.category && r.category.toLowerCase() === cat.name.toLowerCase()
            ).length
        }));
    }
};

window.MealCategories = MealCategories;
