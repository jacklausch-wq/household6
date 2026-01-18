// Google Calendar Integration Module
const Calendar = {
    events: [],
    calendars: [],
    selectedCalendarId: null,
    tokenRefreshInProgress: false,

    // Google Calendar API base URL
    API_BASE: 'https://www.googleapis.com/calendar/v3',

    // Check if calendar is available (has token)
    isAvailable() {
        return !!Auth.accessToken;
    },

    // Check if calendar was connected (Google linked) but needs token refresh
    needsTokenRefresh() {
        return Auth.calendarConnected && !Auth.accessToken;
    },

    // Make authenticated API request
    async apiRequest(endpoint, options = {}, isRetry = false) {
        // If no token but Google is linked, try to get one first
        if (!Auth.accessToken && Auth.calendarConnected && !isRetry) {
            const token = await this.tryRefreshToken();
            if (!token) {
                throw new Error('Calendar session expired. Please reconnect in Settings.');
            }
        }

        if (!Auth.accessToken) {
            throw new Error('Calendar not connected. Please connect your Google Calendar in Settings.');
        }

        const url = `${this.API_BASE}${endpoint}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${Auth.accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (response.status === 401 || response.status === 403) {
            if (isRetry) {
                // Clear the bad token
                Auth.accessToken = null;
                sessionStorage.removeItem('googleAccessToken');
                throw new Error('Calendar session expired. Please reconnect in Settings.');
            }
            // Token expired - try to refresh silently first
            const refreshed = await this.tryRefreshToken();
            if (refreshed) {
                return this.apiRequest(endpoint, options, true);
            }
            throw new Error('Calendar session expired. Please reconnect in Settings.');
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        return response.json();
    },

    // Try to refresh the token - but NEVER trigger popup (would be blocked by browser)
    // This just returns false if token is missing - user must manually reconnect
    async tryRefreshToken() {
        // We can't auto-refresh because popups get blocked when not from user action
        // Just return false and let the caller handle the missing token gracefully
        console.log('Calendar token missing - user must reconnect in Settings');
        return false;
    },

    // Get list of user's calendars
    async getCalendarList() {
        try {
            const data = await this.apiRequest('/users/me/calendarList');
            this.calendars = data.items || [];
            return this.calendars;
        } catch (error) {
            // Error fetching calendars
            return [];
        }
    },

    // Set the selected calendar
    async setSelectedCalendar(calendarId) {
        this.selectedCalendarId = calendarId;
        if (Household.currentHousehold) {
            await Household.update({ selectedCalendarId: calendarId });
        }
    },

    // Load selected calendar from household settings
    loadSelectedCalendar() {
        if (Household.currentHousehold?.selectedCalendarId) {
            this.selectedCalendarId = Household.currentHousehold.selectedCalendarId;
        }
    },

    // Get events for a date range
    async getEvents(startDate, endDate) {
        if (!this.selectedCalendarId) return [];

        try {
            const timeMin = startDate.toISOString();
            const timeMax = endDate.toISOString();

            const data = await this.apiRequest(
                `/calendars/${encodeURIComponent(this.selectedCalendarId)}/events?` +
                `timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`
            );

            this.events = (data.items || []).map(this.normalizeEvent);
            return this.events;
        } catch (error) {
            // Error fetching events
            return [];
        }
    },

    // Get today's events
    async getTodayEvents() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const end = new Date();
        end.setHours(23, 59, 59, 999);

        return this.getEvents(start, end);
    },

    // Get events for a specific day
    async getDayEvents(date) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);

        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        return this.getEvents(start, end);
    },

    // Get events for current month
    async getMonthEvents(year, month) {
        const start = new Date(year, month, 1);
        const end = new Date(year, month + 1, 0, 23, 59, 59);

        return this.getEvents(start, end);
    },

    // Create a new event
    async createEvent(eventData) {
        if (!this.selectedCalendarId) {
            throw new Error('No calendar selected');
        }

        // For all-day events, Google Calendar uses exclusive end dates
        // So a single-day event on Jan 5 needs end date of Jan 6
        let endDate = eventData.endDate || eventData.startDate;
        if (eventData.allDay && !eventData.endDate) {
            endDate = new Date(eventData.startDate);
            endDate.setDate(endDate.getDate() + 1);
        }

        const event = {
            summary: eventData.title,
            location: eventData.location || '',
            description: eventData.description || '',
            start: eventData.allDay
                ? { date: this.formatDate(eventData.startDate) }
                : { dateTime: eventData.startDate.toISOString() },
            end: eventData.allDay
                ? { date: this.formatDate(endDate) }
                : { dateTime: (eventData.endDate || new Date(eventData.startDate.getTime() + 3600000)).toISOString() },
            reminders: {
                useDefault: false,
                overrides: []
            }
        };

        // If we have smart reminder data, we'll handle it separately
        if (eventData.smartReminder) {
            event.extendedProperties = {
                private: {
                    smartReminder: 'true',
                    savedLocationId: eventData.savedLocationId || ''
                }
            };
        }

        const createdEvent = await this.apiRequest(
            `/calendars/${encodeURIComponent(this.selectedCalendarId)}/events`,
            {
                method: 'POST',
                body: JSON.stringify(event)
            }
        );

        // Store event reference in Firestore for smart reminders
        if (Household.currentHousehold) {
            await db.collection('households')
                .doc(Household.currentHousehold.id)
                .collection('events')
                .doc(createdEvent.id)
                .set({
                    googleEventId: createdEvent.id,
                    title: eventData.title,
                    location: eventData.location || null,
                    startTime: eventData.startDate,
                    savedLocationId: eventData.savedLocationId || null,
                    createdBy: Auth.currentUser.uid,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
        }

        return this.normalizeEvent(createdEvent);
    },

    // Update an event
    async updateEvent(eventId, eventData) {
        if (!this.selectedCalendarId) {
            throw new Error('No calendar selected');
        }

        const event = {
            summary: eventData.title,
            location: eventData.location || '',
            description: eventData.description || ''
        };

        if (eventData.startDate) {
            event.start = eventData.allDay
                ? { date: this.formatDate(eventData.startDate) }
                : { dateTime: eventData.startDate.toISOString() };
        }

        if (eventData.endDate) {
            event.end = eventData.allDay
                ? { date: this.formatDate(eventData.endDate) }
                : { dateTime: eventData.endDate.toISOString() };
        }

        const updatedEvent = await this.apiRequest(
            `/calendars/${encodeURIComponent(this.selectedCalendarId)}/events/${eventId}`,
            {
                method: 'PATCH',
                body: JSON.stringify(event)
            }
        );

        return this.normalizeEvent(updatedEvent);
    },

    // Delete an event
    async deleteEvent(eventId) {
        if (!this.selectedCalendarId) {
            throw new Error('No calendar selected');
        }

        await this.apiRequest(
            `/calendars/${encodeURIComponent(this.selectedCalendarId)}/events/${eventId}`,
            { method: 'DELETE' }
        );

        // Remove from Firestore
        if (Household.currentHousehold) {
            await db.collection('households')
                .doc(Household.currentHousehold.id)
                .collection('events')
                .doc(eventId)
                .delete();
        }
    },

    // Normalize Google Calendar event to our format
    normalizeEvent(event) {
        const start = event.start.dateTime
            ? new Date(event.start.dateTime)
            : new Date(event.start.date);

        const end = event.end.dateTime
            ? new Date(event.end.dateTime)
            : new Date(event.end.date);

        return {
            id: event.id,
            title: event.summary || '(No title)',
            location: event.location || '',
            description: event.description || '',
            startDate: start,
            endDate: end,
            allDay: !event.start.dateTime,
            htmlLink: event.htmlLink
        };
    },

    // Format date as YYYY-MM-DD
    formatDate(date) {
        return date.toISOString().split('T')[0];
    },

    // Format time for display
    formatTime(date) {
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    },

    // Get events that have a location (for smart reminders)
    getEventsWithLocation() {
        return this.events.filter(e => e.location);
    }
};

window.Calendar = Calendar;
