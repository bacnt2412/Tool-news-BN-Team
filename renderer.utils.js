// Shared UI utilities for renderer modules

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function showToast(message, type = 'success', duration = 3000) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.success}</div>
        <div class="toast-content">
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').remove()">&times;</button>
    `;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, duration);
}

export function formatSubtitle(subtitle) {
    if (!subtitle) return 'Không có';

    const lines = subtitle.split('\n');
    const textLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('WEBVTT') || line.startsWith('NOTE')) continue;
        if (/^(Kind|Language|Style|Region):\s*/i.test(line)) continue;
        if (line.includes('-->') && /^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/.test(line)) continue;
        if (/^\d+$/.test(line)) continue;
        if (line.startsWith('<') && line.endsWith('>')) continue;
        let cleanText = line.replace(/<[^>]+>/g, '').trim();
        if (!cleanText) continue;
        if (textLines.length > 0 && textLines[textLines.length - 1] === cleanText) continue;
        textLines.push(cleanText);
    }

    return textLines.join(' ');
}

export function formatSubtitleForDisplay(subtitle) {
    const fullText = formatSubtitle(subtitle);
    if (!fullText || fullText === 'Không có') return fullText;
    return escapeHtml(fullText);
}

export function updateProgress(percent, text) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.textContent = text;
}

export function showProgress() {
    const progressSection = document.getElementById('progress-section');
    if (progressSection) progressSection.style.display = 'block';
    updateProgress(0, 'Bắt đầu xử lý...');
}

export function hideProgress() {
    const progressSection = document.getElementById('progress-section');
    if (!progressSection) return;
    setTimeout(() => { progressSection.style.display = 'none'; }, 1000);
}

export function showResults() {
    const resultsSection = document.getElementById('results-section');
    if (resultsSection) resultsSection.style.display = 'block';
}

export function showError(message) {
    const errorSection = document.getElementById('error-section');
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) errorMessage.textContent = message;
    if (errorSection) errorSection.style.display = 'block';
}

export function hideError() {
    const errorSection = document.getElementById('error-section');
    if (errorSection) errorSection.style.display = 'none';
}
