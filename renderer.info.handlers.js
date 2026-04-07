// Info tab handlers module - attaches handlers to window
// This module expects DOM elements to be present. It imports shared utilities
// and exposes handler functions on `window` so wiring modules can call them.

import {
	escapeHtml,
	showToast,
	formatSubtitleForDisplay,
	showProgress,
	hideProgress,
	updateProgress,
	showResults,
	showError,
	hideError
} from './renderer.utils.js';

function getResults() {
	if (!window.results) window.results = [];
	return window.results;
}

window.escapeHtml = escapeHtml;
window.showToast = showToast;

window.isValidYouTubeUrl = function(url) {
	const patterns = [
		/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/,
		/^https?:\/\/youtube\.com\/watch\?v=[\w-]+/,
		/^https?:\/\/youtu\.be\/[\w-]+/
	];
	return patterns.some(pattern => pattern.test(url));
};

window.handleProcess = async function() {
	const videoUrlsTextarea = document.getElementById('video-urls');
	const processBtn = document.getElementById('process-btn');
	const resultsBody = document.getElementById('results-body');

	const urls = videoUrlsTextarea.value
		.split('\n')
		.map(url => url.trim())
		.filter(url => url && window.isValidYouTubeUrl(url));

	if (urls.length === 0) {
		showError && showError('Vui lòng nhập ít nhất một link YouTube hợp lệ!');
		return;
	}

	// Reset UI
	window.results = [];
	resultsBody.innerHTML = '';
	hideError && hideError();
	showProgress && showProgress();
	processBtn.disabled = true;
	const btnText = processBtn.querySelector('.btn-text');
	const btnLoader = processBtn.querySelector('.btn-loader');
	if (btnText) btnText.style.display = 'none';
	if (btnLoader) btnLoader.style.display = 'inline';

	const MAX_CONCURRENT = 5;
	let processedCount = 0;
	const videoResults = new Array(urls.length);

	async function processVideo(url, originalIndex) {
		try {
			const result = await window.electronAPI.getVideoInfo(url);
			if (result.success) {
				const videoData = result.data;
				videoResults[originalIndex] = { type: 'success', data: videoData, url: url };
			} else {
				videoResults[originalIndex] = { type: 'error', error: result.error, url: url };
			}
		} catch (error) {
			console.error('Error processing video:', error);
			videoResults[originalIndex] = { type: 'error', error: error.message, url: url };
		} finally {
			processedCount++;
			updateProgress && updateProgress((processedCount / urls.length) * 100, `Đang xử lý video ${processedCount}/${urls.length}...`);
		}
	}

	for (let i = 0; i < urls.length; i += MAX_CONCURRENT) {
		const batch = urls.slice(i, i + MAX_CONCURRENT);
		const batchPromises = batch.map((url, batchIndex) => processVideo(url, i + batchIndex));
		await Promise.allSettled(batchPromises);
	}

	// Display results
	resultsBody.innerHTML = '';
	window.results = [];

	videoResults.forEach((result, originalIndex) => {
		if (result && result.type === 'success') {
			const videoData = result.data;
			const displayIndex = originalIndex + 1;
			videoData.displayIndex = displayIndex;
			getResults().push(videoData);
			const resultIndex = getResults().length - 1;

			window.addResultRow && window.addResultRow(videoData, displayIndex, resultIndex);
			window.processThumbnailOCR && window.processThumbnailOCR(videoData, displayIndex);
		} else if (result && result.type === 'error') {
			window.addErrorRow && window.addErrorRow(result.url, result.error, originalIndex + 1);
		}
	});

	updateProgress && updateProgress(100, 'Hoàn thành!');
	hideProgress && hideProgress();
	showResults && showResults();
	processBtn.disabled = false;
	if (btnText) btnText.style.display = 'inline';
	if (btnLoader) btnLoader.style.display = 'none';
};

