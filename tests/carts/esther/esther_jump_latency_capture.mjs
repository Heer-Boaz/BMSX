import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_PATH = process.env.BMSX_ESTHER_JUMP_CAPTURE_OUT ?? '/tmp/esther_jump_latency_capture.json';
const PLAYER_IMG_PREFIX = 'esther_dk_';

function buttonEvent(code, down, pressId, timeMs) {
	return {
		type: 'button',
		deviceId: 'keyboard:0',
		code,
		down,
		value: down ? 1 : 0,
		timestamp: timeMs,
		pressId,
		modifiers: { ctrl: false, shift: false, alt: false, meta: false },
	};
}

function buildTimeline() {
	return [
		{ description: 'jump_press', timeMs: 120, event: buttonEvent('KeyX', true, 1, 120) },
		{ description: 'jump_release', timeMs: 620, event: buttonEvent('KeyX', false, 1, 620) },
	];
}

function toNumber(value, fallback) {
	const asNumber = Number(value);
	return Number.isFinite(asNumber) ? asNumber : fallback;
}

function captureSprite(options) {
	return {
		imgid: String(options?.imgid ?? options?.id ?? ''),
		pos: {
			x: toNumber(options?.pos?.x, 0),
			y: toNumber(options?.pos?.y, 0),
			z: toNumber(options?.pos?.z, 0),
		},
		flip_h: Boolean(options?.flip?.flip_h),
	};
}

function findPlayerSprite(frameSprites) {
	for (let i = 0; i < frameSprites.length; i += 1) {
		const sprite = frameSprites[i];
		if (sprite.imgid.startsWith(PLAYER_IMG_PREFIX)) {
			return sprite;
		}
	}
	return frameSprites.length > 0 ? frameSprites[0] : null;
}

export default function scheduleLatencyCapture(context) {
	const outputDir = path.dirname(OUTPUT_PATH);
	fs.mkdirSync(outputDir, { recursive: true });

	const capture = {
		startedAtIso: new Date().toISOString(),
		frameIntervalMs: context.frameIntervalMs,
		timeline: [],
		frames: [],
	};

	let view = null;
	let rendererSubmit = null;
	let originalSpriteSubmit = null;
	let originalTypedSubmit = null;
	let originalDrawgame = null;
	let frameSprites = [];
	let installPolling = null;
	let restored = false;
	let flushed = false;
	let jumpScheduled = false;

	function installHooks() {
		if (originalSpriteSubmit || originalDrawgame) {
			return true;
		}
		view = globalThis.$?.view ?? null;
		if (!view) {
			return false;
		}
		rendererSubmit = view.renderer.submit;
		originalSpriteSubmit = rendererSubmit.sprite.bind(rendererSubmit);
		originalTypedSubmit = rendererSubmit.typed.bind(rendererSubmit);
		originalDrawgame = view.drawgame.bind(view);

		rendererSubmit.sprite = (options) => {
			frameSprites.push(captureSprite(options));
			return originalSpriteSubmit(options);
		};
		rendererSubmit.typed = (submission) => {
			if (submission && submission.sprite) {
				frameSprites.push(captureSprite(submission.sprite));
			}
			return originalTypedSubmit(submission);
		};

		view.drawgame = function patchedDrawgame() {
			frameSprites = [];
			originalDrawgame();
			const renderedFrame = toNumber(this.renderFrameIndex, 0) - 1;
			const player = findPlayerSprite(frameSprites);
			if (!jumpScheduled && player) {
				jumpScheduled = true;
				const nowMs = Math.round(renderedFrame * context.frameIntervalMs);
				const jumpPressMs = nowMs + 120;
				const jumpReleaseMs = nowMs + 620;
				const timeline = [
					{ description: 'jump_press', timeMs: jumpPressMs, event: buttonEvent('KeyX', true, 1, jumpPressMs) },
					{ description: 'jump_release', timeMs: jumpReleaseMs, event: buttonEvent('KeyX', false, 1, jumpReleaseMs) },
				];
				capture.timeline = timeline;
				context.logger(`[jump-latency] scheduling jump at press=${jumpPressMs}ms release=${jumpReleaseMs}ms`);
				context.schedule(timeline);
			}
			capture.frames.push({
				frame: renderedFrame,
				timeMs: Math.round(renderedFrame * context.frameIntervalMs),
				player,
			});
		};

		context.logger('[jump-latency] hooks installed');
		return true;
	}

	function restoreHooks() {
		if (restored) {
			return;
		}
		restored = true;
		if (installPolling !== null) {
			clearInterval(installPolling);
			installPolling = null;
		}
		if (rendererSubmit && originalSpriteSubmit) {
			rendererSubmit.sprite = originalSpriteSubmit;
		}
		if (rendererSubmit && originalTypedSubmit) {
			rendererSubmit.typed = originalTypedSubmit;
		}
		if (view && originalDrawgame) {
			view.drawgame = originalDrawgame;
		}
	}

	function flush(reason) {
		if (flushed) {
			return;
		}
		flushed = true;
		restoreHooks();
		const payload = {
			...capture,
			reason,
			frameCount: capture.frames.length,
		};
		fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
		context.logger(`[jump-latency] wrote ${payload.frameCount} frames to ${OUTPUT_PATH} reason=${reason}`);
	}

	if (!installHooks()) {
		installPolling = setInterval(() => {
			installHooks();
		}, 20);
	}

	setTimeout(() => {
		flush('timer');
	}, 7000);

	process.once('exit', () => {
		flush('process_exit');
	});
}
