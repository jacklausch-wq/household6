// Tasks Management Module
const Tasks = {
    tasks: [],
    unsubscribe: null,

    // Subscribe to real-time task updates
    subscribe(callback) {
        if (!Household.currentHousehold) return;

        this.unsubscribe = db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                this.tasks = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                if (callback) callback(this.tasks);
            });
    },

    // Unsubscribe from updates
    unsubscribeFromUpdates() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    },

    // Create a new task
    async create(taskData) {
        if (!Household.currentHousehold) throw new Error('No household');

        const task = {
            title: taskData.title,
            assignee: taskData.assignee || null,
            recurring: taskData.recurring || false,
            frequency: taskData.frequency || null,
            completed: false,
            completedAt: null,
            completedBy: null,
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            // New fields for due dates
            dueDate: taskData.dueDate || null, // ISO string "YYYY-MM-DD"
            dueTime: taskData.dueTime || null, // "HH:mm" format
            needsNotification: taskData.needsNotification || false
        };

        const docRef = await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .add(task);

        return { id: docRef.id, ...task };
    },

    // Toggle task completion
    async toggleComplete(taskId) {
        if (!Household.currentHousehold) throw new Error('No household');

        const task = this.tasks.find(t => t.id === taskId);
        if (!task) throw new Error('Task not found');

        const updates = {
            completed: !task.completed,
            completedAt: task.completed ? null : firebase.firestore.FieldValue.serverTimestamp(),
            completedBy: task.completed ? null : Auth.currentUser.uid
        };

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .doc(taskId)
            .update(updates);

        // If it's a recurring task that was completed, create the next occurrence
        if (!task.completed && task.recurring) {
            await this.createNextRecurrence(task);
        }

        return { ...task, ...updates };
    },

    // Create next recurrence of a recurring task
    async createNextRecurrence(task) {
        const nextTask = {
            title: task.title,
            assignee: task.assignee,
            recurring: true,
            frequency: task.frequency,
            completed: false,
            completedAt: null,
            completedBy: null,
            createdBy: Auth.currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            previousTaskId: task.id
        };

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .add(nextTask);
    },

    // Update a task
    async update(taskId, updates) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .doc(taskId)
            .update({
                ...updates,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
    },

    // Delete a task
    async delete(taskId) {
        if (!Household.currentHousehold) throw new Error('No household');

        await db.collection('households')
            .doc(Household.currentHousehold.id)
            .collection('tasks')
            .doc(taskId)
            .delete();
    },

    // Get pending (incomplete) tasks
    getPending() {
        return this.tasks.filter(t => !t.completed);
    },

    // Get completed tasks
    getCompleted() {
        return this.tasks.filter(t => t.completed);
    },

    // Get tasks assigned to a specific user
    getAssignedTo(uid) {
        return this.tasks.filter(t => t.assignee === uid && !t.completed);
    },

    // Get my tasks
    getMyTasks() {
        return this.getAssignedTo(Auth.currentUser?.uid);
    },

    // Find task by keywords (for voice commands)
    findByKeywords(keywords) {
        const lowerKeywords = keywords.toLowerCase();
        return this.tasks.filter(t =>
            t.title.toLowerCase().includes(lowerKeywords)
        );
    },

    // Calculate task status based on due date
    getStatus(task) {
        if (task.completed) return 'completed';
        if (!task.dueDate) return 'no-date';

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dueDate = new Date(task.dueDate);
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate < today) return 'overdue';
        if (dueDate.getTime() === today.getTime()) return 'today';
        return 'upcoming';
    },

    // Get tasks grouped by status
    getGrouped() {
        const pending = this.getPending();
        return {
            overdue: pending.filter(t => this.getStatus(t) === 'overdue')
                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
            today: pending.filter(t => this.getStatus(t) === 'today')
                .sort((a, b) => (a.dueTime || '23:59').localeCompare(b.dueTime || '23:59')),
            upcoming: pending.filter(t => this.getStatus(t) === 'upcoming')
                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
            noDate: pending.filter(t => this.getStatus(t) === 'no-date')
        };
    },

    // Get overdue tasks
    getOverdue() {
        return this.getPending().filter(t => this.getStatus(t) === 'overdue');
    },

    // Get today's tasks
    getTodayTasks() {
        return this.getPending().filter(t => this.getStatus(t) === 'today');
    },

    // Get upcoming tasks (future dates)
    getUpcoming() {
        return this.getPending().filter(t => this.getStatus(t) === 'upcoming');
    },

    // Format due date for display
    formatDueDate(task) {
        if (!task.dueDate) return '';

        const dueDate = new Date(task.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const status = this.getStatus(task);

        if (status === 'overdue') {
            const daysAgo = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
            return daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
        }

        if (dueDate.getTime() === today.getTime()) {
            return task.dueTime ? `Today at ${this.formatTime(task.dueTime)}` : 'Today';
        }

        if (dueDate.getTime() === tomorrow.getTime()) {
            return task.dueTime ? `Tomorrow at ${this.formatTime(task.dueTime)}` : 'Tomorrow';
        }

        const options = { weekday: 'short', month: 'short', day: 'numeric' };
        const dateStr = dueDate.toLocaleDateString('en-US', options);
        return task.dueTime ? `${dateStr} at ${this.formatTime(task.dueTime)}` : dateStr;
    },

    // Format time from "HH:mm" to "h:mm AM/PM"
    formatTime(timeStr) {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':').map(Number);
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
};

window.Tasks = Tasks;