// addResultRow / addErrorRow
window.addResultRow = function(videoData, displayIndex, resultIndex) {
	const resultsBody = document.getElementById('results-body');
	const row = document.createElement('tr');
	row.id = `row-${displayIndex}`;

	row.innerHTML = `
		<td>${displayIndex}</td>
		<td class="thumbnail-cell">
			${videoData.thumbnail ?
			`<img src="${videoData.thumbnail}" alt="Thumbnail" class="thumbnail-img" onclick="window.showThumbnailModal('${videoData.thumbnail}', ${resultIndex})">` :
			'<span class="empty-state">Không có</span>'}
		</td>
		<td>
			<div class="thumbnail-text-container">
				<div class="text-on-thumbnail loading" 
					 id="thumbnail-text-${displayIndex}"
					 ${videoData.thumbnail ? `onclick="window.showThumbnailModal('${videoData.thumbnail}', ${resultIndex})"` : ''}
					 style="${videoData.thumbnail ? 'cursor: pointer;' : ''}"
					 title="${videoData.thumbnail ? 'Click để xem thumbnail lớn' : ''}">
					Đang xử lý OCR...
				</div>
				${videoData.thumbnail ? `<button class="btn-retry-ocr" onclick="window.retryThumbnailOCR(${resultIndex}, ${displayIndex})" title="Lấy lại text từ thumbnail">🔄 Lấy text</button>` : ''}
			</div>
		</td>
		<td class="title-cell">${escapeHtml(videoData.title)}</td>

		<td class="transcript-cell">
			${videoData.subtitle ?
			`<div id="transcript-${displayIndex}">${formatSubtitleForDisplay(videoData.subtitle)}</div>` :
			'<span class="empty-state">Không có transcript</span>'}
		</td>
		<td>
			<div class="action-buttons">
				${videoData.url ? `<button class="btn-action btn-view" onclick="window.openVideo('${videoData.url}')">Mở video</button>` : ''}
				${videoData.subtitle ? `<button class="btn-action btn-copy" onclick="window.copyTranscript(${resultIndex})">Copy transcript</button>` : ''}
				<button class="btn-action btn-copy-all" onclick="window.copyAllData(${resultIndex})">📋 Copy Data</button>
			</div>
		</td>
	`;

	resultsBody.appendChild(row);
};

window.addErrorRow = function(url, error, index) {
	const resultsBody = document.getElementById('results-body');
	const row = document.createElement('tr');
	row.style.background = '#fff3cd';

	row.innerHTML = `
		<td>${index}</td>
		<td colspan="5">
			<strong>Lỗi:</strong> ${escapeHtml(error)}<br>
			<small>URL: ${escapeHtml(url)}</small>
		</td>
	`;

	resultsBody.appendChild(row);
};

// processThumbnailOCR
window.processThumbnailOCR = async function(videoData, index) {
	const results = getResults();
	if (!videoData.thumbnail) {
		window.updateThumbnailText && window.updateThumbnailText(index, 'Không có thumbnail');
		return;
	}

	try {
		const result = await window.electronAPI.extractTextFromThumbnail(videoData.thumbnail, videoData.videoId);
		const resultIndex = index - 1;
		if (result.success && result.text) {
			if (results[resultIndex]) {
				results[resultIndex].thumbnailText = result.text;
			}
			window.updateThumbnailText && window.updateThumbnailText(index, result.text);
		} else {
			const errorText = result.error || 'Không phát hiện được chữ';
			if (results[resultIndex]) {
				results[resultIndex].thumbnailText = errorText;
			}
			window.updateThumbnailText && window.updateThumbnailText(index, errorText);
		}
	} catch (error) {
		console.error('OCR Error:', error);
		const errorText = 'Lỗi khi xử lý OCR';
		const resultIndex = index - 1;
		if (results[resultIndex]) {
			results[resultIndex].thumbnailText = errorText;
		}
		window.updateThumbnailText && window.updateThumbnailText(index, errorText);
	}
};

// updateThumbnailText
window.updateThumbnailText = function(index, text) {
	const elementId = `thumbnail-text-${index}`;
	const element = document.getElementById(elementId);
	if (element) {
		element.textContent = text || 'Không có chữ';
		element.classList.remove('loading');
		console.log(`Updated thumbnail text for element ${elementId}:`, text);
	} else {
		console.error(`Element not found: ${elementId}`);
	}
};

// retryThumbnailOCR
window.retryThumbnailOCR = async function(resultIndex, displayIndex) {
	const results = getResults();
	const videoData = results[resultIndex];
	if (!videoData || !videoData.thumbnail) {
		showToast && showToast('Không có thumbnail để OCR', 'warning');
		return;
	}

	const textElement = document.getElementById(`thumbnail-text-${displayIndex}`);
	if (textElement) {
		textElement.textContent = 'Đang xử lý OCR...';
		textElement.classList.add('loading');
	}

	await window.processThumbnailOCR && window.processThumbnailOCR(videoData, displayIndex);
};
