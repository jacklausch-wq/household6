// AI Integration Module (via Cloudflare Worker with Groq/Llama)
const AI = {
    WORKER_URL: 'https://groqapikey.jcl-colden.workers.dev',

    // Check if AI is configured (always true since we use the worker)
    isConfigured() {
        return true;
    },

    // Get auth headers for AI requests
    // The worker should validate these to prevent unauthorized usage
    getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        // Include Firebase ID token if user is authenticated
        // The worker should verify this token server-side
        if (Auth.currentUser) {
            // Note: For full security, the worker must verify this token
            // by calling Firebase Admin SDK's verifyIdToken()
            headers['X-Firebase-UID'] = Auth.currentUser.uid;
        }

        return headers;
    },

    // Parse voice/text input using AI via Cloudflare Worker
    async parseInput(transcript, options = {}) {
        // Require authentication for AI requests
        if (!Auth.currentUser) {
            throw new Error('Authentication required for AI features');
        }

        const response = await fetch(this.WORKER_URL, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                transcript,
                isDocument: options.isDocument || false,
                filename: options.filename || null
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Worker request failed');
        }

        let parsed = await response.json();

        // Handle different response formats from AI
        if (Array.isArray(parsed)) {
            // AI returned a raw array - wrap it
            parsed = { items: parsed.map(item => this.processItem(item)) };
        } else if (parsed.items && Array.isArray(parsed.items)) {
            // AI returned {items: [...]} format
            parsed.items = parsed.items.map(item => this.processItem(item));
            // For backwards compatibility, if single item, also set top-level properties
            if (parsed.items.length === 1) {
                Object.assign(parsed, parsed.items[0]);
            }
        } else {
            // Handle single item at top level
            const processed = this.processItem(parsed);
            Object.assign(parsed, processed);
            parsed.items = [processed];
        }

        // Add raw transcript
        parsed.raw = transcript;

        return parsed;
    },

    // Process a single item (convert dates, apply defaults)
    processItem(item) {
        const processed = { ...item };

        // Convert date string to Date object if present
        if (processed.date && typeof processed.date === 'string') {
            const dateParts = processed.date.split('-');
            const dateObj = new Date(
                parseInt(dateParts[0]),
                parseInt(dateParts[1]) - 1,
                parseInt(dateParts[2])
            );

            // Apply time if present
            if (processed.time && processed.time.hours !== undefined) {
                dateObj.setHours(processed.time.hours, processed.time.minutes || 0, 0, 0);
            } else if (processed.default_time) {
                // Apply default time (e.g., "20:00" for todos)
                const [hours, minutes] = processed.default_time.split(':').map(Number);
                dateObj.setHours(hours, minutes, 0, 0);
            }

            processed.date = dateObj;
        }

        // Normalize type for backwards compatibility
        if (processed.type === 'reminder') {
            processed.type = 'todo';
            processed.needs_notification = true;
        }

        return processed;
    },

    // Legacy alias for backwards compatibility
    async parseVoiceInput(transcript) {
        return this.parseInput(transcript);
    },

    // Parse document content
    async parseDocument(text, filename) {
        return this.parseInput(text, { isDocument: true, filename });
    },

    // Parse recipe from text
    async parseRecipe(text) {
        if (!Auth.currentUser) {
            throw new Error('Authentication required for AI features');
        }

        const response = await fetch(this.WORKER_URL, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                transcript: text,
                isRecipe: true,
                parseType: 'recipe'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Recipe parsing failed');
        }

        return await response.json();
    },

    // Parse recipe from image (base64)
    async parseRecipeImage(base64Image) {
        if (!Auth.currentUser) {
            throw new Error('Authentication required for AI features');
        }

        const response = await fetch(this.WORKER_URL, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                image: base64Image,
                isRecipe: true,
                parseType: 'recipe-image'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Recipe image parsing failed');
        }

        return await response.json();
    }
};

// Backwards compatibility alias
const Gemini = AI;

window.AI = AI;
window.Gemini = Gemini;
