// Smart Reminders Module (OpenRouteService for driving directions)
const Reminders = {
    // OpenRouteService API
    ORS_API_KEY: 'YOUR_OPENROUTESERVICE_API_KEY', // TODO: Replace with your key
    ORS_BASE: 'https://api.openrouteservice.org',

    homeAddress: null,
    homeCoords: null,
    bufferMinutes: 20,
    scheduledReminders: new Map(),

    // Initialize reminders
    async init() {
        // Load user settings
        await this.loadSettings();
    },

    // Load settings from Firestore
    async loadSettings() {
        if (!Auth.currentUser) return;

        const doc = await db.collection('users').doc(Auth.currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            this.homeAddress = data.homeAddress || null;
            this.bufferMinutes = data.bufferMinutes || 20;

            // Geocode home address if we have one
            if (this.homeAddress && !this.homeCoords) {
                this.homeCoords = await this.geocode(this.homeAddress);
            }
        }
    },

    // Save settings
    async saveSettings(settings) {
        if (!Auth.currentUser) return;

        await db.collection('users').doc(Auth.currentUser.uid).update(settings);

        if (settings.homeAddress !== undefined) {
            this.homeAddress = settings.homeAddress;
            if (this.homeAddress) {
                this.homeCoords = await this.geocode(this.homeAddress);
            } else {
                this.homeCoords = null;
            }
        }

        if (settings.bufferMinutes !== undefined) {
            this.bufferMinutes = settings.bufferMinutes;
        }
    },

    // Geocode an address to coordinates
    async geocode(address) {
        try {
            const response = await fetch(
                `${this.ORS_BASE}/geocode/search?` +
                `api_key=${this.ORS_API_KEY}&` +
                `text=${encodeURIComponent(address)}&` +
                `size=1`
            );

            if (!response.ok) throw new Error('Geocoding failed');

            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const coords = data.features[0].geometry.coordinates;
                return { lng: coords[0], lat: coords[1] };
            }

            return null;
        } catch (error) {
            console.error('Geocoding error:', error);
            return null;
        }
    },

    // Get driving duration between two points (in minutes)
    async getDrivingDuration(fromCoords, toCoords) {
        try {
            const response = await fetch(
                `${this.ORS_BASE}/v2/directions/driving-car?` +
                `api_key=${this.ORS_API_KEY}&` +
                `start=${fromCoords.lng},${fromCoords.lat}&` +
                `end=${toCoords.lng},${toCoords.lat}`
            );

            if (!response.ok) throw new Error('Directions failed');

            const data = await response.json();

            if (data.features && data.features.length > 0) {
                const durationSeconds = data.features[0].properties.summary.duration;
                return Math.ceil(durationSeconds / 60); // Convert to minutes, round up
            }

            return null;
        } catch (error) {
            console.error('Directions error:', error);
            return null;
        }
    },

    // Calculate when to send reminder for an event
    async calculateReminderTime(event) {
        if (!event.location || !this.homeCoords) {
            return null;
        }

        // Geocode event location
        const eventCoords = await this.geocode(event.location);
        if (!eventCoords) {
            return null;
        }

        // Get driving duration
        const drivingMinutes = await this.getDrivingDuration(this.homeCoords, eventCoords);
        if (!drivingMinutes) {
            return null;
        }

        // Calculate reminder time: event time - driving time - buffer
        const eventTime = new Date(event.startDate);
        const totalLeadTime = drivingMinutes + this.bufferMinutes;
        const reminderTime = new Date(eventTime.getTime() - (totalLeadTime * 60 * 1000));

        return {
            reminderTime,
            drivingMinutes,
            bufferMinutes: this.bufferMinutes,
            leaveByTime: new Date(eventTime.getTime() - (drivingMinutes * 60 * 1000))
        };
    },

    // Schedule a reminder for an event
    async scheduleReminder(event) {
        const reminderInfo = await this.calculateReminderTime(event);
        if (!reminderInfo) return null;

        const now = new Date();
        const msUntilReminder = reminderInfo.reminderTime.getTime() - now.getTime();

        // Only schedule if reminder is in the future
        if (msUntilReminder <= 0) return null;

        // Clear any existing reminder for this event
        this.cancelReminder(event.id);

        // Schedule the reminder
        const timeoutId = setTimeout(() => {
            this.triggerReminder(event, reminderInfo);
        }, msUntilReminder);

        this.scheduledReminders.set(event.id, {
            timeoutId,
            event,
            reminderInfo
        });

        return reminderInfo;
    },

    // Cancel a scheduled reminder
    cancelReminder(eventId) {
        const scheduled = this.scheduledReminders.get(eventId);
        if (scheduled) {
            clearTimeout(scheduled.timeoutId);
            this.scheduledReminders.delete(eventId);
        }
    },

    // Trigger the reminder notification
    async triggerReminder(event, reminderInfo) {
        const title = `Time to leave for ${event.title}`;
        const body = `Leave by ${this.formatTime(reminderInfo.leaveByTime)} to arrive on time. ` +
            `(${reminderInfo.drivingMinutes} min drive)`;

        await Notifications.send(title, body, {
            tag: `event-${event.id}`,
            data: { eventId: event.id, type: 'smart-reminder' }
        });

        this.scheduledReminders.delete(event.id);
    },

    // Schedule reminders for all upcoming events with locations
    async scheduleAllReminders() {
        const events = await Calendar.getTodayEvents();

        for (const event of events) {
            if (event.location) {
                await this.scheduleReminder(event);
            }
        }
    },

    // Format time for display
    formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    },

    // Get reminder info for an event (for display purposes)
    async getReminderInfo(event) {
        return this.calculateReminderTime(event);
    }
};

window.Reminders = Reminders;
