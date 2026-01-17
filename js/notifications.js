// Notifications Module
const Notifications = {
    permission: 'default',
    morningReportTime: '07:00',
    morningReportTimeout: null,

    // Initialize notifications
    async init() {
        // Check current permission
        if ('Notification' in window) {
            this.permission = Notification.permission;
        }

        // Load user settings
        await this.loadSettings();

        // Schedule morning report
        this.scheduleMorningReport();
    },

    // Request notification permission
    async requestPermission() {
        if (!('Notification' in window)) {
            console.warn('Notifications not supported');
            return false;
        }

        try {
            const permission = await Notification.requestPermission();
            this.permission = permission;
            return permission === 'granted';
        } catch (error) {
            console.error('Notification permission error:', error);
            return false;
        }
    },

    // Load settings from Firestore
    async loadSettings() {
        if (!Auth.currentUser) return;

        const doc = await db.collection('users').doc(Auth.currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            this.morningReportTime = data.morningReportTime || '07:00';
        }
    },

    // Save settings
    async saveSettings(settings) {
        if (!Auth.currentUser) return;

        await db.collection('users').doc(Auth.currentUser.uid).update(settings);

        if (settings.morningReportTime !== undefined) {
            this.morningReportTime = settings.morningReportTime;
            this.scheduleMorningReport();
        }
    },

    // Send a notification
    async send(title, body, options = {}) {
        if (this.permission !== 'granted') {
            const granted = await this.requestPermission();
            if (!granted) return null;
        }

        try {
            const notification = new Notification(title, {
                body,
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-72.png',
                vibrate: [200, 100, 200],
                ...options
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            return notification;
        } catch (error) {
            console.error('Notification error:', error);
            return null;
        }
    },

    // Schedule the morning report
    scheduleMorningReport() {
        // Clear existing timeout
        if (this.morningReportTimeout) {
            clearTimeout(this.morningReportTimeout);
        }

        const now = new Date();
        const [hours, minutes] = this.morningReportTime.split(':').map(Number);

        // Calculate next occurrence
        const nextReport = new Date(now);
        nextReport.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for tomorrow
        if (nextReport <= now) {
            nextReport.setDate(nextReport.getDate() + 1);
        }

        const msUntilReport = nextReport.getTime() - now.getTime();

        // Schedule the report
        this.morningReportTimeout = setTimeout(() => {
            this.sendMorningReport();
            // Reschedule for next day
            this.scheduleMorningReport();
        }, msUntilReport);

        console.log(`Morning report scheduled for ${nextReport.toLocaleString()}`);
    },

    // Generate and send the morning report
    async sendMorningReport() {
        try {
            // Get today's events
            const events = await Calendar.getTodayEvents();

            // Get pending tasks
            const tasks = Tasks.getPending();

            // Build report
            let body = '';

            if (events.length > 0) {
                body += `📅 ${events.length} event${events.length > 1 ? 's' : ''}: `;
                body += events.slice(0, 3).map(e =>
                    `${Calendar.formatTime(e.startDate)} ${e.title}`
                ).join(', ');
                if (events.length > 3) body += ` +${events.length - 3} more`;
            } else {
                body += '📅 No events today';
            }

            body += '\n';

            if (tasks.length > 0) {
                body += `✓ ${tasks.length} pending task${tasks.length > 1 ? 's' : ''}`;
                const myTasks = tasks.filter(t => t.assignee === Auth.currentUser?.uid);
                if (myTasks.length > 0) {
                    body += ` (${myTasks.length} assigned to you)`;
                }
            } else {
                body += '✓ All tasks complete!';
            }

            await this.send('Good morning! Here\'s your day', body, {
                tag: 'morning-report',
                requireInteraction: true,
                data: { type: 'morning-report' }
            });

        } catch (error) {
            console.error('Morning report error:', error);
        }
    },

    // Send a task reminder
    async sendTaskReminder(task) {
        const assignee = task.assignee ? Household.getMemberName(task.assignee) : 'Someone';
        await this.send(
            'Task Reminder',
            `${task.title}${task.assignee ? ` (assigned to ${assignee})` : ''}`,
            {
                tag: `task-${task.id}`,
                data: { taskId: task.id, type: 'task-reminder' }
            }
        );
    },

    // Send task completion notification
    async sendTaskCompleted(task, completedBy) {
        const completedByName = Household.getMemberName(completedBy);
        await this.send(
            'Task Completed ✓',
            `${completedByName} completed: ${task.title}`,
            {
                tag: `task-complete-${task.id}`,
                data: { taskId: task.id, type: 'task-completed' }
            }
        );
    },

    // Test notification
    async test() {
        await this.send('Test Notification', 'Notifications are working!');
    }
};

window.Notifications = Notifications;
