// Rewind Debugger UI extracted from bmsxdebugger.ts
// Provides: showRewindDialog, gamePaused, gameResumed

import { $ } from '../core/game';

export function showRewindDialog() {
	// Remove any existing rewind overlay
	let rewindOverlay = document.getElementById('rewind-overlay');
	if (rewindOverlay) rewindOverlay.remove();

	// Create overlay
	rewindOverlay = document.createElement('div');
	rewindOverlay.id = 'rewind-overlay';
	// All overlay styling is now in CSS

	// Title
	const title = document.createElement('div');
	title.className = 'rewind-title';
	rewindOverlay.appendChild(title);

	// Info
	const info = document.createElement('div');
	info.className = 'rewind-info';
	rewindOverlay.appendChild(info);

	// --- Modern progress bar ---
	const barContainer = document.createElement('div');
	barContainer.className = 'rewind-bar-container';
	rewindOverlay.appendChild(barContainer);

	const barFill = document.createElement('div');
	barFill.className = 'rewind-bar-fill';
	barContainer.appendChild(barFill);

	const barHandle = document.createElement('div');
	barHandle.className = 'rewind-bar-handle';
	barContainer.appendChild(barHandle);

	// Drag logic
	let dragging = false;
	// Throttle rapid frame jumps to avoid overlapping model loads
	let lastJumpTime = 0;
	const JUMP_INTERVAL = 50; // ms
	function setFrameFromBar(x: number) {
		const now = performance.now();
		if (now - lastJumpTime < JUMP_INTERVAL) return;
		lastJumpTime = now;
		if (!$) return;
		const rect = barContainer.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
		const frames = $.getRewindFrames() || [];
		const idx = Math.round(percent * (frames.length - 1));
		if ($.jumpToFrame(idx)) {
			updateInfo();
			$.requestPausedFrame();
		}
	}
	barContainer.addEventListener('mousedown', e => {
		dragging = true;
		barHandle.classList.add('dragging');
		setFrameFromBar(e.clientX);
	});
	window.addEventListener('mousemove', e => {
		if (dragging) setFrameFromBar(e.clientX);
	});
	window.addEventListener('mouseup', () => {
		if (dragging) {
			dragging = false;
			barHandle.classList.remove('dragging');
		}
	});

	// Close button
	const closeBtn = document.createElement('button');
	closeBtn.textContent = '✖';
	closeBtn.title = 'Close';
	closeBtn.className = 'rewind-close-btn';
	closeBtn.onclick = () => rewindOverlay.remove();
	rewindOverlay.appendChild(closeBtn);

	// --- Update bar fill/handle on frame change ---
	function updateInfo() {
		if (!$) return;
		const frames = $.getRewindFrames();
		let idx = $.getCurrentRewindFrameIndex();
		const totalFrames = frames.length - 1; // Exclude the current frame
		const windowSeconds = (totalFrames / 50).toFixed(2); // 50fps = 0.02s per frame
		title.textContent = `Rewind (${windowSeconds}s, frames: ${totalFrames})`;
		const dt = -((totalFrames - idx) / 50).toFixed(2);
		info.textContent = `Δt: ${dt} s — Δf: ${-((frames.length - 1) - idx)}`;
		const percent = frames.length > 1 ? idx / (frames.length - 1) : 0;
		barFill.style.width = `${percent * 100}%`;
		barHandle.style.left = `calc(${percent * 100}%)`;
	}

	updateInfo();
	document.body.appendChild(rewindOverlay);
}

export function gamePaused() {
	showRewindDialog();
}

export function gameResumed() {
	let rewindOverlay = document.getElementById('rewind-overlay');
	if (rewindOverlay) rewindOverlay.remove();
}
