// toast.js
window.showToast = function(message, type = 'error') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    // Clear previous toasts to prevent spam stacking!
    container.innerHTML = '';

    let cleanMessage = message;
    if (typeof message === 'string') {
        // If it's the classic popup closed error, just show a nice message
        if (message.includes('auth/popup-closed-by-user')) {
            cleanMessage = 'Google Sign-in was cancelled.';
        } else if (message.includes('auth/invalid-credential') || message.includes('auth/user-not-found') || message.includes('auth/wrong-password')) {
            cleanMessage = 'Invalid email or password. Please try again.';
        } else if (message.includes('auth/email-already-in-use')) {
            cleanMessage = 'This email is already registered. Please sign in.';
        } else {
            // General cleanup
            cleanMessage = message.replace(/^Firebase:\s*/i, '').replace(/\(auth\/.*\)\.?$/, '').trim();
            if (cleanMessage.toLowerCase() === 'error' || !cleanMessage) {
                cleanMessage = 'Something went wrong. Please try again.';
            }
        }
    }

    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;
    
    // Beautiful SVG icons instead of emojis
    const errorIcon = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    const successIcon = `<svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    
    const icon = type === 'error' ? errorIcon : successIcon;
    
    toast.innerHTML = `
        <div class="toast-icon">${icon}</div>
        <div class="toast-content">${cleanMessage}</div>
        <button class="toast-close">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"></path></svg>
        </button>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        setTimeout(() => toast.classList.add('show'), 10);
    });

    const closeBtn = toast.querySelector('.toast-close');
    
    const dismiss = () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    };

    closeBtn.addEventListener('click', dismiss);
    setTimeout(dismiss, 5000); // auto dismiss after 5s
};

// Override default alert
window.alert = function(msg) {
    window.showToast(msg, 'error');
};

// Custom Confirm Modal
window.showConfirm = function(message) {
    return new Promise((resolve) => {
        let container = document.getElementById('modal-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'modal-container';
            document.body.appendChild(container);
        }

        const overlay = document.createElement('div');
        overlay.className = 'custom-modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'custom-modal';
        
        modal.innerHTML = `
            <div class="modal-icon">
                <svg width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </div>
            <div class="modal-title">Confirm Delete</div>
            <div class="modal-content">${message}</div>
            <div class="modal-actions">
                <button class="modal-btn modal-cancel">Cancel</button>
                <button class="modal-btn modal-confirm">Delete</button>
            </div>
        `;

        overlay.appendChild(modal);
        container.appendChild(overlay);

        // Animation
        requestAnimationFrame(() => {
            setTimeout(() => {
                overlay.classList.add('show');
                modal.classList.add('show');
            }, 10);
        });

        const close = (result) => {
            overlay.classList.remove('show');
            modal.classList.remove('show');
            setTimeout(() => overlay.remove(), 400);
            resolve(result);
        };

        modal.querySelector('.modal-cancel').addEventListener('click', () => close(false));
        modal.querySelector('.modal-confirm').addEventListener('click', () => close(true));
    });
};
