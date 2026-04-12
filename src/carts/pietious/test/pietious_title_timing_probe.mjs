const TIMEOUT_MS = 15000;

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

function readTitleState(test) {
	const [state] = test.evalLua(`
		local constants = require('constants')
		local castle = oget('c')
		local room = oget('room')
		local player = oget('pietolon')
		local director = oget('d')
		local title = oget('title_screen')
		local title_timeline = nil
		local title_timeline_head = nil
		local director_state = 'other'
		local title_state = 'other'
		if director ~= nil then
			if director.sc:matches_state_path('director:/title_screen') then
				director_state = 'title_screen'
			elseif director.sc:matches_state_path('director:/title_start_wait') then
				director_state = 'title_start_wait'
			elseif director.sc:matches_state_path('director:/room') then
				director_state = 'room'
			end
		end
		if title ~= nil then
			if title.sc:matches_state_path('title_screen:/hidden') then
				title_state = 'hidden'
			elseif title.sc:matches_state_path('title_screen:/idle') then
				title_state = 'idle'
			elseif title.sc:matches_state_path('title_screen:/starting') then
				title_state = 'starting'
			end
			title_timeline = title:get_timeline('title_screen.start')
			if title_timeline ~= nil then
				title_timeline_head = title_timeline.head
			end
		end
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_director = director ~= nil,
			has_title = title ~= nil,
			director_state = director_state,
			title_state = title_state,
			title_visible = title ~= nil and title.visible or false,
			title_timeline_head = title_timeline_head,
			target_frame_ms = 1000000000 / machine_manifest.ufps,
			expected_title_last_head = (
				(constants.flow.title_start_blink_cycles * constants.flow.title_start_blink_phase_frames * 2)
				+ constants.flow.title_start_blink_phase_frames
				+ constants.flow.title_start_blink_tail_frames
			) - 1,
			expected_title_wait_frames = constants.flow.title_start_wait_frames,
		}
	`);
	return {
		...state,
		current_music: globalThis.$.sndmaster.currentTrackByType('music'),
	};
}

export default function schedule({ logger, test, frameIntervalMs }) {
	test.run(async () => {
		await test.waitForCartActive({
			timeoutMs: TIMEOUT_MS,
			settleMs: 500,
		});

		const idleState = await test.pollUntil(() => {
			const state = readTitleState(test);
			if (!state.has_castle || !state.has_room || !state.has_player || !state.has_director || !state.has_title) {
				return null;
			}
			if (state.director_state !== 'title_screen' || state.title_state !== 'idle' || !state.title_visible) {
				return null;
			}
			return state;
		}, {
			timeoutMs: TIMEOUT_MS,
			description: 'pietious title idle ready',
		});

		logger(
			`[probe] title idle ready hostFrame=${test.getRenderFrameIndex()} virtualMs=${test.nowMs()} `
			+ `frameIntervalMs=${frameIntervalMs} targetFrameMs=${idleState.target_frame_ms}`
		);

		const scheduledAtMs = test.nowMs();
		test.scheduleInput([
			{ description: 'title_start_enter_press', timeMs: scheduledAtMs + 40, event: buttonEvent('Enter', true, 1, scheduledAtMs + 40) },
			{ description: 'title_start_space_press', timeMs: scheduledAtMs + 40, event: buttonEvent('Space', true, 2, scheduledAtMs + 40) },
			{ description: 'title_start_enter_release', timeMs: scheduledAtMs + 200, event: buttonEvent('Enter', false, 1, scheduledAtMs + 200) },
			{ description: 'title_start_space_release', timeMs: scheduledAtMs + 200, event: buttonEvent('Space', false, 2, scheduledAtMs + 200) },
		]);

		let startHostFrame = -1;
		let startVirtualMs = -1;
		let waitHostFrame = -1;
		let waitVirtualMs = -1;

		const endState = await test.pollUntil(() => {
			const state = readTitleState(test);
			if (startHostFrame < 0 && state.director_state === 'title_screen' && typeof state.title_timeline_head === 'number' && state.title_timeline_head >= 0) {
				startHostFrame = test.getRenderFrameIndex();
				startVirtualMs = test.nowMs();
				logger(`[probe] title timeline started hostFrame=${startHostFrame} virtualMs=${startVirtualMs} head=${state.title_timeline_head}`);
			}
			if (waitHostFrame < 0 && state.director_state === 'title_start_wait') {
				waitHostFrame = test.getRenderFrameIndex();
				waitVirtualMs = test.nowMs();
				logger(`[probe] title wait entered hostFrame=${waitHostFrame} virtualMs=${waitVirtualMs}`);
			}
			if (state.director_state === 'room') {
				return state;
			}
			return null;
		}, {
			timeoutMs: TIMEOUT_MS,
			description: 'pietious title start completion',
		});

		const endHostFrame = test.getRenderFrameIndex();
		const endVirtualMs = test.nowMs();
		const expectedStartToRoomFrames = endState.expected_title_last_head + endState.expected_title_wait_frames;
		const startElapsedHostFrames = endHostFrame - startHostFrame;
		const startElapsedVirtualMs = endVirtualMs - startVirtualMs;
		const waitElapsedHostFrames = waitHostFrame >= 0 ? (endHostFrame - waitHostFrame) : -1;
		const waitElapsedVirtualMs = waitVirtualMs >= 0 ? (endVirtualMs - waitVirtualMs) : -1;
		const startToRoomHostFrameRatio = startElapsedHostFrames / expectedStartToRoomFrames;
		const waitHostFrameRatio = waitElapsedHostFrames >= 0 ? (waitElapsedHostFrames / endState.expected_title_wait_frames) : -1;
		const targetStartToRoomMs = expectedStartToRoomFrames * endState.target_frame_ms;
		const targetWaitMs = endState.expected_title_wait_frames * endState.target_frame_ms;

		logger(
			`[probe] frameIntervalMs=${frameIntervalMs} startElapsedHostFrames=${startElapsedHostFrames} `
			+ `expectedStartToRoomFrames=${expectedStartToRoomFrames} startToRoomHostFrameRatio=${startToRoomHostFrameRatio.toFixed(3)} `
			+ `startElapsedVirtualMs=${startElapsedVirtualMs} targetStartToRoomMs=${targetStartToRoomMs.toFixed(1)}`
		);
		logger(
			`[probe] frameIntervalMs=${frameIntervalMs} waitElapsedHostFrames=${waitElapsedHostFrames} `
			+ `expectedWaitFrames=${endState.expected_title_wait_frames} waitHostFrameRatio=${waitHostFrameRatio.toFixed(3)} `
			+ `waitElapsedVirtualMs=${waitElapsedVirtualMs} targetWaitMs=${targetWaitMs.toFixed(1)}`
		);

		test.assert(startHostFrame >= 0, 'title timing probe never observed timeline start');
		test.assert(waitHostFrame >= 0, 'title timing probe never observed title_start_wait');
		test.assert(startElapsedHostFrames >= expectedStartToRoomFrames, `title probe elapsed host frames ${startElapsedHostFrames} shorter than expected minimum ${expectedStartToRoomFrames}`);
		test.assert(waitElapsedHostFrames >= endState.expected_title_wait_frames, `title probe wait host frames ${waitElapsedHostFrames} shorter than expected minimum ${endState.expected_title_wait_frames}`);
		test.finish(`[probe] title timing captured for frameIntervalMs=${frameIntervalMs}`);
	});
}
