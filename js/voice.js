// Voice Input Module (Web Speech API)
const Voice = {
    recognition: null,
    isListening: false,
    transcript: '',
    onResult: null,
    onError: null,
    onEnd: null,

    // Check if speech recognition is supported
    isSupported() {
        return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    },

    // Initialize speech recognition
    init() {
        if (!this.isSupported()) {
            console.warn('Speech recognition not supported');
            return false;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();

        this.recognition.continuous = false;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
            this.isListening = true;
            this.transcript = '';
        };

        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            this.transcript = finalTranscript || interimTranscript;

            if (this.onResult) {
                this.onResult(this.transcript, !!finalTranscript);
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.isListening = false;
            if (this.onError) {
                this.onError(event.error);
            }
        };

        this.recognition.onend = () => {
            this.isListening = false;
            if (this.onEnd) {
                this.onEnd(this.transcript);
            }
        };

        return true;
    },

    // Start listening
    start() {
        if (!this.recognition) {
            if (!this.init()) return false;
        }

        try {
            this.recognition.start();
            return true;
        } catch (error) {
            console.error('Failed to start recognition:', error);
            return false;
        }
    },

    // Stop listening
    stop() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
    },

    // Parse natural language input into structured data (async - tries AI first)
    async parse(text) {
        // Try AI parsing first if Gemini is configured
        if (typeof Gemini !== 'undefined' && Gemini.isConfigured()) {
            try {
                console.log('Parsing with Gemini AI...');
                const aiResult = await Gemini.parseVoiceInput(text);
                console.log('Gemini result:', aiResult);
                return aiResult;
            } catch (error) {
                console.warn('Gemini parsing failed, falling back to regex:', error);
                // Fall through to regex parsing
            }
        }

        // Fallback: regex-based parsing
        return this.parseWithRegex(text);
    },

    // Original regex-based parsing (fallback)
    parseWithRegex(text) {
        const result = {
            type: null, // 'event', 'task', 'complete', 'list'
            title: null,
            date: null,
            time: null,
            location: null,
            assignee: null,
            recurring: false,
            frequency: null,
            raw: text
        };

        const lowerText = text.toLowerCase().trim();

        // Check for list command
        if (lowerText.match(/^(what('s| is)|show|list|tell me).*(to ?do|task|schedule|event|happening|going on)/i)) {
            result.type = 'list';
            return result;
        }

        // Check for completion command
        if (lowerText.match(/^(i |i've |we |we've )?(done|finished|completed|did|checked off)/i) ||
            lowerText.match(/(mark|check).*(done|complete|off)/i)) {
            result.type = 'complete';
            // Extract what was completed
            const completedMatch = text.match(/(?:done|finished|completed|did|checked off|mark|check)[^a-z]*(.+?)(?:\s*$|done|complete|off)/i);
            if (completedMatch) {
                result.title = completedMatch[1].trim();
            }
            return result;
        }

        // Parse date/time patterns
        const dateTimePatterns = [
            // "at 3pm", "at 3:00 pm"
            { pattern: /at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, group: 'time' },
            // "tomorrow", "today"
            { pattern: /\b(today|tomorrow|tonight)\b/i, group: 'relativeDate' },
            // "on Monday", "on Tuesday"
            { pattern: /on (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, group: 'weekday' },
            // "next Monday"
            { pattern: /next (monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, group: 'nextWeekday' },
            // "January 15", "Jan 15th"
            { pattern: /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, group: 'monthDay' },
            // "at Kids doctor", "at the gym"
            { pattern: /(?:at|@) (the )?([A-Z][a-z]+(?:'s)?(?:\s+[A-Z][a-z]+)*)/g, group: 'location' }
        ];

        // Extract time
        const timeMatch = text.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const meridiem = timeMatch[3]?.toLowerCase();

            if (meridiem === 'pm' && hours < 12) hours += 12;
            if (meridiem === 'am' && hours === 12) hours = 0;
            if (!meridiem && hours < 8) hours += 12; // Assume PM for small hours

            result.time = { hours, minutes };
        }

        // Extract date
        const todayMatch = lowerText.match(/\b(today|tonight)\b/);
        const tomorrowMatch = lowerText.match(/\btomorrow\b/);
        const weekdayMatch = lowerText.match(/(?:on |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);

        const now = new Date();

        if (todayMatch) {
            result.date = new Date(now);
        } else if (tomorrowMatch) {
            result.date = new Date(now);
            result.date.setDate(result.date.getDate() + 1);
        } else if (weekdayMatch) {
            const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const targetDay = weekdays.indexOf(weekdayMatch[1].toLowerCase());
            const currentDay = now.getDay();
            let daysUntil = targetDay - currentDay;
            if (daysUntil <= 0 || lowerText.includes('next')) {
                daysUntil += 7;
            }
            result.date = new Date(now);
            result.date.setDate(result.date.getDate() + daysUntil);
        }

        // Apply time to date
        if (result.date && result.time) {
            result.date.setHours(result.time.hours, result.time.minutes, 0, 0);
        }

        // Extract location (look for "at [Place]" where Place is capitalized)
        const locationMatch = text.match(/(?:at|@)\s+(?:the\s+)?([A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)*)/);
        if (locationMatch) {
            result.location = locationMatch[1];
        }

        // Check for recurring patterns
        if (lowerText.match(/\b(every day|daily)\b/)) {
            result.recurring = true;
            result.frequency = 'daily';
        } else if (lowerText.match(/\bevery week|weekly\b/)) {
            result.recurring = true;
            result.frequency = 'weekly';
        } else if (lowerText.match(/\bevery month|monthly\b/)) {
            result.recurring = true;
            result.frequency = 'monthly';
        }

        // Determine if this is an event (has time) or task (no time)
        result.type = result.time ? 'event' : 'task';

        // Extract title (remove date/time/location words)
        let title = text
            .replace(/\b(today|tomorrow|tonight)\b/gi, '')
            .replace(/\b(on |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
            .replace(/\bat \d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, '')
            .replace(/(?:at|@)\s+(?:the\s+)?[A-Z][a-zA-Z']+(?:\s+[A-Z][a-zA-Z']+)*/g, '')
            .replace(/\b(every day|daily|every week|weekly|every month|monthly)\b/gi, '')
            .replace(/\b(add|create|schedule|set|remind me|remind us|put|make)\b/gi, '')
            .replace(/\b(a |an |the )\b/gi, '')
            .replace(/\b(to do|task|event|appointment|reminder)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Capitalize first letter
        if (title) {
            result.title = title.charAt(0).toUpperCase() + title.slice(1);
        }

        return result;
    },

    // Create event or task from parsed result
    async execute(parsed) {
        if (parsed.type === 'list') {
            return { action: 'list', tasks: Tasks.getPending() };
        }

        if (parsed.type === 'complete') {
            const matches = Tasks.findByKeywords(parsed.title);
            if (matches.length === 1) {
                await Tasks.toggleComplete(matches[0].id);
                return { action: 'completed', task: matches[0] };
            } else if (matches.length > 1) {
                return { action: 'ambiguous', matches };
            } else {
                return { action: 'notFound', query: parsed.title };
            }
        }

        // Shopping list items
        if (parsed.type === 'shopping') {
            if (!parsed.title) {
                console.warn('Shopping item skipped - no title:', parsed);
                return { action: 'skipped', reason: 'no title' };
            }
            const item = await Shopping.add({
                name: parsed.title,
                quantity: parsed.quantity || null,
                unit: parsed.unit || null,
                category: parsed.category || null
            });
            return { action: 'shoppingAdded', item };
        }

        if (parsed.type === 'event' && parsed.date) {
            if (!parsed.title) {
                console.warn('Event creation skipped - no title:', parsed);
                return { action: 'skipped', reason: 'no title' };
            }

            // Check for saved location
            let location = parsed.location;
            let savedLocationId = null;

            if (location) {
                const savedLocation = await Locations.findByKeyword(location);
                if (savedLocation) {
                    location = savedLocation.address;
                    savedLocationId = savedLocation.id;
                }
            }

            // Determine if this is an all-day event (no specific time)
            const isAllDay = !parsed.time;

            const event = await Calendar.createEvent({
                title: parsed.title,
                startDate: parsed.date,
                location,
                savedLocationId,
                smartReminder: !!location,
                allDay: isAllDay
            });

            return { action: 'eventCreated', event };
        }

        if (parsed.type === 'todo' || parsed.type === 'task' || !parsed.date) {
            // Ensure we have a title
            if (!parsed.title) {
                console.warn('Task creation skipped - no title:', parsed);
                return { action: 'skipped', reason: 'no title' };
            }

            // Format due date as ISO string if present
            let dueDate = null;
            let dueTime = null;

            if (parsed.date) {
                if (parsed.date instanceof Date) {
                    dueDate = parsed.date.toISOString().split('T')[0];
                    // If there's a specific time (not just default), capture it
                    if (parsed.time || parsed.default_time) {
                        const hours = parsed.time?.hours ?? parseInt(parsed.default_time?.split(':')[0] || 20);
                        const minutes = parsed.time?.minutes ?? parseInt(parsed.default_time?.split(':')[1] || 0);
                        dueTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                    }
                } else if (typeof parsed.date === 'string') {
                    dueDate = parsed.date;
                }
            }

            const task = await Tasks.create({
                title: parsed.title,
                recurring: parsed.recurring,
                frequency: parsed.frequency,
                dueDate,
                dueTime,
                needsNotification: parsed.needs_notification || false
            });

            return { action: 'taskCreated', task };
        }

        return { action: 'unknown' };
    }
};

window.Voice = Voice;
