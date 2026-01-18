// Recipes Module - Recipe Management with AI parsing
const Recipes = {
    recipes: [],
    unsubscribe: null,

    // Safely parse fraction strings like "1/2", "1 1/2", "2.5" without using eval
    parseFraction(str) {
        if (!str) return null;

        // Clean the string and trim whitespace
        const cleaned = str.toString().trim();

        // Check for simple decimal number
        if (/^\d+(\.\d+)?$/.test(cleaned)) {
            return parseFloat(cleaned);
        }

        // Check for simple fraction like "1/2"
        const fractionMatch = cleaned.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (fractionMatch) {
            const numerator = parseInt(fractionMatch[1], 10);
            const denominator = parseInt(fractionMatch[2], 10);
            if (denominator === 0) return null;
            return numerator / denominator;
        }

        // Check for mixed number like "1 1/2" or "1-1/2"
        const mixedMatch = cleaned.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/);
        if (mixedMatch) {
            const whole = parseInt(mixedMatch[1], 10);
            const numerator = parseInt(mixedMatch[2], 10);
            const denominator = parseInt(mixedMatch[3], 10);
            if (denominator === 0) return null;
            return whole + (numerator / denominator);
        }

        // Try parseFloat as fallback
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    },

    // Subscribe to real-time recipe updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('recipes')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                this.recipes = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.recipes);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Create a new recipe
    async create(recipeData) {
        if (!Household.currentHousehold) throw new Error('No household');

        const recipe = {
            name: recipeData.name,
            ingredients: recipeData.ingredients || [],
            instructions: recipeData.instructions || '',
            servings: recipeData.servings || 4,
            prepTime: recipeData.prepTime || null,
            cookTime: recipeData.cookTime || null,
            category: recipeData.category || 'Uncategorized',
            tags: recipeData.tags || [],
            imageUrl: recipeData.imageUrl || null,
            sourceUrl: recipeData.sourceUrl || null,
            favorite: recipeData.favorite || false,
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('recipes')
            .add(recipe);

        return { id: docRef.id, ...recipe };
    },

    // Update a recipe
    async update(recipeId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('recipes')
            .doc(recipeId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete a recipe
    async delete(recipeId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('recipes')
            .doc(recipeId)
            .delete();
    },

    // Toggle favorite status
    async toggleFavorite(recipeId) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (!recipe) throw new Error('Recipe not found');

        await this.update(recipeId, { favorite: !recipe.favorite });
        return { ...recipe, favorite: !recipe.favorite };
    },

    // Get recipes by category
    getByCategory(category) {
        return this.recipes.filter(r => r.category === category);
    },

    // Get all unique categories
    getCategories() {
        const categories = new Set(this.recipes.map(r => r.category));
        return Array.from(categories).sort();
    },

    // Get recipes grouped by category
    getGroupedByCategory() {
        const groups = {};

        this.recipes.forEach(recipe => {
            const category = recipe.category || 'Uncategorized';
            if (!groups[category]) groups[category] = [];
            groups[category].push(recipe);
        });

        // Sort recipes within each category by name
        Object.keys(groups).forEach(cat => {
            groups[cat].sort((a, b) => a.name.localeCompare(b.name));
        });

        return groups;
    },

    // Get favorite recipes
    getFavorites() {
        return this.recipes.filter(r => r.favorite);
    },

    // Search recipes by name or ingredient
    search(query) {
        const lowerQuery = query.toLowerCase();
        return this.recipes.filter(recipe => {
            // Check name
            if (recipe.name.toLowerCase().includes(lowerQuery)) return true;

            // Check ingredients
            if (recipe.ingredients.some(ing =>
                ing.name.toLowerCase().includes(lowerQuery)
            )) return true;

            // Check tags
            if (recipe.tags && recipe.tags.some(tag =>
                tag.toLowerCase().includes(lowerQuery)
            )) return true;

            return false;
        });
    },

    // Search recipes that use a specific ingredient
    searchByIngredient(ingredient) {
        const lowerIngredient = ingredient.toLowerCase();
        return this.recipes.filter(recipe =>
            recipe.ingredients.some(ing =>
                ing.name.toLowerCase().includes(lowerIngredient)
            )
        );
    },

    // Get recipes that can be made with given inventory items
    getRecipesWithIngredients(inventoryItems) {
        const inventoryNames = inventoryItems.map(i => i.name.toLowerCase());

        return this.recipes.map(recipe => {
            const totalIngredients = recipe.ingredients.length;
            const matchedIngredients = recipe.ingredients.filter(ing =>
                inventoryNames.some(invName =>
                    invName.includes(ing.name.toLowerCase()) ||
                    ing.name.toLowerCase().includes(invName)
                )
            ).length;

            return {
                ...recipe,
                matchedIngredients,
                totalIngredients,
                matchPercentage: totalIngredients > 0
                    ? Math.round((matchedIngredients / totalIngredients) * 100)
                    : 0
            };
        }).sort((a, b) => b.matchPercentage - a.matchPercentage);
    },

    // Parse recipe from text using AI
    async parseFromText(text) {
        try {
            const response = await fetch(AI.WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    transcript: text,
                    isRecipe: true,
                    parseType: 'recipe'
                })
            });

            if (!response.ok) {
                throw new Error('Failed to parse recipe');
            }

            const parsed = await response.json();
            return this.normalizeRecipeData(parsed);
        } catch (error) {
            // Recipe parsing error - fallback to basic parsing
            return this.basicParse(text);
        }
    },

    // Parse recipe from image using AI (via base64)
    async parseFromImage(imageFile) {
        try {
            // Convert image to base64
            const base64 = await this.fileToBase64(imageFile);

            const response = await fetch(AI.WORKER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64,
                    isRecipe: true,
                    parseType: 'recipe-image'
                })
            });

            if (!response.ok) {
                throw new Error('Failed to parse recipe image');
            }

            const parsed = await response.json();
            return this.normalizeRecipeData(parsed);
        } catch (error) {
            // Recipe image parsing error
            throw error;
        }
    },

    // Convert file to base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    },

    // Normalize parsed recipe data to standard format
    normalizeRecipeData(parsed) {
        // Handle various response formats from AI
        const recipe = {
            name: parsed.name || parsed.title || 'Untitled Recipe',
            ingredients: [],
            instructions: parsed.instructions || parsed.directions || '',
            servings: parsed.servings || parsed.serves || 4,
            prepTime: parsed.prepTime || parsed.prep_time || null,
            cookTime: parsed.cookTime || parsed.cook_time || null,
            category: parsed.category || 'Uncategorized',
            tags: parsed.tags || [],
            sourceUrl: parsed.sourceUrl || parsed.source || null
        };

        // Normalize ingredients
        if (parsed.ingredients && Array.isArray(parsed.ingredients)) {
            recipe.ingredients = parsed.ingredients.map(ing => {
                if (typeof ing === 'string') {
                    return this.parseIngredientString(ing);
                }
                return {
                    name: ing.name || ing.item || ing.ingredient || '',
                    quantity: ing.quantity || ing.amount || null,
                    unit: ing.unit || null,
                    category: ing.category || this.guessIngredientCategory(ing.name || ing.item || '')
                };
            });
        }

        return recipe;
    },

    // Parse an ingredient string like "2 cups flour"
    parseIngredientString(str) {
        const pattern = /^([\d./\s]+)?\s*([a-zA-Z]+)?\s*(.+)$/;
        const match = str.trim().match(pattern);

        if (match) {
            const quantity = match[1] ? match[1].trim() : null;
            let unit = match[2] ? match[2].trim().toLowerCase() : null;
            let name = match[3] ? match[3].trim() : str;

            // Common units
            const units = ['cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb', 'lbs', 'g', 'kg', 'ml', 'l', 'clove', 'cloves', 'piece', 'pieces', 'slice', 'slices', 'can', 'cans', 'package', 'packages'];

            if (unit && !units.includes(unit)) {
                // Not a recognized unit, probably part of the name
                name = (unit + ' ' + name).trim();
                unit = null;
            }

            return {
                name,
                quantity: quantity ? this.parseFraction(quantity) : null,
                unit,
                category: this.guessIngredientCategory(name)
            };
        }

        return {
            name: str,
            quantity: null,
            unit: null,
            category: this.guessIngredientCategory(str)
        };
    },

    // Guess ingredient category for shopping list grouping
    guessIngredientCategory(name) {
        const lowerName = name.toLowerCase();

        const categories = {
            'Produce': ['apple', 'banana', 'orange', 'lemon', 'lime', 'lettuce', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'celery', 'pepper', 'broccoli', 'spinach', 'kale', 'cucumber', 'zucchini', 'squash', 'mushroom', 'avocado', 'berry', 'fruit', 'vegetable', 'herb', 'basil', 'cilantro', 'parsley', 'ginger', 'scallion', 'green onion'],
            'Dairy': ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'sour cream', 'cottage', 'ricotta', 'mozzarella', 'parmesan', 'cheddar'],
            'Meat': ['chicken', 'beef', 'pork', 'turkey', 'bacon', 'sausage', 'ham', 'steak', 'ground', 'lamb', 'veal'],
            'Seafood': ['fish', 'salmon', 'tuna', 'shrimp', 'crab', 'lobster', 'tilapia', 'cod', 'halibut', 'scallop'],
            'Bakery': ['bread', 'bagel', 'muffin', 'croissant', 'roll', 'bun', 'tortilla', 'pita', 'naan'],
            'Frozen': ['frozen', 'ice cream'],
            'Pantry': ['rice', 'pasta', 'noodle', 'flour', 'sugar', 'oil', 'vinegar', 'sauce', 'broth', 'stock', 'soup', 'can', 'bean', 'lentil', 'chickpea', 'spice', 'salt', 'pepper', 'paprika', 'cumin', 'oregano', 'thyme', 'cinnamon', 'vanilla', 'honey', 'syrup', 'peanut butter', 'jam', 'jelly', 'olive oil', 'vegetable oil', 'soy sauce', 'worcestershire'],
            'Beverages': ['water', 'juice', 'soda', 'coffee', 'tea', 'wine', 'beer'],
            'Snacks': ['chip', 'cracker', 'cookie', 'nut', 'almond', 'walnut', 'pecan']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => lowerName.includes(keyword))) {
                return category;
            }
        }

        return 'Other';
    },

    // Basic parsing fallback when AI fails
    basicParse(text) {
        const lines = text.split('\n').filter(line => line.trim());
        const recipe = {
            name: 'Imported Recipe',
            ingredients: [],
            instructions: '',
            servings: 4,
            prepTime: null,
            cookTime: null,
            category: 'Uncategorized',
            tags: []
        };

        let inIngredients = false;
        let inInstructions = false;
        const instructionLines = [];

        for (const line of lines) {
            const lowerLine = line.toLowerCase().trim();

            // Try to find recipe name (first non-empty line or line with "recipe" in it)
            if (!recipe.name || recipe.name === 'Imported Recipe') {
                if (lowerLine.includes('recipe') || lines.indexOf(line) === 0) {
                    recipe.name = line.replace(/recipe:?/i, '').trim() || 'Imported Recipe';
                    continue;
                }
            }

            // Detect section headers
            if (lowerLine.includes('ingredient')) {
                inIngredients = true;
                inInstructions = false;
                continue;
            }
            if (lowerLine.includes('instruction') || lowerLine.includes('direction') || lowerLine.includes('method') || lowerLine.includes('step')) {
                inIngredients = false;
                inInstructions = true;
                continue;
            }

            // Parse content based on current section
            if (inIngredients && line.trim()) {
                // Remove bullet points, numbers, etc.
                const cleaned = line.replace(/^[\s\-\*\•\d.]+/, '').trim();
                if (cleaned) {
                    recipe.ingredients.push(this.parseIngredientString(cleaned));
                }
            } else if (inInstructions && line.trim()) {
                instructionLines.push(line.replace(/^[\s\-\*\•\d.]+/, '').trim());
            }
        }

        recipe.instructions = instructionLines.join('\n');
        return recipe;
    },

    // Get ingredient list for a recipe (for shopping)
    getIngredientList(recipeId, servingMultiplier = 1) {
        const recipe = this.recipes.find(r => r.id === recipeId);
        if (!recipe) return [];

        return recipe.ingredients.map(ing => ({
            name: ing.name,
            quantity: ing.quantity ? ing.quantity * servingMultiplier : null,
            unit: ing.unit,
            category: ing.category || this.guessIngredientCategory(ing.name),
            recipeId: recipeId,
            recipeName: recipe.name
        }));
    },

    // Format recipe for display
    formatRecipe(recipe) {
        const timeStr = [];
        if (recipe.prepTime) timeStr.push(`Prep: ${recipe.prepTime} min`);
        if (recipe.cookTime) timeStr.push(`Cook: ${recipe.cookTime} min`);

        return {
            ...recipe,
            timeDisplay: timeStr.join(' | ') || null,
            ingredientCount: recipe.ingredients ? recipe.ingredients.length : 0
        };
    }
};

window.Recipes = Recipes;
