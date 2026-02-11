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

function makeTimeline(scenario) {
	if (scenario === 'stop') {
		return [
			{ description: 'start_move_right', timeMs: 2500, event: buttonEvent('ArrowRight', true, 1, 2500) },
			{ description: 'release_move_right', timeMs: 3000, event: buttonEvent('ArrowRight', false, 1, 3000) },
		];
	}

	if (scenario === 'stand_jump') {
		return [
			{ description: 'jump_press', timeMs: 2500, event: buttonEvent('KeyX', true, 3, 2500) },
			{ description: 'jump_release', timeMs: 4700, event: buttonEvent('KeyX', false, 3, 4700) },
		];
	}

	if (scenario === 'run_jump') {
		return [
			{ description: 'start_move_right', timeMs: 2500, event: buttonEvent('ArrowRight', true, 4, 2500) },
			{ description: 'jump_press', timeMs: 2900, event: buttonEvent('KeyX', true, 6, 2900) },
			{ description: 'jump_release', timeMs: 4700, event: buttonEvent('KeyX', false, 6, 4700) },
			{ description: 'release_move_right', timeMs: 3300, event: buttonEvent('ArrowRight', false, 4, 3300) },
		];
	}

	if (scenario === 'direction_release_jump_hold') {
		return [
			{ description: 'start_move_right', timeMs: 2500, event: buttonEvent('ArrowRight', true, 7, 2500) },
			{ description: 'jump_press_hold', timeMs: 2900, event: buttonEvent('KeyX', true, 9, 2900) },
			{ description: 'release_move_right', timeMs: 3200, event: buttonEvent('ArrowRight', false, 7, 3200) },
			{ description: 'jump_release', timeMs: 4700, event: buttonEvent('KeyX', false, 9, 4700) },
		];
	}

	throw new Error(`Unknown ESTHER_RENDER_SCENARIO '${scenario}'.`);
}

function uniqueMarkerTimes(entries) {
	const known = new Set();
	const times = [];
	for (let i = 0; i < entries.length; i += 1) {
		const t = Number(entries[i].timeMs);
		if (!known.has(t)) {
			known.add(t);
			times.push(t);
		}
	}
	times.push(9000);
	times.sort((a, b) => a - b);
	return times;
}

export default function scheduleScenario(context) {
	const scenario = process.env.ESTHER_RENDER_SCENARIO ?? 'stop';
	const entries = makeTimeline(scenario);
	context.logger(`[marker] scenario=${scenario}`);
	const markerTimes = uniqueMarkerTimes(entries);
	for (let i = 0; i < markerTimes.length; i += 1) {
		const timeMs = markerTimes[i];
		setTimeout(() => {
			context.logger(`[marker] t=${timeMs}`);
		}, timeMs);
	}
	context.schedule(entries);
}
