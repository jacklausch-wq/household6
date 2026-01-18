// Security Utilities Module
const Security = {
    // HTML entity map for escaping
    htmlEntities: {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    },

    // Escape HTML to prevent XSS attacks
    escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`=\/]/g, char => this.htmlEntities[char]);
    },

    // Alias for convenience
    esc(str) {
        return this.escapeHtml(str);
    },

    // Escape for use in HTML attributes
    escapeAttr(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    // Rate limiter for sensitive operations
    rateLimiter: {
        attempts: {},

        // Check if action is allowed (returns true if allowed)
        check(key, maxAttempts = 5, windowMs = 60000) {
            const now = Date.now();

            if (!this.attempts[key]) {
                this.attempts[key] = { count: 1, firstAttempt: now };
                return true;
            }

            const record = this.attempts[key];

            // Reset if window has passed
            if (now - record.firstAttempt > windowMs) {
                this.attempts[key] = { count: 1, firstAttempt: now };
                return true;
            }

            // Check if under limit
            if (record.count < maxAttempts) {
                record.count++;
                return true;
            }

            // Rate limited
            return false;
        },

        // Get remaining wait time in seconds
        getWaitTime(key, windowMs = 60000) {
            const record = this.attempts[key];
            if (!record) return 0;

            const elapsed = Date.now() - record.firstAttempt;
            const remaining = Math.ceil((windowMs - elapsed) / 1000);
            return Math.max(0, remaining);
        },

        // Reset attempts for a key
        reset(key) {
            delete this.attempts[key];
        }
    }
};

// Global shorthand for escaping HTML
const esc = (str) => Security.escapeHtml(str);

window.Security = Security;
window.esc = esc;
