// Main Application Module
const App = {
    currentTab: 'today',
    currentMonth: new Date(),
    selectedDate: new Date(),
    currentWeekStart: null,
    currentInventoryLocation: 'Refrigerator',
    wizardStep: 1,
    wizardData: {},
    currentRecipeId: null,
    parsedRecipeData: null,

    // Initialize the application
    async init() {
        // Initializing Household6

        // Apply saved theme immediately
        this.initTheme();

        // Initialize auth and wait for state
        const user = await Auth.init();

        if (user) {
            await this.handleSignedIn();
        } else {
            this.showScreen('auth');
        }

        // Set up event listeners
        this.setupEventListeners();

        // Register service worker
        this.registerServiceWorker();
    },

    // Handle signed in state
    async handleSignedIn() {
        // Try to load existing household
        const household = await Household.load();

        if (household) {
            await this.loadHousehold();
            this.showScreen('main');
        } else {
            this.showScreen('household');
        }
    },

    // Load household data
    async loadHousehold() {
        // Subscribe to tasks
        Tasks.subscribe((tasks) => this.renderTasks(tasks));

        // Subscribe to shopping list
        Shopping.subscribe((items) => this.renderShoppingList(items));

        // Subscribe to locations
        Locations.subscribe((locations) => this.renderLocations(locations));

        // Subscribe to recipes
        Recipes.subscribe((recipes) => this.renderRecipes(recipes));

        // Subscribe to inventory
        Inventory.subscribe((items) => this.renderInventory(items));

        // Subscribe to meal categories
        MealCategories.subscribe(() => this.updateCategorySelects());

        // Subscribe to meal plans
        MealPlanner.subscribe((plans) => this.renderMealPlanner(plans));

        // Subscribe to agenda
        Agenda.subscribe((items) => this.renderAgenda(items));

        // Initialize meal categories defaults
        await MealCategories.initializeDefaults();

        // Initialize week start for planner
        this.currentWeekStart = MealPlanner.getWeekStart();

        // Load calendar
        Calendar.loadSelectedCalendar();

        // If Google Calendar was previously connected, ensure we have access
        if (Auth.calendarConnected) {
            await this.ensureCalendarAccess();
        }

        // Load calendar data if we have access
        if (Calendar.selectedCalendarId && Auth.accessToken) {
            try {
                await this.loadTodayData();
            } catch (e) {
                console.log('Calendar not available yet:', e.message);
            }
        }

        // Initialize notifications
        await Notifications.init();

        // Initialize reminders
        await Reminders.init();

        // Schedule reminders for today's events
        await Reminders.scheduleAllReminders();

        // Update UI
        this.updateHouseholdUI();
    },

    // Load today's data
    async loadTodayData() {
        const eventsContainer = document.getElementById('today-events');

        // Check if calendar needs reconnection
        if (!Auth.accessToken) {
            if (eventsContainer) {
                if (Auth.calendarConnected || Calendar.selectedCalendarId) {
                    // Was connected before but token expired
                    eventsContainer.innerHTML = `
                        <div class="calendar-disconnected">
                            <p>Calendar disconnected</p>
                            <button class="btn btn-small btn-secondary" onclick="App.promptCalendarReconnect()">
                                Reconnect
                            </button>
                        </div>
                    `;
                } else {
                    // Never connected
                    eventsContainer.innerHTML = `
                        <div class="calendar-disconnected">
                            <p>Calendar not connected</p>
                            <button class="btn btn-small btn-secondary" onclick="App.openSettingsModal()">
                                Connect in Settings
                            </button>
                        </div>
                    `;
                }
            }
        } else if (Calendar.selectedCalendarId) {
            try {
                const events = await Calendar.getTodayEvents();
                this.renderTodayEvents(events);
            } catch (e) {
                console.log('Could not load calendar events:', e.message);
                if (eventsContainer) {
                    eventsContainer.innerHTML = `
                        <div class="calendar-disconnected">
                            <p>Calendar error</p>
                            <button class="btn btn-small btn-secondary" onclick="App.promptCalendarReconnect()">
                                Reconnect
                            </button>
                        </div>
                    `;
                }
            }
        } else if (eventsContainer) {
            eventsContainer.innerHTML = '<p class="empty-state">No calendar selected</p>';
        }

        this.renderTodayTasks();
    },

    // Prompt user to reconnect calendar
    async promptCalendarReconnect() {
        try {
            this.showToast('Connecting to Google Calendar...');
            const token = await Auth.connectGoogleCalendar();
            if (token) {
                this.showToast('Calendar reconnected!');
                this.updateCalendarUI(true);
                await this.loadTodayData();
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Render today's tasks with overdue section
    renderTodayTasks() {
        const container = document.getElementById('today-tasks');
        if (!container) return;

        const overdue = Tasks.getOverdue();
        const todayTasks = Tasks.getTodayTasks();

        if (overdue.length === 0 && todayTasks.length === 0) {
            container.innerHTML = '<p class="empty-state">No pending tasks</p>';
            return;
        }

        let html = '';

        // Overdue section (if any)
        if (overdue.length > 0) {
            html += `
                <div class="overdue-section">
                    <h4 class="section-label overdue-label">Overdue (${overdue.length})</h4>
                    ${overdue.map(task => this.renderTaskItem(task, 'overdue')).join('')}
                </div>
            `;
        }

        // Today's tasks
        if (todayTasks.length > 0) {
            html += `
                <div class="today-tasks-section">
                    ${overdue.length > 0 ? '<h4 class="section-label">Today</h4>' : ''}
                    ${todayTasks.map(task => this.renderTaskItem(task, 'today')).join('')}
                </div>
            `;
        }

        container.innerHTML = html;

        // Add click handlers for task completion
        container.querySelectorAll('.task-item').forEach(item => {
            item.addEventListener('click', async () => {
                const taskId = item.dataset.taskId;
                await Tasks.toggleComplete(taskId);
                this.renderTodayTasks();
            });
        });
    },

    // Render a single task item
    renderTaskItem(task, status) {
        const statusClass = status === 'overdue' ? 'task-overdue' : '';
        const dueText = Tasks.formatDueDate(task);

        return `
            <div class="task-item ${statusClass}" data-task-id="${esc(task.id)}">
                <span class="task-checkbox">${task.completed ? '☑' : '☐'}</span>
                <span class="task-title">${esc(task.title)}</span>
                ${dueText ? `<span class="task-due">${esc(dueText)}</span>` : ''}
            </div>
        `;
    },

    // Show a specific screen
    showScreen(screenName) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        const screen = document.getElementById(`${screenName}-screen`);
        if (screen) screen.classList.remove('hidden');
    },

    // Set up all event listeners
    setupEventListeners() {
        // Auth - Email/Password forms
        document.getElementById('signin-form')?.addEventListener('submit', (e) => this.handleSignIn(e));
        document.getElementById('signup-form')?.addEventListener('submit', (e) => this.handleSignUp(e));
        document.getElementById('forgot-password-form')?.addEventListener('submit', (e) => this.handleForgotPassword(e));
        document.getElementById('sign-out-btn')?.addEventListener('click', () => this.handleSignOut());

        // Auth form switching
        document.getElementById('show-signup')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showAuthForm('signup');
        });
        document.getElementById('show-signin')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showAuthForm('signin');
        });
        document.getElementById('show-forgot-password')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showAuthForm('forgot');
        });
        document.getElementById('back-to-signin')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showAuthForm('signin');
        });

        // Household
        document.getElementById('create-household-btn')?.addEventListener('click', () => this.handleCreateHousehold());
        document.getElementById('join-household-btn')?.addEventListener('click', () => this.handleJoinHousehold());

        // Household created modal
        document.getElementById('household-created-continue')?.addEventListener('click', () => this.closeHouseholdCreatedModal());
        document.getElementById('copy-new-invite-code')?.addEventListener('click', () => this.copyNewInviteCode());
        document.getElementById('share-invite-code')?.addEventListener('click', () => this.shareInviteCode());
        document.getElementById('connect-calendar-onboarding')?.addEventListener('click', () => this.handleConnectCalendarOnboarding());

        // Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Shopping list
        document.getElementById('clear-checked-btn')?.addEventListener('click', () => this.clearCheckedItems());

        // Voice
        document.getElementById('voice-btn')?.addEventListener('click', () => this.openVoiceModal());
        document.getElementById('voice-close-btn')?.addEventListener('click', () => this.closeVoiceModal());
        document.getElementById('voice-retry-btn')?.addEventListener('click', () => this.startVoiceInput());
        document.getElementById('voice-confirm-btn')?.addEventListener('click', () => this.confirmVoiceInput());

        // Text input
        document.getElementById('text-input')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
                this.handleTextInput(e.target.value.trim());
                e.target.value = '';
            }
        });

        // File upload
        document.getElementById('file-input')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
                e.target.value = ''; // Reset for future uploads
            }
        });

        // Document modal
        document.getElementById('document-confirm-btn')?.addEventListener('click', () => this.confirmDocumentItems());
        document.getElementById('document-cancel-btn')?.addEventListener('click', () => this.closeDocumentModal());
        document.getElementById('document-retry-btn')?.addEventListener('click', () => this.closeDocumentModal());

        // Tasks
        document.getElementById('add-task-btn')?.addEventListener('click', () => this.openTaskModal());
        document.getElementById('task-form')?.addEventListener('submit', (e) => this.handleTaskSubmit(e));
        document.getElementById('task-recurring')?.addEventListener('change', (e) => {
            document.getElementById('recurring-options').classList.toggle('hidden', !e.target.checked);
        });

        // Agenda
        document.getElementById('add-agenda-btn')?.addEventListener('click', () => this.openAgendaModal());
        document.getElementById('agenda-form')?.addEventListener('submit', (e) => this.handleAgendaSubmit(e));
        document.getElementById('clear-resolved-btn')?.addEventListener('click', () => this.clearResolvedAgenda());

        // Settings
        document.getElementById('settings-btn')?.addEventListener('click', () => this.openSettingsModal());
        document.getElementById('copy-invite-code')?.addEventListener('click', () => this.copyInviteCode());
        document.getElementById('add-location-btn')?.addEventListener('click', () => this.openLocationModal());
        document.getElementById('location-form')?.addEventListener('submit', (e) => this.handleLocationSubmit(e));

        // Calendar settings
        document.getElementById('connect-calendar-btn')?.addEventListener('click', () => this.handleConnectCalendar());
        document.getElementById('calendar-select')?.addEventListener('change', (e) => this.handleCalendarSelect(e));

        // User settings
        document.getElementById('morning-report-time')?.addEventListener('change', (e) => {
            Notifications.saveSettings({ morningReportTime: e.target.value });
        });
        document.getElementById('buffer-time')?.addEventListener('change', (e) => {
            Reminders.saveSettings({ bufferMinutes: parseInt(e.target.value) });
        });
        document.getElementById('home-address')?.addEventListener('blur', (e) => {
            Reminders.saveSettings({ homeAddress: e.target.value });
        });

        // Theme toggle
        document.getElementById('theme-select')?.addEventListener('change', (e) => {
            this.setTheme(e.target.value);
        });

        // Calendar navigation
        document.getElementById('prev-month')?.addEventListener('click', () => this.navigateMonth(-1));
        document.getElementById('next-month')?.addEventListener('click', () => this.navigateMonth(1));

        // Recipes
        document.getElementById('add-recipe-btn')?.addEventListener('click', () => this.openRecipeModal());
        document.getElementById('import-recipe-btn')?.addEventListener('click', () => this.openRecipeImportModal());
        document.getElementById('recipe-form')?.addEventListener('submit', (e) => this.handleRecipeSubmit(e));
        document.getElementById('add-ingredient-btn')?.addEventListener('click', () => this.addIngredientToList());
        document.getElementById('new-ingredient')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.addIngredientToList(); }
        });
        document.getElementById('recipe-search')?.addEventListener('input', (e) => this.filterRecipes(e.target.value));

        // Recipe import
        document.getElementById('recipe-file-input')?.addEventListener('change', (e) => this.handleRecipeFileUpload(e));
        document.getElementById('parse-recipe-text-btn')?.addEventListener('click', () => this.parseRecipeText());
        document.getElementById('recipe-import-confirm-btn')?.addEventListener('click', () => this.confirmRecipeImport());
        document.getElementById('recipe-import-edit-btn')?.addEventListener('click', () => this.editImportedRecipe());

        // Recipe view modal actions
        document.getElementById('recipe-favorite-btn')?.addEventListener('click', () => this.toggleRecipeFavorite());
        document.getElementById('recipe-edit-btn')?.addEventListener('click', () => this.editCurrentRecipe());
        document.getElementById('recipe-delete-btn')?.addEventListener('click', () => this.deleteCurrentRecipe());
        document.getElementById('add-recipe-to-plan-btn')?.addEventListener('click', () => this.addRecipeToCurrentPlan());
        document.getElementById('add-ingredients-to-shopping-btn')?.addEventListener('click', () => this.addRecipeIngredientsToShopping());

        // Inventory
        document.getElementById('add-inventory-btn')?.addEventListener('click', () => this.openInventoryModal());
        document.getElementById('inventory-form')?.addEventListener('submit', (e) => this.handleInventorySubmit(e));
        document.querySelectorAll('.location-tab').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchInventoryLocation(e.target.dataset.location));
        });

        // Meal Planner
        document.getElementById('plan-week-btn')?.addEventListener('click', () => this.openPlannerWizard());
        document.getElementById('prev-week')?.addEventListener('click', () => this.navigateWeek(-1));
        document.getElementById('next-week')?.addEventListener('click', () => this.navigateWeek(1));
        document.getElementById('add-to-shopping-btn')?.addEventListener('click', () => this.addPlanToShopping());

        // Planner Wizard navigation
        document.querySelectorAll('.wizard-next').forEach(btn => {
            btn.addEventListener('click', () => this.wizardNext());
        });
        document.querySelectorAll('.wizard-back').forEach(btn => {
            btn.addEventListener('click', () => this.wizardBack());
        });
        document.getElementById('regenerate-btn')?.addEventListener('click', () => this.regenerateSuggestions());
        document.getElementById('accept-plan-btn')?.addEventListener('click', () => this.acceptMealPlan());

        // Must-include search
        document.getElementById('must-include-search')?.addEventListener('input', (e) => this.filterMustIncludeRecipes(e.target.value));

        // Ingredient check modal
        document.getElementById('ingredient-check-done-btn')?.addEventListener('click', () => this.finishIngredientCheck());

        // Category management
        document.getElementById('add-category-btn')?.addEventListener('click', () => this.addNewCategory());
        document.getElementById('new-category-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.addNewCategory(); }
        });

        // Modal close buttons
        document.querySelectorAll('.close-btn[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.dataset.close;
                document.getElementById(modalId)?.classList.add('hidden');
            });
        });

        // Close modals on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.add('hidden');
            });
        });
    },

    // Auth handlers
    // Show specific auth form (signin, signup, forgot)
    showAuthForm(form) {
        document.getElementById('signin-form-container')?.classList.add('hidden');
        document.getElementById('signup-form-container')?.classList.add('hidden');
        document.getElementById('forgot-password-container')?.classList.add('hidden');

        if (form === 'signin') {
            document.getElementById('signin-form-container')?.classList.remove('hidden');
        } else if (form === 'signup') {
            document.getElementById('signup-form-container')?.classList.remove('hidden');
        } else if (form === 'forgot') {
            document.getElementById('forgot-password-container')?.classList.remove('hidden');
        }
    },

    async handleSignIn(e) {
        e.preventDefault();

        const email = document.getElementById('signin-email')?.value.trim();
        const password = document.getElementById('signin-password')?.value;
        const btn = document.getElementById('signin-btn');

        if (!email || !password) {
            this.showToast('Please enter email and password');
            return;
        }

        try {
            btn.disabled = true;
            btn.textContent = 'Signing in...';

            await Auth.signIn(email, password);
            await this.handleSignedIn();
        } catch (error) {
            this.showToast(error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Sign In';
        }
    },

    async handleSignUp(e) {
        e.preventDefault();

        const name = document.getElementById('signup-name')?.value.trim();
        const email = document.getElementById('signup-email')?.value.trim();
        const password = document.getElementById('signup-password')?.value;
        const btn = document.getElementById('signup-btn');

        if (!name || !email || !password) {
            this.showToast('Please fill in all fields');
            return;
        }

        if (password.length < 6) {
            this.showToast('Password must be at least 6 characters');
            return;
        }

        try {
            btn.disabled = true;
            btn.textContent = 'Creating account...';

            await Auth.signUp(email, password, name);
            await this.handleSignedIn();
        } catch (error) {
            this.showToast(error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Account';
        }
    },

    async handleForgotPassword(e) {
        e.preventDefault();

        const email = document.getElementById('reset-email')?.value.trim();
        const btn = document.getElementById('reset-btn');

        if (!email) {
            this.showToast('Please enter your email');
            return;
        }

        try {
            btn.disabled = true;
            btn.textContent = 'Sending...';

            await Auth.sendPasswordReset(email);
            this.showToast('Password reset email sent! Check your inbox.');
            this.showAuthForm('signin');
        } catch (error) {
            this.showToast(error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Send Reset Link';
        }
    },

    async handleSignOut() {
        // Close the settings modal
        document.getElementById('settings-modal')?.classList.add('hidden');

        await Auth.signOut();
        Tasks.unsubscribeFromUpdates();
        Locations.unsubscribeFromUpdates();
        Recipes.unsubscribeFromUpdates();
        Inventory.unsubscribeFromUpdates();
        MealCategories.unsubscribeFromUpdates();
        MealPlanner.unsubscribeFromUpdates();
        Agenda.unsubscribeFromUpdates();
        this.showScreen('auth');
    },

    // Household handlers
    async handleCreateHousehold() {
        try {
            await Household.create();
            await this.loadHousehold();
            this.showScreen('main');
            // Show the invite code modal
            this.showHouseholdCreatedModal();
        } catch (error) {
            this.showToast('Failed to create household: ' + error.message);
        }
    },

    // Show household created modal with invite code
    showHouseholdCreatedModal() {
        const modal = document.getElementById('household-created-modal');
        const inviteCodeEl = document.getElementById('new-household-invite-code');

        if (modal && inviteCodeEl && Household.currentHousehold) {
            inviteCodeEl.textContent = Household.currentHousehold.inviteCode;
            modal.classList.remove('hidden');
        }
    },

    // Close household created modal and continue
    closeHouseholdCreatedModal() {
        const modal = document.getElementById('household-created-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    },

    // Handle calendar connection from onboarding modal
    async handleConnectCalendarOnboarding() {
        const btn = document.getElementById('connect-calendar-onboarding');
        const originalText = btn?.innerHTML;

        try {
            if (btn) {
                btn.innerHTML = 'Connecting...';
                btn.disabled = true;
            }

            const accessToken = await Auth.connectGoogleCalendar();

            if (accessToken) {
                this.showToast('Calendar connected!');
                // Update button to show success
                if (btn) {
                    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="margin-right: 8px;"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg> Connected!';
                    btn.classList.remove('btn-secondary');
                    btn.classList.add('btn-success');
                }
                // Load calendar data
                await this.loadTodayData();
            }
        } catch (error) {
            this.showToast('Could not connect calendar. Try again in Settings.');
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    },

    // Copy new invite code to clipboard
    async copyNewInviteCode() {
        const code = Household.currentHousehold?.inviteCode;
        if (code) {
            try {
                await navigator.clipboard.writeText(code);
                this.showToast('Invite code copied!');
            } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = code;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                this.showToast('Invite code copied!');
            }
        }
    },

    // Share invite code using Web Share API
    async shareInviteCode() {
        const code = Household.currentHousehold?.inviteCode;
        const householdName = Household.currentHousehold?.name || 'My Household';

        if (code && navigator.share) {
            try {
                await navigator.share({
                    title: 'Join my Household6',
                    text: `Join "${householdName}" on Household6! Use invite code: ${code}`,
                    url: window.location.origin
                });
            } catch (err) {
                // User cancelled or share failed
                if (err.name !== 'AbortError') {
                    this.copyNewInviteCode();
                }
            }
        } else {
            // Fallback to copy
            this.copyNewInviteCode();
        }
    },

    async handleJoinHousehold() {
        const code = document.getElementById('invite-code-input').value.trim();
        if (!code) {
            this.showToast('Please enter an invite code');
            return;
        }

        try {
            await Household.join(code);
            await this.loadHousehold();
            this.showScreen('main');
            this.showToast('Joined household!');
        } catch (error) {
            this.showToast(error.message);
        }
    },

    // Tab switching
    switchTab(tabName) {
        this.currentTab = tabName;

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `${tabName}-tab`);
            panel.classList.toggle('hidden', panel.id !== `${tabName}-tab`);
        });

        if (tabName === 'calendar') {
            this.renderCalendar();
        }
    },

    // Voice input
    openVoiceModal() {
        document.getElementById('voice-modal').classList.remove('hidden');
        this.startVoiceInput();
    },

    closeVoiceModal() {
        Voice.stop();
        document.getElementById('voice-modal').classList.add('hidden');
    },

    startVoiceInput() {
        const indicator = document.getElementById('voice-indicator');
        const statusText = document.getElementById('voice-status-text');
        const transcript = document.getElementById('voice-transcript');
        const result = document.getElementById('voice-result');

        indicator.classList.add('listening');
        statusText.textContent = 'Listening...';
        transcript.textContent = '';
        result.classList.add('hidden');

        Voice.onResult = (text, isFinal) => {
            transcript.textContent = text;
            if (isFinal) {
                indicator.classList.remove('listening');
                statusText.textContent = 'Processing...';
            }
        };

        Voice.onEnd = async (text) => {
            indicator.classList.remove('listening');
            if (text) {
                await this.processVoiceInput(text);
            } else {
                statusText.textContent = 'No speech detected. Tap to try again.';
            }
        };

        Voice.onError = (error) => {
            indicator.classList.remove('listening');
            statusText.textContent = `Error: ${error}. Tap to try again.`;
        };

        if (!Voice.start()) {
            statusText.textContent = 'Speech recognition not available';
        }
    },

    async processVoiceInput(text) {
        const parsed = await Voice.parse(text);
        this.pendingVoiceAction = parsed;

        const statusText = document.getElementById('voice-status-text');
        const result = document.getElementById('voice-result');
        const parsedResult = document.getElementById('parsed-result');

        statusText.textContent = 'Is this correct?';
        result.classList.remove('hidden');

        let html = '';

        if (parsed.type === 'list') {
            html = '<div class="label">Action</div><div class="value">Show task list</div>';
        } else if (parsed.type === 'complete') {
            html = `
                <div class="label">Action</div>
                <div class="value">Mark as complete</div>
                <div class="label">Task</div>
                <div class="value">${parsed.title || 'Not found'}</div>
            `;
        } else if (parsed.type === 'event') {
            html = `
                <div class="label">Type</div>
                <div class="value">Calendar Event</div>
                <div class="label">Title</div>
                <div class="value">${esc(parsed.title) || 'Untitled'}</div>
                <div class="label">When</div>
                <div class="value">${parsed.date ? esc(parsed.date.toLocaleString()) : 'Not specified'}</div>
                ${parsed.location ? `<div class="label">Location</div><div class="value">${esc(parsed.location)}</div>` : ''}
            `;
        } else {
            html = `
                <div class="label">Type</div>
                <div class="value">Task</div>
                <div class="label">Title</div>
                <div class="value">${esc(parsed.title) || 'Untitled'}</div>
                ${parsed.recurring ? `<div class="label">Repeats</div><div class="value">${esc(parsed.frequency)}</div>` : ''}
            `;
        }

        parsedResult.innerHTML = html;
    },

    async confirmVoiceInput() {
        if (!this.pendingVoiceAction) return;

        try {
            const result = await Voice.execute(this.pendingVoiceAction);

            let message = '';
            switch (result.action) {
                case 'eventCreated':
                    message = `Event "${result.event.title}" created`;
                    break;
                case 'taskCreated':
                    message = `Task "${result.task.title}" created`;
                    break;
                case 'completed':
                    message = `"${result.task.title}" marked complete`;
                    break;
                case 'list':
                    message = `You have ${result.tasks.length} pending tasks`;
                    break;
                case 'ambiguous':
                    message = `Found ${result.matches.length} matching tasks. Please be more specific.`;
                    break;
                case 'notFound':
                    message = `Could not find task "${result.query}"`;
                    break;
                default:
                    message = 'Action completed';
            }

            this.showToast(message);
            this.closeVoiceModal();

            // Refresh data
            if (result.action === 'eventCreated') {
                await this.loadTodayData();
            }

        } catch (error) {
            this.showToast('Error: ' + error.message);
        }

        this.pendingVoiceAction = null;
    },

    // Task handlers
    openTaskModal(task = null) {
        const modal = document.getElementById('task-modal');
        const title = document.getElementById('task-modal-title');
        const form = document.getElementById('task-form');
        const assigneeSelect = document.getElementById('task-assignee');

        title.textContent = task ? 'Edit Task' : 'Add Task';
        form.reset();

        // Populate assignee dropdown
        assigneeSelect.innerHTML = '<option value="">Anyone</option>';
        Household.members.forEach(member => {
            const option = document.createElement('option');
            option.value = member.uid;
            option.textContent = member.displayName;
            assigneeSelect.appendChild(option);
        });

        if (task) {
            document.getElementById('task-title').value = task.title;
            document.getElementById('task-assignee').value = task.assignee || '';
            document.getElementById('task-recurring').checked = task.recurring;
            document.getElementById('task-frequency').value = task.frequency || 'daily';
            document.getElementById('recurring-options').classList.toggle('hidden', !task.recurring);
            form.dataset.taskId = task.id;
        } else {
            delete form.dataset.taskId;
        }

        modal.classList.remove('hidden');
    },

    async handleTaskSubmit(e) {
        e.preventDefault();

        const form = e.target;
        const taskData = {
            title: document.getElementById('task-title').value,
            assignee: document.getElementById('task-assignee').value || null,
            recurring: document.getElementById('task-recurring').checked,
            frequency: document.getElementById('task-recurring').checked
                ? document.getElementById('task-frequency').value
                : null
        };

        try {
            if (form.dataset.taskId) {
                await Tasks.update(form.dataset.taskId, taskData);
                this.showToast('Task updated');
            } else {
                await Tasks.create(taskData);
                this.showToast('Task created');
            }

            document.getElementById('task-modal').classList.add('hidden');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Settings handlers
    async openSettingsModal() {
        const modal = document.getElementById('settings-modal');

        // Update theme select
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = localStorage.getItem('theme') || 'system';
        }

        // Update invite code
        document.getElementById('current-invite-code').textContent =
            Household.currentHousehold?.inviteCode || '------';

        // Update members list
        const membersList = document.getElementById('household-members');
        membersList.innerHTML = Household.members.map(member => `
            <span class="member-chip">${esc(member.displayName)}</span>
        `).join('');

        // Check if calendar is connected (we have an access token)
        const hasCalendarAccess = !!Auth.accessToken;
        const householdCalendarId = Household.currentHousehold?.selectedCalendarId;

        document.getElementById('calendar-not-connected')?.classList.toggle('hidden', hasCalendarAccess);
        document.getElementById('calendar-connected')?.classList.toggle('hidden', !hasCalendarAccess);

        // Show household calendar info if one is set
        const calendarInfoEl = document.getElementById('household-calendar-info');
        const calendarNameEl = document.getElementById('household-calendar-name');
        const calendarStatusEl = document.getElementById('household-calendar-status');

        // Load calendars if connected
        if (hasCalendarAccess) {
            const calendarSelect = document.getElementById('calendar-select');
            const calendars = await Calendar.getCalendarList();
            calendarSelect.innerHTML = '<option value="">Select a calendar...</option>';

            let householdCalendarFound = false;
            let householdCalendarName = null;

            calendars.forEach(cal => {
                const option = document.createElement('option');
                option.value = cal.id;
                option.textContent = cal.summary;
                option.selected = cal.id === Calendar.selectedCalendarId;
                calendarSelect.appendChild(option);

                // Check if this user has access to the household calendar
                if (cal.id === householdCalendarId) {
                    householdCalendarFound = true;
                    householdCalendarName = cal.summary;
                }
            });

            // Show household calendar status
            if (householdCalendarId) {
                calendarInfoEl?.classList.remove('hidden');
                if (householdCalendarFound) {
                    calendarNameEl.textContent = householdCalendarName;
                    calendarStatusEl.innerHTML = '<span style="color: var(--success);">&#10003;</span> You have access to this calendar';
                    // Auto-select if not already selected
                    if (!Calendar.selectedCalendarId) {
                        calendarSelect.value = householdCalendarId;
                        await Calendar.setSelectedCalendar(householdCalendarId);
                    }
                } else {
                    calendarNameEl.textContent = 'Shared calendar (ID: ' + householdCalendarId.substring(0, 20) + '...)';
                    calendarStatusEl.innerHTML = '<span style="color: var(--warning);">!</span> Make sure this calendar is shared with your Google account';
                }
            } else {
                calendarInfoEl?.classList.add('hidden');
            }
        } else if (householdCalendarId) {
            // Not connected but household has a calendar set
            calendarInfoEl?.classList.remove('hidden');
            calendarNameEl.textContent = 'Calendar configured';
            calendarStatusEl.textContent = 'Connect your Google account to access it';
        } else {
            calendarInfoEl?.classList.add('hidden');
        }

        // Load user settings
        const userData = await Auth.getUserData();
        if (userData) {
            document.getElementById('morning-report-time').value = userData.morningReportTime || '07:00';
            document.getElementById('buffer-time').value = userData.bufferMinutes || 20;
            document.getElementById('home-address').value = userData.homeAddress || '';
        }

        modal.classList.remove('hidden');
    },

    async handleConnectCalendar() {
        try {
            this.showToast('Opening Google sign-in...');

            // Connect Google Calendar
            const accessToken = await Auth.connectGoogleCalendar();

            if (accessToken) {
                this.showToast('Calendar connected!');
                // Update UI to show connected state
                document.getElementById('calendar-not-connected')?.classList.add('hidden');
                document.getElementById('calendar-connected')?.classList.remove('hidden');

                // Load calendars
                const calendars = await Calendar.getCalendarList();
                const calendarSelect = document.getElementById('calendar-select');
                const householdCalendarId = Household.currentHousehold?.selectedCalendarId;

                calendarSelect.innerHTML = '<option value="">Select a calendar...</option>';

                let householdCalendarFound = false;
                let householdCalendarName = null;

                calendars.forEach(cal => {
                    const option = document.createElement('option');
                    option.value = cal.id;
                    option.textContent = cal.summary;
                    calendarSelect.appendChild(option);

                    if (cal.id === householdCalendarId) {
                        householdCalendarFound = true;
                        householdCalendarName = cal.summary;
                    }
                });

                // Auto-select household calendar if available
                if (householdCalendarId && householdCalendarFound) {
                    calendarSelect.value = householdCalendarId;
                    await Calendar.setSelectedCalendar(householdCalendarId);

                    // Update the household calendar info display
                    const calendarInfoEl = document.getElementById('household-calendar-info');
                    const calendarNameEl = document.getElementById('household-calendar-name');
                    const calendarStatusEl = document.getElementById('household-calendar-status');
                    calendarInfoEl?.classList.remove('hidden');
                    calendarNameEl.textContent = householdCalendarName;
                    calendarStatusEl.innerHTML = '<span style="color: var(--success);">&#10003;</span> You have access to this calendar';

                    this.showToast('Connected to household calendar: ' + householdCalendarName);
                    await this.loadTodayData();
                } else if (householdCalendarId) {
                    // Household has a calendar but user doesn't have access
                    const calendarInfoEl = document.getElementById('household-calendar-info');
                    const calendarNameEl = document.getElementById('household-calendar-name');
                    const calendarStatusEl = document.getElementById('household-calendar-status');
                    calendarInfoEl?.classList.remove('hidden');
                    calendarNameEl.textContent = 'Shared calendar';
                    calendarStatusEl.innerHTML = '<span style="color: var(--warning);">!</span> Ask a household member to share this calendar with you';
                }
            } else {
                this.showToast('Could not get calendar access.');
            }
        } catch (error) {
            // Calendar connect error
            this.showToast('Error: ' + error.message);
        }
    },

    async handleCalendarSelect(e) {
        const calendarId = e.target.value;
        if (calendarId) {
            await Calendar.setSelectedCalendar(calendarId);
            await this.loadTodayData();
            this.showToast('Calendar synced!');
        }
    },

    async copyInviteCode() {
        const code = Household.currentHousehold?.inviteCode;
        if (code) {
            await navigator.clipboard.writeText(code);
            this.showToast('Invite code copied!');
        }
    },

    // Text input handler
    async handleTextInput(text) {
        try {
            // Show loading indicator
            this.showToast('Processing...');

            const parsed = await AI.parseInput(text);

            if (parsed.items && parsed.items.length > 1) {
                // Multiple items - show document preview modal
                this.openDocumentModal();
                this.pendingDocumentItems = parsed.items;
                this.showDocumentPreview(parsed.items, 'Text Input');
            } else if (parsed.items && parsed.items.length === 1) {
                // Single item - create directly with confirmation
                const item = parsed.items[0];
                const result = await Voice.execute(item);

                if (result.action === 'eventCreated') {
                    this.showToast(`✓ Event created: "${result.event.title}"`);
                    await this.loadTodayData();
                } else if (result.action === 'taskCreated') {
                    this.showToast(`✓ Task created: "${result.task.title}"`);
                    await this.loadTodayData();
                } else if (result.action === 'shoppingAdded') {
                    this.showToast(`✓ Added to shopping list: "${result.item.name}"`);
                } else {
                    this.showToast('Item created');
                }
            } else {
                this.showToast('Could not understand input');
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // File upload handler
    async handleFileUpload(file) {
        this.openDocumentModal();

        try {
            const text = await this.extractTextFromFile(file);

            if (!text || text.trim().length < 10) {
                throw new Error('Could not extract text from file');
            }

            const parsed = await AI.parseDocument(text, file.name);

            if (!parsed.items || parsed.items.length === 0) {
                throw new Error('No events or tasks found in document');
            }

            this.pendingDocumentItems = parsed.items;
            this.showDocumentPreview(parsed.items, file.name);
        } catch (error) {
            this.showDocumentError(error.message);
        }
    },

    // Extract text from various file types
    async extractTextFromFile(file) {
        const type = file.type;
        const name = file.name.toLowerCase();

        // Plain text files
        if (type.startsWith('text/') || name.endsWith('.txt')) {
            return await file.text();
        }

        // PDF files
        if (type === 'application/pdf' || name.endsWith('.pdf')) {
            return await this.extractTextFromPDF(file);
        }

        // Images - we'll just read as text for now (user can paste OCR'd text)
        if (type.startsWith('image/')) {
            throw new Error('Image files not yet supported. Please paste the text directly.');
        }

        // Word documents - basic handling
        if (name.endsWith('.docx') || name.endsWith('.doc')) {
            throw new Error('Word files not yet supported. Please paste the text directly.');
        }

        throw new Error('Unsupported file type. Try .txt or .pdf');
    },

    // Extract text from PDF using pdf.js
    async extractTextFromPDF(file) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF library not loaded');
        }

        // Set worker path
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        return fullText;
    },

    // Document modal methods
    openDocumentModal() {
        const modal = document.getElementById('document-modal');
        document.getElementById('document-modal-title').textContent = 'Processing Document...';
        document.getElementById('document-loading').classList.remove('hidden');
        document.getElementById('document-preview').classList.add('hidden');
        document.getElementById('document-error').classList.add('hidden');
        modal.classList.remove('hidden');
    },

    closeDocumentModal() {
        document.getElementById('document-modal').classList.add('hidden');
        this.pendingDocumentItems = null;
    },

    showDocumentPreview(items, sourceName) {
        document.getElementById('document-loading').classList.add('hidden');
        document.getElementById('document-error').classList.add('hidden');
        document.getElementById('document-preview').classList.remove('hidden');

        const eventCount = items.filter(i => i.type === 'event').length;
        const todoCount = items.filter(i => i.type === 'todo' || i.type === 'task').length;
        const shoppingCount = items.filter(i => i.type === 'shopping').length;

        document.getElementById('document-modal-title').textContent = `Found ${items.length} Items`;

        let summaryParts = [`From: ${sourceName}`];
        if (eventCount > 0) summaryParts.push(`${eventCount} events`);
        if (todoCount > 0) summaryParts.push(`${todoCount} tasks`);
        if (shoppingCount > 0) summaryParts.push(`${shoppingCount} shopping items`);
        document.getElementById('preview-summary').textContent = summaryParts.join(' | ');

        const container = document.getElementById('preview-items');
        container.innerHTML = items.map((item, index) => {
            let icon = '✓';
            let meta = '';

            if (item.type === 'event') {
                icon = '📅';
                const dateStr = item.date ?
                    (item.date instanceof Date ? item.date.toLocaleDateString() : item.date) :
                    'No date';
                const timeStr = item.time ?
                    `${item.time.hours}:${String(item.time.minutes || 0).padStart(2, '0')}` :
                    (item.default_time || '');
                meta = `${dateStr}${timeStr ? ' at ' + timeStr : ''}${item.location ? ' · ' + item.location : ''}`;
            } else if (item.type === 'shopping') {
                icon = '🛒';
                meta = item.category || 'Shopping list';
            } else {
                // Task/todo
                const dateStr = item.date ?
                    (item.date instanceof Date ? item.date.toLocaleDateString() : item.date) :
                    'No date';
                meta = dateStr;
            }

            return `
                <div class="preview-item">
                    <input type="checkbox" class="preview-item-checkbox" data-index="${index}" checked>
                    <span class="preview-item-icon">${icon}</span>
                    <div class="preview-item-details">
                        <div class="preview-item-title">${esc(item.title)}</div>
                        <div class="preview-item-meta">${esc(meta)}</div>
                    </div>
                </div>
            `;
        }).join('');
    },

    showDocumentError(message) {
        document.getElementById('document-loading').classList.add('hidden');
        document.getElementById('document-preview').classList.add('hidden');
        document.getElementById('document-error').classList.remove('hidden');
        document.getElementById('document-error-msg').textContent = message;
        document.getElementById('document-modal-title').textContent = 'Error';
    },

    async confirmDocumentItems() {
        if (!this.pendingDocumentItems) return;

        const checkboxes = document.querySelectorAll('.preview-item-checkbox');
        const selectedIndices = Array.from(checkboxes)
            .filter(cb => cb.checked)
            .map(cb => parseInt(cb.dataset.index));

        const itemsToCreate = selectedIndices.map(i => this.pendingDocumentItems[i]);

        if (itemsToCreate.length === 0) {
            this.showToast('No items selected');
            return;
        }

        let eventsCreated = 0;
        let tasksCreated = 0;
        let shoppingAdded = 0;
        let errors = 0;

        for (const item of itemsToCreate) {
            try {
                const result = await Voice.execute(item);
                if (result.action === 'eventCreated') eventsCreated++;
                if (result.action === 'taskCreated') tasksCreated++;
                if (result.action === 'shoppingAdded') shoppingAdded++;
            } catch (error) {
                // Error creating item
                errors++;
            }
        }

        this.closeDocumentModal();

        let parts = [];
        if (eventsCreated > 0) parts.push(`${eventsCreated} event${eventsCreated > 1 ? 's' : ''}`);
        if (tasksCreated > 0) parts.push(`${tasksCreated} task${tasksCreated > 1 ? 's' : ''}`);
        if (shoppingAdded > 0) parts.push(`${shoppingAdded} shopping item${shoppingAdded > 1 ? 's' : ''}`);

        let message = parts.join(', ') + ' created';
        if (errors > 0) message += ` (${errors} failed)`;

        this.showToast(message);
        await this.loadTodayData();
    },

    // Location handlers
    openLocationModal() {
        const modal = document.getElementById('location-modal');
        document.getElementById('location-form').reset();
        modal.classList.remove('hidden');
    },

    async handleLocationSubmit(e) {
        e.preventDefault();

        const name = document.getElementById('location-name').value;
        const address = document.getElementById('location-address').value;

        try {
            await Locations.add(name, address);
            document.getElementById('location-modal').classList.add('hidden');
            this.showToast('Location saved');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Rendering methods
    renderTasks(tasks) {
        // Today tab - now handled by renderTodayTasks()
        this.renderTodayTasks();

        // Tasks tab - grouped by status
        this.renderGroupedTasks();
    },

    // Render shopping list
    renderShoppingList(items) {
        const container = document.getElementById('shopping-list');
        const checkedContainer = document.getElementById('checked-items');
        const checkedList = document.getElementById('checked-items-list');

        if (!container) return;

        const unchecked = Shopping.getUnchecked();
        const checked = Shopping.getChecked();

        // Render unchecked items grouped by category
        if (unchecked.length === 0) {
            container.innerHTML = '<p class="empty-state">No items on your list</p>';
        } else {
            const grouped = Shopping.getGroupedByCategory();
            let html = '';

            for (const [category, categoryItems] of Object.entries(grouped)) {
                html += `
                    <div class="shopping-category">
                        <h4 class="category-label">${esc(category)}</h4>
                        ${categoryItems.map(item => this.renderShoppingItem(item)).join('')}
                    </div>
                `;
            }

            container.innerHTML = html;

            // Add click handlers
            container.querySelectorAll('.shopping-item').forEach(el => {
                el.addEventListener('click', () => this.toggleShoppingItem(el.dataset.itemId));
            });
        }

        // Render checked items
        if (checked.length > 0) {
            checkedContainer.classList.remove('hidden');
            checkedList.innerHTML = checked.map(item => this.renderShoppingItem(item, true)).join('');

            // Add click handlers for checked items
            checkedList.querySelectorAll('.shopping-item').forEach(el => {
                el.addEventListener('click', () => this.toggleShoppingItem(el.dataset.itemId));
            });
        } else {
            checkedContainer.classList.add('hidden');
        }
    },

    // Render a single shopping item
    renderShoppingItem(item, isChecked = false) {
        const displayText = Shopping.formatItem(item);
        return `
            <div class="shopping-item ${isChecked ? 'checked' : ''}" data-item-id="${esc(item.id)}">
                <span class="shopping-checkbox">${isChecked ? '☑' : '☐'}</span>
                <span class="shopping-name">${esc(displayText)}</span>
            </div>
        `;
    },

    // Toggle shopping item checked state
    async toggleShoppingItem(itemId) {
        try {
            await Shopping.toggleChecked(itemId);
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Clear all checked shopping items
    async clearCheckedItems() {
        try {
            const count = await Shopping.clearChecked();
            if (count > 0) {
                this.showToast(`Cleared ${count} item${count > 1 ? 's' : ''}`);
            } else {
                this.showToast('No checked items to clear');
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Render all tasks grouped by status (for Tasks tab)
    renderGroupedTasks() {
        const container = document.getElementById('all-tasks');
        if (!container) return;

        const grouped = Tasks.getGrouped();
        const hasAnyTasks = grouped.overdue.length + grouped.today.length +
                           grouped.upcoming.length + grouped.noDate.length > 0;

        if (!hasAnyTasks) {
            container.innerHTML = '<p class="empty-state">No tasks yet</p>';
            return;
        }

        let html = '';

        // Overdue
        if (grouped.overdue.length > 0) {
            html += `
                <div class="task-group overdue-section">
                    <h4 class="section-label overdue-label">Overdue (${grouped.overdue.length})</h4>
                    ${grouped.overdue.map(task => this.renderFullTaskItem(task, 'overdue')).join('')}
                </div>
            `;
        }

        // Today
        if (grouped.today.length > 0) {
            html += `
                <div class="task-group">
                    <h4 class="section-label">Today (${grouped.today.length})</h4>
                    ${grouped.today.map(task => this.renderFullTaskItem(task, 'today')).join('')}
                </div>
            `;
        }

        // Upcoming - grouped by date
        if (grouped.upcoming.length > 0) {
            html += `<div class="task-group"><h4 class="section-label">Upcoming</h4>`;
            const byDate = this.groupTasksByDate(grouped.upcoming);
            for (const [dateStr, dateTasks] of Object.entries(byDate)) {
                html += `
                    <div class="date-subgroup">
                        <span class="date-label">${dateStr}</span>
                        ${dateTasks.map(task => this.renderFullTaskItem(task, 'upcoming')).join('')}
                    </div>
                `;
            }
            html += `</div>`;
        }

        // No date (Someday)
        if (grouped.noDate.length > 0) {
            html += `
                <div class="task-group">
                    <h4 class="section-label">Someday</h4>
                    ${grouped.noDate.map(task => this.renderFullTaskItem(task, 'no-date')).join('')}
                </div>
            `;
        }

        container.innerHTML = html;
    },

    // Group tasks by their due date string
    groupTasksByDate(tasks) {
        const groups = {};
        tasks.forEach(task => {
            const dateStr = Tasks.formatDueDate(task).split(' at ')[0]; // Get just the date part
            if (!groups[dateStr]) groups[dateStr] = [];
            groups[dateStr].push(task);
        });
        return groups;
    },

    // Render a task item for the full Tasks page
    renderFullTaskItem(task, status) {
        const statusClass = status === 'overdue' ? 'task-overdue' : '';
        const dueText = Tasks.formatDueDate(task);

        return `
            <div class="task-item ${statusClass}" data-task-id="${esc(task.id)}" onclick="App.toggleTask('${esc(task.id)}')">
                <span class="task-checkbox">${task.completed ? '☑' : '☐'}</span>
                <div class="task-details">
                    <div class="task-title">
                        ${esc(task.title)}
                        ${task.recurring ? '<span class="task-recurring-badge">Recurring</span>' : ''}
                    </div>
                    ${task.assignee ? `<div class="task-assignee">Assigned to ${esc(Household.getMemberName(task.assignee))}</div>` : ''}
                </div>
                ${dueText ? `<span class="task-due">${esc(dueText)}</span>` : ''}
            </div>
        `;
    },

    async toggleTask(taskId) {
        try {
            const task = Tasks.tasks.find(t => t.id === taskId);
            await Tasks.toggleComplete(taskId);

            // Notify other household members
            if (!task.completed) {
                // Task was just completed
                Notifications.sendTaskCompleted(task, Auth.currentUser.uid);
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    renderTodayEvents(events) {
        const container = document.getElementById('today-events');
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = '<p class="empty-state">No events today</p>';
            return;
        }

        container.innerHTML = events.map(event => `
            <div class="event-item">
                <div class="event-time">${esc(Calendar.formatTime(event.startDate))}</div>
                <div class="event-details">
                    <div class="event-title">${esc(event.title)}</div>
                    ${event.location ? `<div class="event-location">📍 ${esc(event.location)}</div>` : ''}
                </div>
            </div>
        `).join('');
    },

    renderLocations(locations) {
        const container = document.getElementById('saved-locations');
        if (!container) return;

        if (locations.length === 0) {
            container.innerHTML = '<p class="empty-state">No saved locations</p>';
            return;
        }

        container.innerHTML = locations.map(loc => `
            <div class="location-item">
                <div>
                    <div class="location-name">${esc(loc.name)}</div>
                    <div class="location-address">${esc(loc.address)}</div>
                </div>
                <button class="delete-btn" onclick="App.deleteLocation('${esc(loc.id)}')">&times;</button>
            </div>
        `).join('');
    },

    async deleteLocation(locationId) {
        try {
            await Locations.delete(locationId);
            this.showToast('Location deleted');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Calendar rendering
    navigateMonth(delta) {
        this.currentMonth.setMonth(this.currentMonth.getMonth() + delta);
        this.renderCalendar();
    },

    async renderCalendar() {
        const monthLabel = document.getElementById('calendar-month');
        const grid = document.getElementById('calendar-grid');

        const year = this.currentMonth.getFullYear();
        const month = this.currentMonth.getMonth();

        monthLabel.textContent = this.currentMonth.toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
        });

        // Get events for this month
        const events = await Calendar.getMonthEvents(year, month);

        // Group events by date and count them
        const eventsByDate = {};
        events.forEach(e => {
            const dateStr = e.startDate.toISOString().split('T')[0];
            if (!eventsByDate[dateStr]) {
                eventsByDate[dateStr] = [];
            }
            eventsByDate[dateStr].push(e);
        });

        // Store for use when selecting a date
        this.monthEvents = events;

        // Build calendar grid
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startPadding = firstDay.getDay();
        const totalDays = lastDay.getDate();

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const selectedStr = this.selectedDate ?
            `${this.selectedDate.getFullYear()}-${String(this.selectedDate.getMonth() + 1).padStart(2, '0')}-${String(this.selectedDate.getDate()).padStart(2, '0')}` :
            null;

        let html = `
            <div class="calendar-weekdays">
                <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div>
                <div>Thu</div><div>Fri</div><div>Sat</div>
            </div>
            <div class="calendar-days">
        `;

        // Previous month padding
        const prevMonth = new Date(year, month, 0);
        for (let i = startPadding - 1; i >= 0; i--) {
            html += `<div class="calendar-day other-month">${prevMonth.getDate() - i}</div>`;
        }

        // Current month days
        for (let day = 1; day <= totalDays; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedStr;
            const dayEvents = eventsByDate[dateStr] || [];
            const hasEvent = dayEvents.length > 0;
            const eventCount = dayEvents.length;

            let classes = 'calendar-day';
            if (isToday) classes += ' today';
            if (isSelected) classes += ' selected';
            if (hasEvent) classes += ' has-event';

            html += `
                <div class="${classes}" onclick="App.selectDate('${dateStr}')">
                    <span class="day-number">${day}</span>
                    ${eventCount > 1 ? `<span class="event-count">${eventCount}</span>` : ''}
                </div>
            `;
        }

        // Next month padding
        const remainingCells = 42 - (startPadding + totalDays);
        for (let i = 1; i <= remainingCells; i++) {
            html += `<div class="calendar-day other-month">${i}</div>`;
        }

        html += '</div>';
        grid.innerHTML = html;

        // Render upcoming events
        this.renderUpcomingEvents(events);
    },

    async selectDate(dateStr) {
        const date = new Date(dateStr + 'T00:00:00');
        this.selectedDate = date;

        // Highlight selected day
        document.querySelectorAll('.calendar-day').forEach(day => {
            day.classList.remove('selected');
        });
        // Find the clicked element (may be span inside div)
        const clickedDay = document.querySelector(`.calendar-day[onclick*="${dateStr}"]`);
        if (clickedDay) clickedDay.classList.add('selected');

        // Show selected day section
        const section = document.getElementById('selected-day-section');
        const container = document.getElementById('selected-day-events');
        const dateLabel = document.getElementById('selected-day-date');

        // Format the date nicely
        const dateOptions = { weekday: 'long', month: 'long', day: 'numeric' };
        dateLabel.textContent = date.toLocaleDateString('en-US', dateOptions);

        section.classList.remove('hidden');

        // Load events for this day
        const events = await Calendar.getDayEvents(date);

        if (events.length === 0) {
            container.innerHTML = '<p class="empty-state">No events on this day</p>';
        } else {
            container.innerHTML = events.map(event => `
                <div class="event-item">
                    <div class="event-time">${event.allDay ? 'All day' : esc(Calendar.formatTime(event.startDate))}</div>
                    <div class="event-details">
                        <div class="event-title">${esc(event.title)}</div>
                        ${event.location ? `<div class="event-location">📍 ${esc(event.location)}</div>` : ''}
                    </div>
                </div>
            `).join('');
        }
    },

    // Render upcoming events section
    renderUpcomingEvents(events) {
        const container = document.getElementById('upcoming-events');
        if (!container) return;

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // Filter to only future events and sort by date
        const upcoming = events
            .filter(e => e.startDate >= now)
            .sort((a, b) => a.startDate - b.startDate)
            .slice(0, 5); // Show max 5 upcoming events

        if (upcoming.length === 0) {
            container.innerHTML = '<p class="empty-state">No upcoming events</p>';
            return;
        }

        container.innerHTML = upcoming.map(event => {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dayNum = event.startDate.getDate();
            const dayName = dayNames[event.startDate.getDay()];
            const timeStr = event.allDay ? 'All day' : Calendar.formatTime(event.startDate);

            return `
                <div class="upcoming-event-item">
                    <div class="upcoming-event-date">
                        <div class="day-num">${dayNum}</div>
                        <div class="day-name">${esc(dayName)}</div>
                    </div>
                    <div class="upcoming-event-details">
                        <div class="upcoming-event-title">${esc(event.title)}</div>
                        <div class="upcoming-event-time">${esc(timeStr)}</div>
                        ${event.location ? `<div class="upcoming-event-location">📍 ${esc(event.location)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    // Theme management
    initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'system';
        this.applyTheme(savedTheme);

        // Update select if it exists
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = savedTheme;
        }
    },

    setTheme(theme) {
        localStorage.setItem('theme', theme);
        this.applyTheme(theme);
    },

    applyTheme(theme) {
        const root = document.documentElement;

        if (theme === 'system') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', theme);
        }

        // Update meta theme-color for mobile browsers
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                metaTheme.content = '#1A1F1C';
            } else {
                metaTheme.content = '#7D9B8C';
            }
        }
    },

    // Update household UI
    updateHouseholdUI() {
        document.getElementById('household-name').textContent =
            Household.currentHousehold?.name || 'My Household';
    },

    // Check calendar access status - NEVER auto-triggers popup (that would be blocked)
    async ensureCalendarAccess() {
        // If we already have a token, we're good
        if (Auth.accessToken) {
            this.updateCalendarUI(true);
            return true;
        }

        // If Google was linked but token expired, just update UI to show disconnected
        // User must manually click "Connect Calendar" button to trigger popup
        if (Auth.calendarConnected) {
            this.updateCalendarUI(false);
            // Don't show toast on page load - too annoying
        }

        return false;
    },

    // Update calendar connection status in Settings UI
    updateCalendarUI(connected) {
        const notConnected = document.getElementById('calendar-not-connected');
        const connectedEl = document.getElementById('calendar-connected');

        if (connected) {
            notConnected?.classList.add('hidden');
            connectedEl?.classList.remove('hidden');
        } else {
            notConnected?.classList.remove('hidden');
            connectedEl?.classList.add('hidden');
        }
    },

    // ==================== AGENDA HANDLERS ====================

    // Render agenda items
    renderAgenda(items) {
        const pendingContainer = document.getElementById('agenda-pending');
        const resolvedContainer = document.getElementById('agenda-resolved');
        const resolvedSection = document.getElementById('resolved-section');

        if (!pendingContainer) return;

        const pending = Agenda.getPending();
        const resolved = Agenda.getResolved();

        // Render pending items
        if (pending.length === 0) {
            pendingContainer.innerHTML = '<p class="empty-state">No agenda items. Add topics for your next meeting!</p>';
        } else {
            pendingContainer.innerHTML = pending.map(item => this.renderAgendaItem(item)).join('');
            this.attachAgendaItemListeners(pendingContainer);
        }

        // Render resolved items
        if (resolved.length > 0) {
            resolvedSection.classList.remove('hidden');
            resolvedContainer.innerHTML = resolved.map(item => this.renderAgendaItem(item)).join('');
            this.attachAgendaItemListeners(resolvedContainer);
        } else {
            resolvedSection.classList.add('hidden');
        }
    },

    // Render a single agenda item
    renderAgendaItem(item) {
        const priorityLabel = {
            high: 'Urgent',
            normal: 'Normal',
            low: 'Low Priority'
        };

        return `
            <div class="agenda-item priority-${item.priority} ${item.resolved ? 'resolved' : ''}" data-id="${esc(item.id)}">
                <div class="agenda-item-header">
                    <span class="agenda-item-topic">${esc(item.topic)}</span>
                    <div class="agenda-item-actions">
                        <button class="icon-btn agenda-resolve-btn" title="${item.resolved ? 'Reopen' : 'Mark Resolved'}">
                            ${item.resolved ? '↩' : '✓'}
                        </button>
                        <button class="icon-btn agenda-edit-btn" title="Edit">✎</button>
                        <button class="icon-btn agenda-delete-btn" title="Delete">×</button>
                    </div>
                </div>
                ${item.description ? `<p class="agenda-item-description">${esc(item.description)}</p>` : ''}
                <div class="agenda-item-meta">
                    <span class="agenda-item-priority">${priorityLabel[item.priority]}</span>
                    <span>Added by ${esc(item.addedByName)} · ${Agenda.formatDate(item.createdAt)}</span>
                </div>
            </div>
        `;
    },

    // Attach event listeners to agenda items
    attachAgendaItemListeners(container) {
        container.querySelectorAll('.agenda-resolve-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.closest('.agenda-item').dataset.id;
                try {
                    await Agenda.toggleResolved(id);
                } catch (error) {
                    this.showToast('Error: ' + error.message);
                }
            });
        });

        container.querySelectorAll('.agenda-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.closest('.agenda-item').dataset.id;
                const item = Agenda.getById(id);
                if (item) this.openAgendaModal(item);
            });
        });

        container.querySelectorAll('.agenda-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.closest('.agenda-item').dataset.id;
                if (confirm('Delete this agenda item?')) {
                    try {
                        await Agenda.delete(id);
                        this.showToast('Item deleted');
                    } catch (error) {
                        this.showToast('Error: ' + error.message);
                    }
                }
            });
        });
    },

    // Open agenda modal
    openAgendaModal(item = null) {
        const modal = document.getElementById('agenda-modal');
        const title = document.getElementById('agenda-modal-title');
        const form = document.getElementById('agenda-form');

        form.reset();
        document.getElementById('agenda-edit-id').value = '';
        document.getElementById('agenda-added-by').value = Auth.currentUser?.displayName || 'You';

        if (item) {
            title.textContent = 'Edit Agenda Item';
            document.getElementById('agenda-topic').value = item.topic;
            document.getElementById('agenda-description').value = item.description || '';
            document.getElementById('agenda-priority').value = item.priority;
            document.getElementById('agenda-edit-id').value = item.id;
            document.getElementById('agenda-added-by').value = item.addedByName;
        } else {
            title.textContent = 'Add Agenda Item';
        }

        modal.classList.remove('hidden');
    },

    // Handle agenda form submission
    async handleAgendaSubmit(e) {
        e.preventDefault();

        const itemData = {
            topic: document.getElementById('agenda-topic').value.trim(),
            description: document.getElementById('agenda-description').value.trim(),
            priority: document.getElementById('agenda-priority').value
        };

        const editId = document.getElementById('agenda-edit-id').value;

        try {
            if (editId) {
                await Agenda.update(editId, itemData);
                this.showToast('Item updated');
            } else {
                await Agenda.create(itemData);
                this.showToast('Item added to agenda');
            }

            document.getElementById('agenda-modal').classList.add('hidden');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Clear resolved agenda items
    async clearResolvedAgenda() {
        if (!confirm('Clear all resolved items?')) return;

        try {
            await Agenda.clearResolved();
            this.showToast('Resolved items cleared');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // Toast notifications
    showToast(message, duration = 3000) {
        // Remove existing toast
        document.querySelector('.toast')?.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), duration);
    },

    // Service Worker registration
    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                // Use relative path for GitHub Pages compatibility
                await navigator.serviceWorker.register('./sw.js');
                // Service Worker registered successfully
            } catch (error) {
                console.log('Service Worker registration failed:', error);
            }
        }

        // Setup PWA install prompt
        this.setupInstallPrompt();
    },

    // PWA Install Prompt
    deferredPrompt: null,

    setupInstallPrompt() {
        // Check if already installed as PWA
        if (window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true) {
            // App is running as PWA
            return;
        }

        // Check if user dismissed the prompt before
        const dismissed = localStorage.getItem('pwa-install-dismissed');
        if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) {
            // Don't show for 7 days after dismissal
            return;
        }

        // Detect platform
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isAndroid = /Android/.test(navigator.userAgent);
        const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge|Edg/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

        if (isIOS) {
            // iOS - show manual instructions (works for Safari and Chrome on iOS)
            setTimeout(() => this.showIOSInstallPrompt(), 3000);
        } else {
            // Android/Desktop - use beforeinstallprompt
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                this.deferredPrompt = e;
                setTimeout(() => this.showInstallBanner(), 2000);
            });
        }
    },

    showIOSInstallPrompt() {
        const isChrome = /CriOS/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS/.test(navigator.userAgent);

        let instructions = '';
        if (isChrome) {
            // Chrome on iOS
            instructions = `
                <p><strong>Install Household6:</strong></p>
                <ol>
                    <li>Tap the <strong>Share</strong> button (box with arrow)</li>
                    <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                    <li>Tap <strong>"Add"</strong> to install</li>
                </ol>
                <p class="install-note">Note: For the best experience on iOS, use Safari</p>
            `;
        } else {
            // Safari on iOS
            instructions = `
                <p><strong>Install Household6:</strong></p>
                <ol>
                    <li>Tap the <strong>Share</strong> button <span class="share-icon">⬆</span></li>
                    <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                    <li>Tap <strong>"Add"</strong> to install</li>
                </ol>
            `;
        }

        this.showInstallBannerWithContent(instructions, true);
    },

    showInstallBanner() {
        const content = `
            <p><strong>Install Household6</strong> for quick access and offline use!</p>
            <div class="install-banner-actions">
                <button id="install-btn" class="btn btn-primary btn-small">Install</button>
                <button id="install-dismiss" class="btn btn-secondary btn-small">Not Now</button>
            </div>
        `;
        this.showInstallBannerWithContent(content, false);
    },

    showInstallBannerWithContent(content, isIOS) {
        // Remove existing banner
        document.getElementById('install-banner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'install-banner';
        banner.className = 'install-banner';
        banner.innerHTML = `
            <button class="install-banner-close" id="install-close">&times;</button>
            ${content}
        `;
        document.body.appendChild(banner);

        // Event listeners
        document.getElementById('install-close').addEventListener('click', () => {
            this.dismissInstallBanner();
        });

        if (!isIOS) {
            document.getElementById('install-btn')?.addEventListener('click', () => {
                this.installPWA();
            });
            document.getElementById('install-dismiss')?.addEventListener('click', () => {
                this.dismissInstallBanner();
            });
        }

        // Auto-show with animation
        setTimeout(() => banner.classList.add('show'), 100);
    },

    dismissInstallBanner() {
        const banner = document.getElementById('install-banner');
        if (banner) {
            banner.classList.remove('show');
            setTimeout(() => banner.remove(), 300);
        }
        localStorage.setItem('pwa-install-dismissed', Date.now().toString());
    },

    async installPWA() {
        if (!this.deferredPrompt) return;

        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;

        // Install prompt completed
        this.deferredPrompt = null;
        this.dismissInstallBanner();

        if (outcome === 'accepted') {
            this.showToast('Installing Household6...');
        }
    },

    // ==================== RECIPES ====================

    renderRecipes(recipes) {
        const container = document.getElementById('recipes-list');
        if (!container) return;

        if (recipes.length === 0) {
            container.innerHTML = '<p class="empty-state">No recipes yet. Add your first recipe!</p>';
            return;
        }

        const grouped = Recipes.getGroupedByCategory();
        let html = '';

        for (const [category, categoryRecipes] of Object.entries(grouped)) {
            const color = MealCategories.getColor(category);
            html += `
                <div class="recipe-category-section">
                    <h4 class="category-header" style="border-left-color: ${esc(color)}">${esc(category)} (${categoryRecipes.length})</h4>
                    <div class="recipe-cards">
                        ${categoryRecipes.map(recipe => this.renderRecipeCard(recipe)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        // Add click handlers
        container.querySelectorAll('.recipe-card').forEach(card => {
            card.addEventListener('click', () => this.openRecipeView(card.dataset.recipeId));
        });
    },

    renderRecipeCard(recipe) {
        const formatted = Recipes.formatRecipe(recipe);
        return `
            <div class="recipe-card" data-recipe-id="${esc(recipe.id)}">
                <div class="recipe-card-header">
                    <span class="recipe-card-name">${esc(recipe.name)}</span>
                    ${recipe.favorite ? '<span class="favorite-badge">♥</span>' : ''}
                </div>
                <div class="recipe-card-meta">
                    ${esc(formatted.timeDisplay || `${formatted.ingredientCount} ingredients`)}
                </div>
            </div>
        `;
    },

    filterRecipes(query) {
        const container = document.getElementById('recipes-list');
        if (!query.trim()) {
            this.renderRecipes(Recipes.recipes);
            return;
        }

        const filtered = Recipes.search(query);
        if (filtered.length === 0) {
            container.innerHTML = '<p class="empty-state">No recipes match your search</p>';
            return;
        }

        container.innerHTML = `
            <div class="recipe-cards">
                ${filtered.map(recipe => this.renderRecipeCard(recipe)).join('')}
            </div>
        `;

        container.querySelectorAll('.recipe-card').forEach(card => {
            card.addEventListener('click', () => this.openRecipeView(card.dataset.recipeId));
        });
    },

    openRecipeModal(recipe = null) {
        const modal = document.getElementById('recipe-modal');
        const title = document.getElementById('recipe-modal-title');
        const form = document.getElementById('recipe-form');

        title.textContent = recipe ? 'Edit Recipe' : 'Add Recipe';
        form.reset();
        document.getElementById('ingredients-list').innerHTML = '';
        document.getElementById('recipe-edit-id').value = '';

        // Update category select
        this.updateCategorySelects();

        if (recipe) {
            document.getElementById('recipe-name').value = recipe.name;
            document.getElementById('recipe-category').value = recipe.category || 'Uncategorized';
            document.getElementById('recipe-servings').value = recipe.servings || 4;
            document.getElementById('recipe-prep-time').value = recipe.prepTime || '';
            document.getElementById('recipe-cook-time').value = recipe.cookTime || '';
            document.getElementById('recipe-instructions').value = recipe.instructions || '';
            document.getElementById('recipe-source').value = recipe.sourceUrl || '';
            document.getElementById('recipe-edit-id').value = recipe.id;

            // Add existing ingredients
            if (recipe.ingredients) {
                recipe.ingredients.forEach(ing => this.addIngredientToList(ing));
            }
        }

        modal.classList.remove('hidden');
    },

    updateCategorySelects() {
        const selects = [
            document.getElementById('recipe-category')
        ];

        selects.forEach(select => {
            if (!select) return;
            const currentValue = select.value;
            select.innerHTML = '<option value="Uncategorized">Select category...</option>';
            MealCategories.categories.forEach(cat => {
                const option = document.createElement('option');
                option.value = cat.name;
                option.textContent = cat.name;
                select.appendChild(option);
            });
            select.value = currentValue || 'Uncategorized';
        });
    },

    addIngredientToList(ingredient = null) {
        const input = document.getElementById('new-ingredient');
        const list = document.getElementById('ingredients-list');

        let ing;
        if (ingredient) {
            ing = ingredient;
        } else if (input.value.trim()) {
            ing = Recipes.parseIngredientString(input.value.trim());
            input.value = '';
        } else {
            return;
        }

        const displayText = ing.quantity
            ? `${ing.quantity}${ing.unit ? ' ' + ing.unit : ''} ${ing.name}`
            : ing.name;

        const item = document.createElement('div');
        item.className = 'ingredient-item';
        item.innerHTML = `
            <span class="ingredient-text">${esc(displayText)}</span>
            <button type="button" class="ingredient-remove" onclick="this.parentElement.remove()">&times;</button>
        `;
        item.dataset.ingredient = JSON.stringify(ing);

        list.appendChild(item);
        input.focus();
    },

    async handleRecipeSubmit(e) {
        e.preventDefault();

        const ingredientItems = document.querySelectorAll('#ingredients-list .ingredient-item');
        const ingredients = Array.from(ingredientItems).map(item =>
            JSON.parse(item.dataset.ingredient)
        );

        const recipeData = {
            name: document.getElementById('recipe-name').value,
            category: document.getElementById('recipe-category').value,
            servings: parseInt(document.getElementById('recipe-servings').value) || 4,
            prepTime: parseInt(document.getElementById('recipe-prep-time').value) || null,
            cookTime: parseInt(document.getElementById('recipe-cook-time').value) || null,
            ingredients,
            instructions: document.getElementById('recipe-instructions').value,
            sourceUrl: document.getElementById('recipe-source').value || null
        };

        const editId = document.getElementById('recipe-edit-id').value;

        try {
            if (editId) {
                await Recipes.update(editId, recipeData);
                this.showToast('Recipe updated');
            } else {
                await Recipes.create(recipeData);
                this.showToast('Recipe saved');
            }

            document.getElementById('recipe-modal').classList.add('hidden');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    openRecipeImportModal() {
        const modal = document.getElementById('recipe-import-modal');
        document.getElementById('recipe-paste-text').value = '';
        document.getElementById('recipe-import-loading').classList.add('hidden');
        document.getElementById('recipe-import-preview').classList.add('hidden');
        document.querySelector('.import-options').classList.remove('hidden');
        this.parsedRecipeData = null;
        modal.classList.remove('hidden');
    },

    async handleRecipeFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        document.querySelector('.import-options').classList.add('hidden');
        document.getElementById('recipe-import-loading').classList.remove('hidden');

        try {
            let parsed;
            if (file.type.startsWith('image/')) {
                parsed = await Recipes.parseFromImage(file);
            } else {
                const text = await this.extractTextFromFile(file);
                parsed = await Recipes.parseFromText(text);
            }

            this.parsedRecipeData = parsed;
            this.showParsedRecipePreview(parsed);
        } catch (error) {
            this.showToast('Error parsing recipe: ' + error.message);
            document.getElementById('recipe-import-loading').classList.add('hidden');
            document.querySelector('.import-options').classList.remove('hidden');
        }

        e.target.value = '';
    },

    async parseRecipeText() {
        const text = document.getElementById('recipe-paste-text').value.trim();
        if (!text) {
            this.showToast('Please paste recipe text first');
            return;
        }

        document.querySelector('.import-options').classList.add('hidden');
        document.getElementById('recipe-import-loading').classList.remove('hidden');

        try {
            const parsed = await Recipes.parseFromText(text);
            this.parsedRecipeData = parsed;
            this.showParsedRecipePreview(parsed);
        } catch (error) {
            this.showToast('Error parsing recipe: ' + error.message);
            document.getElementById('recipe-import-loading').classList.add('hidden');
            document.querySelector('.import-options').classList.remove('hidden');
        }
    },

    showParsedRecipePreview(recipe) {
        document.getElementById('recipe-import-loading').classList.add('hidden');
        document.getElementById('recipe-import-preview').classList.remove('hidden');

        const preview = document.getElementById('parsed-recipe-preview');
        preview.innerHTML = `
            <div class="parsed-recipe-name">${esc(recipe.name)}</div>
            <div class="parsed-recipe-meta">
                ${recipe.servings ? `${esc(recipe.servings)} servings` : ''}
                ${recipe.prepTime ? ` | Prep: ${esc(recipe.prepTime)} min` : ''}
                ${recipe.cookTime ? ` | Cook: ${esc(recipe.cookTime)} min` : ''}
            </div>
            <div class="parsed-ingredients">
                <strong>Ingredients (${recipe.ingredients.length}):</strong>
                <ul>
                    ${recipe.ingredients.slice(0, 8).map(ing =>
                        `<li>${esc(ing.quantity || '')} ${esc(ing.unit || '')} ${esc(ing.name)}</li>`
                    ).join('')}
                    ${recipe.ingredients.length > 8 ? `<li>...and ${recipe.ingredients.length - 8} more</li>` : ''}
                </ul>
            </div>
        `;
    },

    async confirmRecipeImport() {
        if (!this.parsedRecipeData) return;

        try {
            await Recipes.create(this.parsedRecipeData);
            this.showToast('Recipe imported!');
            document.getElementById('recipe-import-modal').classList.add('hidden');
            this.parsedRecipeData = null;
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    editImportedRecipe() {
        if (!this.parsedRecipeData) return;
        document.getElementById('recipe-import-modal').classList.add('hidden');
        this.openRecipeModal(this.parsedRecipeData);
        this.parsedRecipeData = null;
    },

    openRecipeView(recipeId) {
        const recipe = Recipes.recipes.find(r => r.id === recipeId);
        if (!recipe) return;

        this.currentRecipeId = recipeId;
        const modal = document.getElementById('recipe-view-modal');

        document.getElementById('recipe-view-name').textContent = recipe.name;
        document.getElementById('recipe-view-category').textContent = recipe.category || 'Uncategorized';
        document.getElementById('recipe-view-category').style.backgroundColor = MealCategories.getColor(recipe.category);

        const timeDisplay = [];
        if (recipe.prepTime) timeDisplay.push(`Prep: ${recipe.prepTime}min`);
        if (recipe.cookTime) timeDisplay.push(`Cook: ${recipe.cookTime}min`);
        document.getElementById('recipe-view-time').textContent = timeDisplay.join(' | ');

        document.getElementById('recipe-view-servings').textContent = `(${recipe.servings || 4} servings)`;

        // Ingredients
        const ingredientsList = document.getElementById('recipe-view-ingredients');
        ingredientsList.innerHTML = recipe.ingredients.map(ing => {
            const text = ing.quantity
                ? `${ing.quantity}${ing.unit ? ' ' + ing.unit : ''} ${ing.name}`
                : ing.name;
            return `<li>${esc(text)}</li>`;
        }).join('');

        // Instructions
        document.getElementById('recipe-view-instructions').innerHTML =
            recipe.instructions
                ? recipe.instructions.split('\n').map(p => `<p>${esc(p)}</p>`).join('')
                : '<p class="empty-state">No instructions</p>';

        // Update favorite button
        const favBtn = document.getElementById('recipe-favorite-btn');
        favBtn.classList.toggle('favorited', recipe.favorite);

        modal.classList.remove('hidden');
    },

    async toggleRecipeFavorite() {
        if (!this.currentRecipeId) return;
        try {
            await Recipes.toggleFavorite(this.currentRecipeId);
            const recipe = Recipes.recipes.find(r => r.id === this.currentRecipeId);
            document.getElementById('recipe-favorite-btn').classList.toggle('favorited', recipe?.favorite);
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    editCurrentRecipe() {
        const recipe = Recipes.recipes.find(r => r.id === this.currentRecipeId);
        if (!recipe) return;
        document.getElementById('recipe-view-modal').classList.add('hidden');
        this.openRecipeModal(recipe);
    },

    async deleteCurrentRecipe() {
        if (!this.currentRecipeId) return;
        if (!confirm('Delete this recipe?')) return;

        try {
            await Recipes.delete(this.currentRecipeId);
            document.getElementById('recipe-view-modal').classList.add('hidden');
            this.showToast('Recipe deleted');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    async addRecipeIngredientsToShopping() {
        const recipe = Recipes.recipes.find(r => r.id === this.currentRecipeId);
        if (!recipe) return;

        // Open ingredient check modal
        const ingredientsList = Inventory.checkRecipeIngredients(recipe.ingredients);
        this.showIngredientCheckModal(ingredientsList, recipe.name);
    },

    showIngredientCheckModal(ingredients, recipeName) {
        const modal = document.getElementById('ingredient-check-modal');
        const container = document.getElementById('ingredient-checklist');
        this.pendingIngredientCheck = ingredients;

        container.innerHTML = ingredients.map((ing, idx) => {
            const text = ing.quantity
                ? `${ing.quantity}${ing.unit ? ' ' + ing.unit : ''} ${ing.name}`
                : ing.name;
            return `
                <label class="ingredient-check-item ${ing.have ? 'has-item' : ''}">
                    <input type="checkbox" data-index="${idx}" ${ing.have ? 'checked' : ''}>
                    <span>${esc(text)}</span>
                    ${ing.have ? '<span class="have-badge">In stock</span>' : ''}
                </label>
            `;
        }).join('');

        this.updateIngredientCheckCounts();

        container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => this.updateIngredientCheckCounts());
        });

        modal.classList.remove('hidden');
    },

    updateIngredientCheckCounts() {
        const checkboxes = document.querySelectorAll('#ingredient-checklist input[type="checkbox"]');
        const haveCount = Array.from(checkboxes).filter(cb => cb.checked).length;
        const needCount = checkboxes.length - haveCount;
        document.getElementById('have-count').textContent = haveCount;
        document.getElementById('need-count').textContent = needCount;
    },

    async finishIngredientCheck() {
        const checkboxes = document.querySelectorAll('#ingredient-checklist input[type="checkbox"]');
        const missingItems = [];

        checkboxes.forEach((cb, idx) => {
            if (!cb.checked && this.pendingIngredientCheck[idx]) {
                missingItems.push(this.pendingIngredientCheck[idx]);
            }
        });

        if (missingItems.length === 0) {
            this.showToast('You have all ingredients!');
        } else {
            for (const item of missingItems) {
                await Shopping.add({
                    name: item.name,
                    quantity: item.quantity,
                    unit: item.unit,
                    category: item.category || Inventory.guessCategory(item.name)
                });
            }
            this.showToast(`Added ${missingItems.length} items to shopping list`);
        }

        document.getElementById('ingredient-check-modal').classList.add('hidden');
        document.getElementById('recipe-view-modal').classList.add('hidden');
    },

    // ==================== INVENTORY ====================

    renderInventory(items) {
        const container = document.getElementById('inventory-list');
        const expiringSection = document.getElementById('expiring-section');
        const expiringContainer = document.getElementById('expiring-items');
        if (!container) return;

        // Filter by current location
        const locationItems = items.filter(i => i.location === this.currentInventoryLocation);

        // Get expiring items (within 7 days) for current location
        const expiringSoon = Inventory.getExpiringSoon(7).filter(i => i.location === this.currentInventoryLocation);

        // Show expiring section if there are items
        if (expiringSoon.length > 0) {
            expiringSection.classList.remove('hidden');
            expiringContainer.innerHTML = expiringSoon.map(item => this.renderInventoryItem(item, true)).join('');
            expiringContainer.querySelectorAll('.inventory-item').forEach(el => {
                el.addEventListener('click', () => this.openInventoryModal(Inventory.items.find(i => i.id === el.dataset.itemId)));
            });
        } else {
            expiringSection.classList.add('hidden');
        }

        // Render all items for this location
        if (locationItems.length === 0) {
            container.innerHTML = `<p class="empty-state">No items in ${esc(this.currentInventoryLocation.toLowerCase())}</p>`;
            return;
        }

        container.innerHTML = locationItems.map(item => this.renderInventoryItem(item)).join('');

        container.querySelectorAll('.inventory-item').forEach(el => {
            el.addEventListener('click', () => this.openInventoryModal(Inventory.items.find(i => i.id === el.dataset.itemId)));
        });
    },

    renderInventoryItem(item, showExpiry = false) {
        const expiryInfo = Inventory.formatExpiry(item);
        const days = Inventory.getDaysUntilExpiry(item);
        const expiryClass = days !== null && days <= 3 ? 'expiry-urgent' : (days !== null && days <= 7 ? 'expiry-soon' : '');

        return `
            <div class="inventory-item ${expiryClass}" data-item-id="${esc(item.id)}">
                <div class="inventory-item-info">
                    <span class="inventory-item-name">${esc(Inventory.formatItem(item))}</span>
                    ${expiryInfo && showExpiry ? `<span class="inventory-item-expiry">${esc(expiryInfo)}</span>` : ''}
                </div>
                <button class="inventory-use-btn" onclick="event.stopPropagation(); App.useInventoryItem('${esc(item.id)}')">Use</button>
            </div>
        `;
    },

    switchInventoryLocation(location) {
        this.currentInventoryLocation = location;
        document.querySelectorAll('.location-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.location === location);
        });
        this.renderInventory(Inventory.items);
    },

    openInventoryModal(item = null) {
        const modal = document.getElementById('inventory-modal');
        const title = document.getElementById('inventory-modal-title');
        const form = document.getElementById('inventory-form');

        title.textContent = item ? 'Edit Item' : 'Add to Inventory';
        form.reset();
        document.getElementById('inventory-edit-id').value = '';
        document.getElementById('inventory-location').value = this.currentInventoryLocation;

        if (item) {
            document.getElementById('inventory-name').value = item.name;
            document.getElementById('inventory-quantity').value = item.quantity || 1;
            document.getElementById('inventory-unit').value = item.unit || '';
            document.getElementById('inventory-location').value = item.location || 'Refrigerator';
            document.getElementById('inventory-expiration').value = item.expirationDate || '';
            document.getElementById('inventory-notes').value = item.notes || '';
            document.getElementById('inventory-edit-id').value = item.id;
        }

        modal.classList.remove('hidden');
    },

    async handleInventorySubmit(e) {
        e.preventDefault();

        const itemData = {
            name: document.getElementById('inventory-name').value,
            quantity: parseFloat(document.getElementById('inventory-quantity').value) || 1,
            unit: document.getElementById('inventory-unit').value || null,
            location: document.getElementById('inventory-location').value,
            expirationDate: document.getElementById('inventory-expiration').value || null,
            notes: document.getElementById('inventory-notes').value || null
        };

        const editId = document.getElementById('inventory-edit-id').value;

        try {
            if (editId) {
                await Inventory.update(editId, itemData);
                this.showToast('Item updated');
            } else {
                await Inventory.add(itemData);
                this.showToast('Item added to inventory');
            }

            document.getElementById('inventory-modal').classList.add('hidden');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    async useInventoryItem(itemId) {
        try {
            const result = await Inventory.useItem(itemId, 1);
            if (result === null) {
                this.showToast('Item removed from inventory');
            } else {
                this.showToast(`Updated: ${result.quantity} remaining`);
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    // ==================== MEAL PLANNER ====================

    renderMealPlanner(plans) {
        const container = document.getElementById('meal-plan-view');
        const weekRange = document.getElementById('week-range');
        const groceryPreview = document.getElementById('grocery-preview');
        if (!container) return;

        // Update week range display
        const weekDates = MealPlanner.getWeekDates(this.currentWeekStart);
        const startDate = new Date(this.currentWeekStart);
        const endDate = new Date(this.currentWeekStart);
        endDate.setDate(endDate.getDate() + 6);

        const formatOpts = { month: 'short', day: 'numeric' };
        weekRange.textContent = `${startDate.toLocaleDateString('en-US', formatOpts)} - ${endDate.toLocaleDateString('en-US', formatOpts)}`;

        // Find plan for current week
        const plan = MealPlanner.getPlanForWeek(this.currentWeekStart);

        if (!plan) {
            container.innerHTML = '<p class="empty-state">No meals planned. Tap "Plan Week" to get started!</p>';
            groceryPreview.classList.add('hidden');
            return;
        }

        // Render week view
        const planDisplay = MealPlanner.formatPlanForDisplay(plan.id);
        container.innerHTML = planDisplay.map(day => {
            const dayClass = day.isToday ? 'meal-day today' : 'meal-day';
            return `
                <div class="${dayClass}" data-date="${esc(day.date)}">
                    <div class="meal-day-header">
                        <span class="meal-day-name">${esc(day.dayName)}</span>
                        <span class="meal-day-num">${esc(day.dayNum)}</span>
                    </div>
                    <div class="meal-day-content" onclick="App.changeMeal('${esc(plan.id)}', '${esc(day.date)}')">
                        ${day.recipe
                            ? `<span class="meal-recipe-name">${esc(day.recipe.name)}</span>`
                            : '<span class="meal-empty">+ Add meal</span>'
                        }
                    </div>
                </div>
            `;
        }).join('');

        // Show grocery preview
        this.updateGroceryPreview(plan.id);
    },

    updateGroceryPreview(planId) {
        const groceryPreview = document.getElementById('grocery-preview');
        const groceryList = document.getElementById('grocery-preview-list');

        const items = MealPlanner.generateGroceryList(planId);
        const needToBuy = items.filter(i => i.needToBuy);

        if (needToBuy.length === 0) {
            groceryPreview.classList.add('hidden');
            return;
        }

        groceryPreview.classList.remove('hidden');
        groceryList.innerHTML = needToBuy.slice(0, 10).map(item => `
            <div class="grocery-preview-item">
                <span>${esc(item.name)}</span>
                <span class="grocery-preview-qty">${esc(item.quantity || '')} ${esc(item.unit || '')}</span>
            </div>
        `).join('') + (needToBuy.length > 10 ? `<div class="grocery-preview-more">+${needToBuy.length - 10} more items</div>` : '');
    },

    navigateWeek(delta) {
        const newStart = new Date(this.currentWeekStart);
        newStart.setDate(newStart.getDate() + (delta * 7));
        this.currentWeekStart = newStart;
        this.renderMealPlanner(MealPlanner.plans);
    },

    async changeMeal(planId, dateStr) {
        // Open recipe select modal
        this.pendingMealChange = { planId, dateStr };
        const modal = document.getElementById('recipe-select-modal');
        const list = document.getElementById('recipe-select-list');

        list.innerHTML = Recipes.recipes.map(recipe => `
            <div class="recipe-select-item" data-recipe-id="${esc(recipe.id)}">
                <span class="recipe-select-name">${esc(recipe.name)}</span>
                <span class="recipe-select-category">${esc(recipe.category)}</span>
            </div>
        `).join('') + `
            <div class="recipe-select-item recipe-select-none" data-recipe-id="">
                <span class="recipe-select-name">No meal</span>
            </div>
        `;

        list.querySelectorAll('.recipe-select-item').forEach(item => {
            item.addEventListener('click', () => this.selectMealRecipe(item.dataset.recipeId));
        });

        modal.classList.remove('hidden');
    },

    async selectMealRecipe(recipeId) {
        if (!this.pendingMealChange) return;

        const { planId, dateStr } = this.pendingMealChange;

        try {
            if (recipeId) {
                await MealPlanner.setMeal(planId, dateStr, recipeId);
            } else {
                await MealPlanner.removeMeal(planId, dateStr);
            }
            document.getElementById('recipe-select-modal').classList.add('hidden');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }

        this.pendingMealChange = null;
    },

    async addPlanToShopping() {
        const plan = MealPlanner.getPlanForWeek(this.currentWeekStart);
        if (!plan) return;

        const items = MealPlanner.generateGroceryList(plan.id);
        const count = await MealPlanner.addToShoppingList(items, true);
        this.showToast(`Added ${count} items to shopping list`);
    },

    // ==================== PLANNER WIZARD ====================

    openPlannerWizard() {
        const modal = document.getElementById('planner-wizard-modal');
        this.wizardStep = 1;
        this.wizardData = {
            daysNeeded: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
            useUpItems: [],
            categoryRequirements: {},
            mustInclude: [],
            suggestions: []
        };

        // Reset wizard UI
        this.showWizardStep(1);

        // Populate step 2 with expiring items
        this.populateUseUpItems();

        // Populate step 3 with categories
        this.populateCategoryRequirements();

        // Populate step 4 with recipes
        this.populateMustIncludeRecipes();

        modal.classList.remove('hidden');
    },

    showWizardStep(step) {
        document.querySelectorAll('.wizard-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === `wizard-step-${step}`);
            panel.classList.toggle('hidden', panel.id !== `wizard-step-${step}`);
        });

        document.querySelectorAll('.wizard-step').forEach(dot => {
            const dotStep = parseInt(dot.dataset.step);
            dot.classList.toggle('active', dotStep <= step);
            dot.classList.toggle('completed', dotStep < step);
        });
    },

    wizardNext() {
        // Collect data from current step
        if (this.wizardStep === 1) {
            const checkboxes = document.querySelectorAll('.day-checkbox input:checked');
            this.wizardData.daysNeeded = Array.from(checkboxes).map(cb => cb.value);
        } else if (this.wizardStep === 2) {
            const checkboxes = document.querySelectorAll('#use-up-items input:checked');
            this.wizardData.useUpItems = Array.from(checkboxes).map(cb => cb.value);
        } else if (this.wizardStep === 3) {
            const inputs = document.querySelectorAll('.category-requirement-input');
            this.wizardData.categoryRequirements = {};
            inputs.forEach(input => {
                const val = parseInt(input.value) || 0;
                if (val > 0) {
                    this.wizardData.categoryRequirements[input.dataset.category] = val;
                }
            });
        } else if (this.wizardStep === 4) {
            // Generate suggestions
            this.generateMealSuggestions();
        }

        if (this.wizardStep < 5) {
            this.wizardStep++;
            this.showWizardStep(this.wizardStep);
        }
    },

    wizardBack() {
        if (this.wizardStep > 1) {
            this.wizardStep--;
            this.showWizardStep(this.wizardStep);
        }
    },

    populateUseUpItems() {
        const container = document.getElementById('use-up-items');
        const expiring = Inventory.getExpiringSoon(14);

        if (expiring.length === 0) {
            container.innerHTML = '<p class="empty-state">No items expiring soon</p>';
            return;
        }

        container.innerHTML = expiring.map(item => {
            const expiryText = Inventory.formatExpiry(item);
            return `
                <label class="checklist-item">
                    <input type="checkbox" value="${esc(item.id)}">
                    <span>${esc(item.name)}</span>
                    <span class="expiry-hint">${esc(expiryText)}</span>
                </label>
            `;
        }).join('');
    },

    populateCategoryRequirements() {
        const container = document.getElementById('category-requirements');

        container.innerHTML = MealCategories.categories.map(cat => `
            <div class="category-requirement-row">
                <span class="category-name" style="border-left-color: ${esc(cat.color)}">${esc(cat.name)}</span>
                <input type="number" class="category-requirement-input" data-category="${esc(cat.name)}" value="0" min="0" max="7">
            </div>
        `).join('');
    },

    populateMustIncludeRecipes(filter = '') {
        const container = document.getElementById('must-include-list');

        let recipes = Recipes.recipes;
        if (filter) {
            recipes = Recipes.search(filter);
        }

        container.innerHTML = recipes.slice(0, 20).map(recipe => `
            <div class="recipe-select-item" data-recipe-id="${esc(recipe.id)}" onclick="App.toggleMustInclude('${esc(recipe.id)}')">
                <span class="recipe-select-name">${esc(recipe.name)}</span>
                <span class="recipe-select-category">${esc(recipe.category)}</span>
                ${this.wizardData.mustInclude.includes(recipe.id) ? '<span class="selected-check">✓</span>' : ''}
            </div>
        `).join('');

        this.updateMustIncludeSelection();
    },

    filterMustIncludeRecipes(query) {
        this.populateMustIncludeRecipes(query);
    },

    toggleMustInclude(recipeId) {
        const idx = this.wizardData.mustInclude.indexOf(recipeId);
        if (idx === -1) {
            this.wizardData.mustInclude.push(recipeId);
        } else {
            this.wizardData.mustInclude.splice(idx, 1);
        }
        this.populateMustIncludeRecipes(document.getElementById('must-include-search')?.value || '');
        this.updateMustIncludeSelection();
    },

    updateMustIncludeSelection() {
        const container = document.getElementById('must-include-selected-list');
        const section = document.getElementById('selected-must-include');

        if (this.wizardData.mustInclude.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        container.innerHTML = this.wizardData.mustInclude.map(id => {
            const recipe = Recipes.recipes.find(r => r.id === id);
            return recipe ? `<span class="selected-recipe-chip">${esc(recipe.name)} <button onclick="App.toggleMustInclude('${esc(id)}')">&times;</button></span>` : '';
        }).join('');
    },

    generateMealSuggestions() {
        const result = MealPlanner.generateWeekSuggestions({
            daysNeeded: this.wizardData.daysNeeded,
            mustInclude: this.wizardData.mustInclude,
            categoryRequirements: this.wizardData.categoryRequirements,
            useUpItems: this.wizardData.useUpItems
        });

        this.wizardData.suggestions = result.suggestions;
        this.renderMealSuggestions(result);
    },

    regenerateSuggestions() {
        this.generateMealSuggestions();
    },

    renderMealSuggestions(result) {
        const container = document.getElementById('meal-suggestions');
        const statsContainer = document.getElementById('suggestion-stats');

        container.innerHTML = result.suggestions.map((suggestion, idx) => `
            <div class="meal-suggestion ${suggestion.locked ? 'locked' : ''}" data-index="${idx}">
                <div class="suggestion-day">${esc(suggestion.day)}</div>
                <div class="suggestion-content">
                    ${suggestion.recipe
                        ? `<span class="suggestion-recipe">${esc(suggestion.recipe.name)}</span>
                           <span class="suggestion-reason">${esc(suggestion.reason)}</span>
                           ${suggestion.recipe.inventoryMatch
                               ? `<span class="match-badge">${esc(suggestion.recipe.inventoryMatch.percentage)}% match</span>`
                               : ''
                           }`
                        : '<span class="suggestion-empty">No suggestion</span>'
                    }
                </div>
                <div class="suggestion-actions">
                    <button class="icon-btn swap-btn" onclick="App.swapSuggestion(${idx})" title="Swap">↻</button>
                    <button class="icon-btn lock-btn ${suggestion.locked ? 'active' : ''}" onclick="App.toggleSuggestionLock(${idx})" title="Lock">🔒</button>
                </div>
            </div>
        `).join('');

        // Stats
        const totalMeals = result.suggestions.filter(s => s.recipe).length;
        const catMet = result.fulfilled ? 'met' : 'not met';
        statsContainer.innerHTML = `
            <span>${totalMeals} meals planned</span>
            <span>Category requirements: ${catMet}</span>
        `;
    },

    async swapSuggestion(index) {
        // Get alternatives or open recipe selector
        const modal = document.getElementById('recipe-select-modal');
        const list = document.getElementById('recipe-select-list');
        this.pendingSuggestionSwap = index;

        // Get suggestions excluding already planned recipes
        const usedIds = this.wizardData.suggestions.map(s => s.recipe?.id).filter(Boolean);
        const suggestions = MealPlanner.getSuggestions({
            useUpItems: this.wizardData.useUpItems,
            categoryRequirements: this.wizardData.categoryRequirements,
            exclude: usedIds,
            maxResults: 15
        });

        list.innerHTML = suggestions.map(recipe => `
            <div class="recipe-select-item" data-recipe-id="${esc(recipe.id)}">
                <span class="recipe-select-name">${esc(recipe.name)}</span>
                <span class="recipe-select-meta">${esc(recipe.inventoryMatch.percentage)}% ingredients | ${esc(recipe.category)}</span>
            </div>
        `).join('');

        list.querySelectorAll('.recipe-select-item').forEach(item => {
            item.addEventListener('click', () => this.confirmSwapSuggestion(item.dataset.recipeId));
        });

        modal.classList.remove('hidden');
    },

    confirmSwapSuggestion(recipeId) {
        const recipe = Recipes.recipes.find(r => r.id === recipeId);
        if (recipe && this.pendingSuggestionSwap !== null) {
            this.wizardData.suggestions = MealPlanner.swapSuggestion(
                this.wizardData.suggestions,
                this.pendingSuggestionSwap,
                recipe
            );
            this.renderMealSuggestions({ suggestions: this.wizardData.suggestions, fulfilled: true });
        }
        document.getElementById('recipe-select-modal').classList.add('hidden');
        this.pendingSuggestionSwap = null;
    },

    toggleSuggestionLock(index) {
        this.wizardData.suggestions = MealPlanner.toggleLock(this.wizardData.suggestions, index);
        this.renderMealSuggestions({ suggestions: this.wizardData.suggestions, fulfilled: true });
    },

    async acceptMealPlan() {
        try {
            // Create the meal plan
            const meals = {};
            const weekDates = MealPlanner.getWeekDates(this.currentWeekStart);

            this.wizardData.suggestions.forEach((suggestion, idx) => {
                if (suggestion.recipe) {
                    const dateStr = weekDates[idx]?.date;
                    if (dateStr) {
                        meals[dateStr] = {
                            recipeId: suggestion.recipe.id,
                            mealType: 'dinner'
                        };
                    }
                }
            });

            await MealPlanner.createPlan({
                weekStart: this.currentWeekStart,
                meals,
                mealsNeeded: this.wizardData.daysNeeded.length,
                daysNeeded: this.wizardData.daysNeeded,
                mustIncludeRecipes: this.wizardData.mustInclude,
                categoryRequirements: this.wizardData.categoryRequirements,
                useUpItems: this.wizardData.useUpItems
            });

            document.getElementById('planner-wizard-modal').classList.add('hidden');
            this.showToast('Meal plan created!');

            // Show ingredient check
            const groceryList = MealPlanner.generateGroceryListFromSuggestions(this.wizardData.suggestions);
            if (groceryList.length > 0) {
                this.showIngredientCheckModal(groceryList, 'Week\'s meals');
            }

        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    },

    addRecipeToCurrentPlan() {
        if (!this.currentRecipeId) return;

        const plan = MealPlanner.getPlanForWeek(this.currentWeekStart);
        if (!plan) {
            this.showToast('Create a meal plan first');
            return;
        }

        // Find first empty day
        const weekDates = MealPlanner.getWeekDates(this.currentWeekStart);
        const emptyDay = weekDates.find(d => !plan.meals[d.date]);

        if (emptyDay) {
            MealPlanner.setMeal(plan.id, emptyDay.date, this.currentRecipeId);
            document.getElementById('recipe-view-modal').classList.add('hidden');
            this.showToast('Added to meal plan');
        } else {
            this.showToast('No empty days in current plan');
        }
    },

    // Category management
    async addNewCategory() {
        const input = document.getElementById('new-category-name');
        const name = input.value.trim();

        if (!name) return;

        try {
            await MealCategories.create(name);
            input.value = '';
            this.showToast('Category added');
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Make App globally available
window.App = App;
