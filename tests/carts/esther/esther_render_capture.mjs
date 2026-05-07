import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_PATH = process.env.BMSX_ESTHER_RENDER_CAPTURE_OUT ?? '/tmp/esther_render_capture.json';
const PLAYER_IMG_PREFIX = 'esther_dk_';

function makeButtonEvent(timeMs, code, down, pressId) {
	return {
		description: `${code}_${down ? 'down' : 'up'}_${timeMs}`,
		timeMs,
		event: {
			type: 'button',
			deviceId: 'keyboard:0',
			code,
			down,
			value: down ? 1 : 0,
			timestamp: timeMs,
			pressId,
			modifiers: { ctrl: false, shift: false, alt: false, meta: false },
		},
	};
}

function buildTimeline() {
	return [
		makeButtonEvent(200, 'ArrowRight', true, 1),
		makeButtonEvent(220, 'KeyS', true, 2),
		makeButtonEvent(1800, 'ArrowRight', false, 1),
		makeButtonEvent(1820, 'KeyS', false, 2),

		makeButtonEvent(2300, 'KeyX', true, 3),
		makeButtonEvent(2500, 'KeyX', false, 3),

		makeButtonEvent(3300, 'ArrowLeft', true, 4),
		makeButtonEvent(3320, 'KeyS', true, 5),
		makeButtonEvent(4200, 'KeyX', true, 6),
		makeButtonEvent(5000, 'ArrowLeft', false, 4),
		makeButtonEvent(5020, 'KeyS', false, 5),
		makeButtonEvent(5600, 'KeyX', false, 6),

		makeButtonEvent(6200, 'KeyX', true, 7),
		makeButtonEvent(8000, 'KeyX', false, 7),
	];
}

function toNumber(value, fallback) {
	const asNumber = Number(value);
	return Number.isFinite(asNumber) ? asNumber : fallback;
}

function captureSprite(options) {
	return {
		imgid: String(options?.imgid ?? options?.id ?? ''),
		layer: String(options?.layer ?? 'world'),
		pos: {
			x: toNumber(options?.pos?.x, 0),
			y: toNumber(options?.pos?.y, 0),
			z: toNumber(options?.pos?.z, 0),
		},
		scale: {
			x: toNumber(options?.scale?.x, 1),
			y: toNumber(options?.scale?.y, 1),
		},
		flip_h: Boolean(options?.flip?.flip_h),
		flip_v: Boolean(options?.flip?.flip_v),
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

export default function scheduleCapture({ logger, schedule, frameIntervalMs }) {
	const outputDir = path.dirname(OUTPUT_PATH);
	fs.mkdirSync(outputDir, { recursive: true });

	const timeline = buildTimeline();
	const capture = {
		startedAtIso: new Date().toISOString(),
		frameIntervalMs,
		timeline,
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

	function installCaptureHooks() {
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
			const playerSprite = findPlayerSprite(frameSprites);
			capture.frames.push({
				frame: renderedFrame,
				timeMs: Math.round(renderedFrame * frameIntervalMs),
				spriteCount: frameSprites.length,
				player: playerSprite,
			});
		};

		logger('[capture] hooks installed');
		return true;
	}

	function restorePatches() {
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

	function flushCapture(reason) {
		if (flushed) {
			return;
		}
		flushed = true;
		restorePatches();

		const payload = {
			...capture,
			reason,
			frameCount: capture.frames.length,
		};
		fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
		logger(`[capture] wrote ${payload.frameCount} frames to ${OUTPUT_PATH} reason=${reason}`);
	}

	schedule(timeline);
	if (!installCaptureHooks()) {
		installPolling = setInterval(() => {
			installCaptureHooks();
		}, 50);
	}
	setTimeout(() => {
		flushCapture('timer');
	}, 9500);

	process.once('exit', () => {
		flushCapture('process_exit');
	});
}
