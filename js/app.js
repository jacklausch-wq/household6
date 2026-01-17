// Main Application Module
const App = {
    currentTab: 'today',
    currentMonth: new Date(),
    selectedDate: new Date(),

    // Initialize the application
    async init() {
        console.log('Initializing Household6...');

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

        // Load calendar
        Calendar.loadSelectedCalendar();
        if (Calendar.selectedCalendarId) {
            await this.loadTodayData();
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
        const events = await Calendar.getTodayEvents();
        this.renderTodayEvents(events);
        this.renderTodayTasks();
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
            <div class="task-item ${statusClass}" data-task-id="${task.id}">
                <span class="task-checkbox">${task.completed ? '☑' : '☐'}</span>
                <span class="task-title">${task.title}</span>
                ${dueText ? `<span class="task-due">${dueText}</span>` : ''}
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
        // Auth
        document.getElementById('google-signin-btn')?.addEventListener('click', () => this.handleSignIn());
        document.getElementById('sign-out-btn')?.addEventListener('click', () => this.handleSignOut());

        // Household
        document.getElementById('create-household-btn')?.addEventListener('click', () => this.handleCreateHousehold());
        document.getElementById('join-household-btn')?.addEventListener('click', () => this.handleJoinHousehold());

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
    async handleSignIn() {
        try {
            await Auth.signIn();
            await this.handleSignedIn();
        } catch (error) {
            this.showToast('Sign in failed: ' + error.message);
        }
    },

    async handleSignOut() {
        // Close the settings modal
        document.getElementById('settings-modal')?.classList.add('hidden');

        await Auth.signOut();
        Tasks.unsubscribeFromUpdates();
        Locations.unsubscribeFromUpdates();
        this.showScreen('auth');
    },

    // Household handlers
    async handleCreateHousehold() {
        try {
            await Household.create();
            await this.loadHousehold();
            this.showScreen('main');
            this.showToast('Household created!');
        } catch (error) {
            this.showToast('Failed to create household: ' + error.message);
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
                <div class="value">${parsed.title || 'Untitled'}</div>
                <div class="label">When</div>
                <div class="value">${parsed.date ? parsed.date.toLocaleString() : 'Not specified'}</div>
                ${parsed.location ? `<div class="label">Location</div><div class="value">${parsed.location}</div>` : ''}
            `;
        } else {
            html = `
                <div class="label">Type</div>
                <div class="value">Task</div>
                <div class="label">Title</div>
                <div class="value">${parsed.title || 'Untitled'}</div>
                ${parsed.recurring ? `<div class="label">Repeats</div><div class="value">${parsed.frequency}</div>` : ''}
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
            <span class="member-chip">${member.displayName}</span>
        `).join('');

        // Check if calendar is connected (we have an access token)
        const hasCalendarAccess = !!Auth.accessToken;
        document.getElementById('calendar-not-connected')?.classList.toggle('hidden', hasCalendarAccess);
        document.getElementById('calendar-connected')?.classList.toggle('hidden', !hasCalendarAccess);

        // Load calendars if connected
        if (hasCalendarAccess) {
            const calendarSelect = document.getElementById('calendar-select');
            const calendars = await Calendar.getCalendarList();
            calendarSelect.innerHTML = '<option value="">Select a calendar...</option>';
            calendars.forEach(cal => {
                const option = document.createElement('option');
                option.value = cal.id;
                option.textContent = cal.summary;
                option.selected = cal.id === Calendar.selectedCalendarId;
                calendarSelect.appendChild(option);
            });
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
        console.log('Connect Calendar button clicked');
        try {
            this.showToast('Opening Google sign-in...');

            // Re-authenticate to get calendar permissions
            console.log('Calling Auth.refreshAccessToken...');
            const accessToken = await Auth.refreshAccessToken();
            console.log('Access token result:', accessToken ? 'received' : 'null');

            if (accessToken) {
                this.showToast('Calendar connected!');
                // Update UI to show connected state
                document.getElementById('calendar-not-connected')?.classList.add('hidden');
                document.getElementById('calendar-connected')?.classList.remove('hidden');

                // Load calendars
                console.log('Loading calendar list...');
                const calendars = await Calendar.getCalendarList();
                console.log('Calendars found:', calendars.length);
                const calendarSelect = document.getElementById('calendar-select');
                calendarSelect.innerHTML = '<option value="">Select a calendar...</option>';
                calendars.forEach(cal => {
                    const option = document.createElement('option');
                    option.value = cal.id;
                    option.textContent = cal.summary;
                    calendarSelect.appendChild(option);
                });
            } else {
                this.showToast('Could not get calendar access.');
            }
        } catch (error) {
            console.error('Calendar connect error:', error);
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
        console.log('handleTextInput called with:', text);
        try {
            // Show loading indicator
            this.showToast('Processing...');

            console.log('Calling AI.parseInput...');
            const parsed = await AI.parseInput(text);
            console.log('AI response:', parsed);

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
                        <div class="preview-item-title">${item.title}</div>
                        <div class="preview-item-meta">${meta}</div>
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
                console.error('Error creating item:', error);
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
                        <h4 class="category-label">${category}</h4>
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
            <div class="shopping-item ${isChecked ? 'checked' : ''}" data-item-id="${item.id}">
                <span class="shopping-checkbox">${isChecked ? '☑' : '☐'}</span>
                <span class="shopping-name">${displayText}</span>
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
            <div class="task-item ${statusClass}" data-task-id="${task.id}" onclick="App.toggleTask('${task.id}')">
                <span class="task-checkbox">${task.completed ? '☑' : '☐'}</span>
                <div class="task-details">
                    <div class="task-title">
                        ${task.title}
                        ${task.recurring ? '<span class="task-recurring-badge">Recurring</span>' : ''}
                    </div>
                    ${task.assignee ? `<div class="task-assignee">Assigned to ${Household.getMemberName(task.assignee)}</div>` : ''}
                </div>
                ${dueText ? `<span class="task-due">${dueText}</span>` : ''}
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
                <div class="event-time">${Calendar.formatTime(event.startDate)}</div>
                <div class="event-details">
                    <div class="event-title">${event.title}</div>
                    ${event.location ? `<div class="event-location">📍 ${event.location}</div>` : ''}
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
                    <div class="location-name">${loc.name}</div>
                    <div class="location-address">${loc.address}</div>
                </div>
                <button class="delete-btn" onclick="App.deleteLocation('${loc.id}')">&times;</button>
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
                    <div class="event-time">${event.allDay ? 'All day' : Calendar.formatTime(event.startDate)}</div>
                    <div class="event-details">
                        <div class="event-title">${event.title}</div>
                        ${event.location ? `<div class="event-location">📍 ${event.location}</div>` : ''}
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
                        <div class="day-name">${dayName}</div>
                    </div>
                    <div class="upcoming-event-details">
                        <div class="upcoming-event-title">${event.title}</div>
                        <div class="upcoming-event-time">${timeStr}</div>
                        ${event.location ? `<div class="upcoming-event-location">📍 ${event.location}</div>` : ''}
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
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', registration);
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());

// Make App globally available
window.App = App;
