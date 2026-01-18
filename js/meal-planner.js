// Meal Planner Module - Weekly meal planning with smart suggestions
const MealPlanner = {
    plans: [],
    currentPlan: null,
    unsubscribe: null,

    // Subscribe to real-time meal plan updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealPlans')
            .orderBy('weekStart', 'desc')
            .onSnapshot((snapshot) => {
                this.plans = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.plans);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Get the start of the week (Sunday) for a given date
    getWeekStart(date = new Date()) {
        const d = new Date(date);
        const day = d.getDay();
        d.setDate(d.getDate() - day);
        d.setHours(0, 0, 0, 0);
        return d;
    },

    // Get the current week's plan
    getCurrentWeekPlan() {
        const weekStart = this.getWeekStart();
        const weekStartStr = weekStart.toISOString().split('T')[0];
        return this.plans.find(p => p.weekStart === weekStartStr);
    },

    // Get plan for a specific week
    getPlanForWeek(weekStartDate) {
        if (!weekStartDate) {
            weekStartDate = this.getWeekStart();
        }
        const weekStartStr = typeof weekStartDate === 'string'
            ? weekStartDate
            : weekStartDate.toISOString().split('T')[0];
        return this.plans.find(p => p.weekStart === weekStartStr);
    },

    // Create a new meal plan
    async createPlan(options = {}) {
        if (!Household.currentHousehold) throw new Error('No household');

        const weekStart = options.weekStart || this.getWeekStart();
        const weekStartStr = typeof weekStart === 'string'
            ? weekStart
            : weekStart.toISOString().split('T')[0];

        const plan = {
            weekStart: weekStartStr,
            meals: options.meals || {},
            mealsNeeded: options.mealsNeeded || 7,
            daysNeeded: options.daysNeeded || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            mustIncludeRecipes: options.mustIncludeRecipes || [],
            categoryRequirements: options.categoryRequirements || {},
            useUpItems: options.useUpItems || [],
            generatedGroceryList: [],
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealPlans')
            .add(plan);

        this.currentPlan = { id: docRef.id, ...plan };
        return this.currentPlan;
    },

    // Update a meal plan
    async updatePlan(planId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealPlans')
            .doc(planId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete a meal plan
    async deletePlan(planId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('mealPlans')
            .doc(planId)
            .delete();
    },

    // Set a meal for a specific day
    async setMeal(planId, dateStr, recipeId, mealType = 'dinner') {
        const plan = this.plans.find(p => p.id === planId);
        if (!plan) throw new Error('Plan not found');

        const meals = { ...plan.meals };
        meals[dateStr] = {
            recipeId,
            mealType,
            setAt: new Date().toISOString()
        };

        await this.updatePlan(planId, { meals });
    },

    // Remove a meal from a day
    async removeMeal(planId, dateStr) {
        const plan = this.plans.find(p => p.id === planId);
        if (!plan) throw new Error('Plan not found');

        const meals = { ...plan.meals };
        delete meals[dateStr];

        await this.updatePlan(planId, { meals });
    },

    // Get recipe suggestions based on criteria
    getSuggestions(options = {}) {
        const {
            useUpItems = [],          // Inventory items to prioritize using
            categoryRequirements = {}, // e.g., {"Pasta": 2, "Mexican": 1}
            mustInclude = [],          // Recipe IDs that must be included
            exclude = [],              // Recipe IDs to exclude
            maxResults = 10
        } = options;

        if (!Recipes || !Recipes.recipes) return [];

        // Start with all recipes except excluded ones
        let candidates = Recipes.recipes.filter(r => !exclude.includes(r.id));

        // Score each recipe
        const scored = candidates.map(recipe => {
            let score = 0;
            const reasons = [];

            // Must-include recipes get highest priority
            if (mustInclude.includes(recipe.id)) {
                score += 1000;
                reasons.push('Must include');
            }

            // Score based on inventory match (prioritize using what we have)
            if (Inventory && Inventory.items.length > 0) {
                const match = Inventory.getIngredientMatchCount(recipe.ingredients || []);
                score += match.percentage * 3; // 0-300 points for inventory match

                // Extra bonus for using expiring items
                if (useUpItems.length > 0) {
                    const useUpNames = useUpItems.map(id => {
                        const item = Inventory.items.find(i => i.id === id);
                        return item ? item.name.toLowerCase() : '';
                    }).filter(Boolean);

                    const usesExpiringItems = recipe.ingredients?.some(ing =>
                        useUpNames.some(name =>
                            ing.name.toLowerCase().includes(name) ||
                            name.includes(ing.name.toLowerCase())
                        )
                    );

                    if (usesExpiringItems) {
                        score += 200;
                        reasons.push('Uses expiring items');
                    }
                }

                if (match.percentage >= 80) {
                    reasons.push(`${match.percentage}% ingredients on hand`);
                } else if (match.percentage >= 50) {
                    reasons.push(`${match.percentage}% ingredients available`);
                }
            }

            // Score based on category requirements
            if (categoryRequirements[recipe.category]) {
                score += 150;
                reasons.push(`Matches ${recipe.category} requirement`);
            }

            // Bonus for favorites
            if (recipe.favorite) {
                score += 50;
                reasons.push('Family favorite');
            }

            // Small bonus for quick recipes
            if (recipe.cookTime && recipe.cookTime <= 30) {
                score += 20;
            }

            return {
                ...recipe,
                suggestionScore: score,
                suggestionReasons: reasons,
                inventoryMatch: Inventory
                    ? Inventory.getIngredientMatchCount(recipe.ingredients || [])
                    : { have: 0, total: 0, percentage: 0 }
            };
        });

        // Sort by score descending
        scored.sort((a, b) => b.suggestionScore - a.suggestionScore);

        return scored.slice(0, maxResults);
    },

    // Generate a complete week's meal plan
    generateWeekSuggestions(options = {}) {
        const {
            daysNeeded = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            mustInclude = [],
            categoryRequirements = {},
            useUpItems = []
        } = options;

        const suggestions = [];
        const usedRecipeIds = [];
        const categoryUsage = {};

        // Track category requirements fulfillment
        Object.keys(categoryRequirements).forEach(cat => {
            categoryUsage[cat] = 0;
        });

        // First, place must-include recipes
        const mustIncludeRecipes = mustInclude.map(id =>
            Recipes.recipes.find(r => r.id === id)
        ).filter(Boolean);

        mustIncludeRecipes.forEach((recipe, index) => {
            if (index < daysNeeded.length) {
                suggestions.push({
                    day: daysNeeded[index],
                    recipe,
                    locked: true,
                    reason: 'Must include'
                });
                usedRecipeIds.push(recipe.id);
                if (categoryRequirements[recipe.category]) {
                    categoryUsage[recipe.category]++;
                }
            }
        });

        // Fill remaining days
        const remainingDays = daysNeeded.slice(suggestions.length);

        for (const day of remainingDays) {
            // Determine which categories still need filling
            const neededCategories = Object.keys(categoryRequirements).filter(cat =>
                categoryUsage[cat] < categoryRequirements[cat]
            );

            // Get suggestions excluding already used recipes
            const daySuggestions = this.getSuggestions({
                useUpItems,
                categoryRequirements: neededCategories.reduce((acc, cat) => {
                    acc[cat] = 1;
                    return acc;
                }, {}),
                exclude: usedRecipeIds,
                maxResults: 5
            });

            if (daySuggestions.length > 0) {
                const selected = daySuggestions[0];
                suggestions.push({
                    day,
                    recipe: selected,
                    locked: false,
                    reason: selected.suggestionReasons.join(', ') || 'Suggested',
                    alternatives: daySuggestions.slice(1, 4)
                });
                usedRecipeIds.push(selected.id);
                if (categoryRequirements[selected.category]) {
                    categoryUsage[selected.category]++;
                }
            } else {
                suggestions.push({
                    day,
                    recipe: null,
                    locked: false,
                    reason: 'No suggestions available'
                });
            }
        }

        return {
            suggestions,
            categoryUsage,
            categoryRequirements,
            fulfilled: Object.keys(categoryRequirements).every(cat =>
                categoryUsage[cat] >= categoryRequirements[cat]
            )
        };
    },

    // Swap a recipe in suggestions
    swapSuggestion(suggestions, dayIndex, newRecipe) {
        const updated = [...suggestions];
        if (updated[dayIndex]) {
            const oldRecipe = updated[dayIndex].recipe;
            updated[dayIndex] = {
                ...updated[dayIndex],
                recipe: newRecipe,
                locked: false,
                reason: 'Manually selected',
                swappedFrom: oldRecipe ? oldRecipe.name : null
            };
        }
        return updated;
    },

    // Lock/unlock a suggestion
    toggleLock(suggestions, dayIndex) {
        const updated = [...suggestions];
        if (updated[dayIndex]) {
            updated[dayIndex] = {
                ...updated[dayIndex],
                locked: !updated[dayIndex].locked
            };
        }
        return updated;
    },

    // Generate grocery list from a meal plan
    generateGroceryList(planId) {
        const plan = this.plans.find(p => p.id === planId);
        if (!plan) throw new Error('Plan not found');

        const ingredientMap = new Map();

        // Collect all ingredients from planned meals
        Object.values(plan.meals).forEach(meal => {
            if (!meal.recipeId) return;

            const recipe = Recipes.recipes.find(r => r.id === meal.recipeId);
            if (!recipe || !recipe.ingredients) return;

            recipe.ingredients.forEach(ing => {
                const key = ing.name.toLowerCase();
                if (ingredientMap.has(key)) {
                    const existing = ingredientMap.get(key);
                    existing.quantity = (existing.quantity || 0) + (ing.quantity || 1);
                    existing.recipes.push(recipe.name);
                } else {
                    ingredientMap.set(key, {
                        name: ing.name,
                        quantity: ing.quantity || 1,
                        unit: ing.unit,
                        category: ing.category || Inventory.guessCategory(ing.name),
                        recipes: [recipe.name]
                    });
                }
            });
        });

        // Check against inventory
        const groceryList = [];
        ingredientMap.forEach((item, key) => {
            const inventoryItem = Inventory.checkHaveIngredient(item.name);
            groceryList.push({
                ...item,
                have: !!inventoryItem,
                inventoryQuantity: inventoryItem ? inventoryItem.quantity : 0,
                needToBuy: !inventoryItem
            });
        });

        // Sort by category, then by whether we need to buy it
        groceryList.sort((a, b) => {
            if (a.needToBuy !== b.needToBuy) return a.needToBuy ? -1 : 1;
            return a.category.localeCompare(b.category);
        });

        return groceryList;
    },

    // Generate grocery list from suggestions (before saving plan)
    generateGroceryListFromSuggestions(suggestions) {
        const ingredientMap = new Map();

        suggestions.forEach(suggestion => {
            if (!suggestion.recipe || !suggestion.recipe.ingredients) return;

            suggestion.recipe.ingredients.forEach(ing => {
                const key = ing.name.toLowerCase();
                if (ingredientMap.has(key)) {
                    const existing = ingredientMap.get(key);
                    existing.quantity = (existing.quantity || 0) + (ing.quantity || 1);
                    existing.recipes.push(suggestion.recipe.name);
                } else {
                    ingredientMap.set(key, {
                        name: ing.name,
                        quantity: ing.quantity || 1,
                        unit: ing.unit,
                        category: ing.category || Inventory.guessCategory(ing.name),
                        recipes: [suggestion.recipe.name]
                    });
                }
            });
        });

        const groceryList = [];
        ingredientMap.forEach((item) => {
            const inventoryItem = Inventory.checkHaveIngredient(item.name);
            groceryList.push({
                ...item,
                have: !!inventoryItem,
                inventoryQuantity: inventoryItem ? inventoryItem.quantity : 0,
                needToBuy: !inventoryItem
            });
        });

        groceryList.sort((a, b) => {
            if (a.needToBuy !== b.needToBuy) return a.needToBuy ? -1 : 1;
            return a.category.localeCompare(b.category);
        });

        return groceryList;
    },

    // Add grocery items to shopping list
    async addToShoppingList(groceryItems, onlyMissing = true) {
        const itemsToAdd = onlyMissing
            ? groceryItems.filter(item => item.needToBuy)
            : groceryItems;

        for (const item of itemsToAdd) {
            await Shopping.add({
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                category: item.category,
                notes: `For: ${item.recipes.join(', ')}`
            });
        }

        return itemsToAdd.length;
    },

    // Update user's check of what they have (during planning wizard)
    updateIngredientChecks(groceryList, checkedItems) {
        return groceryList.map(item => ({
            ...item,
            have: checkedItems.includes(item.name.toLowerCase()),
            needToBuy: !checkedItems.includes(item.name.toLowerCase())
        }));
    },

    // Get stats for a meal plan
    getPlanStats(planId) {
        const plan = this.plans.find(p => p.id === planId);
        if (!plan) return null;

        const meals = Object.values(plan.meals);
        const groceryList = this.generateGroceryList(planId);

        const categories = {};
        meals.forEach(meal => {
            if (!meal.recipeId) return;
            const recipe = Recipes.recipes.find(r => r.id === meal.recipeId);
            if (recipe && recipe.category) {
                categories[recipe.category] = (categories[recipe.category] || 0) + 1;
            }
        });

        return {
            totalMeals: meals.length,
            plannedDays: Object.keys(plan.meals).length,
            categoryCounts: categories,
            totalIngredients: groceryList.length,
            ingredientsOnHand: groceryList.filter(i => i.have).length,
            ingredientsToBuy: groceryList.filter(i => i.needToBuy).length
        };
    },

    // Get dates for the current week
    getWeekDates(weekStart = null) {
        const start = weekStart ? new Date(weekStart) : this.getWeekStart();
        const dates = [];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        for (let i = 0; i < 7; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            dates.push({
                date: date.toISOString().split('T')[0],
                dayName: dayNames[date.getDay()],
                dayNum: date.getDate(),
                isToday: date.toDateString() === new Date().toDateString()
            });
        }

        return dates;
    },

    // Format meal plan for display
    formatPlanForDisplay(planId) {
        const plan = this.plans.find(p => p.id === planId);
        if (!plan) return null;

        const weekDates = this.getWeekDates(plan.weekStart);

        return weekDates.map(dateInfo => {
            const meal = plan.meals[dateInfo.date];
            let recipe = null;

            if (meal && meal.recipeId) {
                recipe = Recipes.recipes.find(r => r.id === meal.recipeId);
            }

            return {
                ...dateInfo,
                meal,
                recipe,
                hasPlannedMeal: !!recipe
            };
        });
    }
};

window.MealPlanner = MealPlanner;
