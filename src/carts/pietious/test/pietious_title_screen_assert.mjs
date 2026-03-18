const POLL_MS = 5;
const TIMEOUT_MS = 45000;
const MAX_ENGINE_MS = 10000;
const CART_SETTLE_MS = 400;
const TITLE_IDLE_SETTLE_MS = 5200;

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

function fail(message) {
	throw new Error(`[assert] ${message}`);
}

function assert(condition, message) {
	if (!condition) {
		fail(message);
	}
}

function evalLua(engine, source) {
	return engine.evaluate_lua(source);
}

function getTitleState(engine) {
	const [state] = evalLua(engine, `
		local constants = require('constants')
		local castle = object('c')
		local room = object('room')
		local player = object('pietolon')
		local director = object('d')
		local transition = object('transition')
		local title = object('title_screen')
		local ui = object('ui')
		local director_state = 'other'
		if director.sc:matches_state_path('director:/title_screen') then
			director_state = 'title_screen'
		elseif director.sc:matches_state_path('director:/title_start_wait') then
			director_state = 'title_start_wait'
		elseif director.sc:matches_state_path('director:/room') then
			director_state = 'room'
		end
		local room_mode = 'other'
		if room.sc:matches_state_path('room:/mode_state/title') then
			room_mode = 'title'
		elseif room.sc:matches_state_path('room:/mode_state/room') then
			room_mode = 'room'
		end
		local title_state = 'other'
		if title.sc:matches_state_path('title_screen:/hidden') then
			title_state = 'hidden'
		elseif title.sc:matches_state_path('title_screen:/idle') then
			title_state = 'idle'
		elseif title.sc:matches_state_path('title_screen:/starting') then
			title_state = 'starting'
		end
		local ui_state = 'other'
		if ui.sc:matches_state_path('ui:/active') then
			ui_state = 'active'
		elseif ui.sc:matches_state_path('ui:/hidden') then
			ui_state = 'hidden'
		end
		local title_timeline = title:get_timeline('title_screen.start')
		local title_timeline_head = nil
		if title_timeline ~= nil then
			title_timeline_head = title_timeline.head
		end
		local sparkle_timeline = title:get_timeline('title_screen.sparkle')
		local sparkle_timeline_head = nil
		local sparkle_phase = 'off'
		if sparkle_timeline ~= nil then
			sparkle_timeline_head = sparkle_timeline.head
			local sparkle_frame = sparkle_timeline:value()
			if sparkle_frame ~= nil then
				sparkle_phase = sparkle_frame.phase
			end
		end
		local sparkle_sprite = title:get_component_by_local_id('spritecomponent', 'sparkle')
		return {
			has_castle = castle ~= nil,
			has_room = room ~= nil,
			has_player = player ~= nil,
			has_director = director ~= nil,
			has_transition = transition ~= nil,
			has_title = title ~= nil,
			has_ui = ui ~= nil,
			active_space = get_space(),
			director_state = director_state,
			director_boot_mode = director.boot_mode,
			room_mode = room_mode,
			title_state = title_state,
			ui_state = ui_state,
			hud_visible = ui.hud_visible,
			title_space = title.space_id,
			title_visible = title.visible,
			title_imgid = title.imgid,
			title_timeline_head = title_timeline_head,
			sparkle_timeline_head = sparkle_timeline_head,
			sparkle_phase = sparkle_phase,
			sparkle_visible = sparkle_sprite.enabled,
			sparkle_sprite_id = sparkle_sprite.imgid,
			sparkle_x = sparkle_sprite.offset.x,
			sparkle_y = sparkle_sprite.offset.y,
			room_number = castle.current_room_number,
			player_x = player.x,
			player_y = player.y,
			expected_title_last_head = (
				(constants.flow.title_start_blink_cycles * constants.flow.title_start_blink_phase_frames * 2)
				+ constants.flow.title_start_blink_phase_frames
				+ constants.flow.title_start_blink_tail_frames
			) - 1,
			expected_title_wait_frames = constants.flow.title_start_wait_frames,
			expected_first_blink_head = constants.flow.title_start_blink_phase_frames,
			expected_first_play_after_blink_head = constants.flow.title_start_blink_phase_frames * 2,
		}
	`);
	return {
		...state,
		current_music: engine.sndmaster.currentTrackByType('music'),
	};
}

export default function schedule({ logger, schedule: scheduleInput, frameIntervalMs }) {
	let cartActiveAt = 0;
	let titleReadyAt = 0;
	let startScheduled = false;
	let scenario = 'boot';
	let lastStateSummary = 'not-started';
	let startPressFrame = -1;
	let maxTitleHead = -1;
	let firstBlinkHead = -1;
	let firstPlayAfterBlinkHead = -1;
	let startWaitFrame = -1;
	let expectedTitleLastHead = -1;
	let expectedTitleWaitFrames = -1;
	let expectedFirstBlinkHead = -1;
	let expectedFirstPlayAfterBlinkHead = -1;
	let baselineRoomNumber = -1;
	let baselinePlayerX = 0;
	let baselinePlayerY = 0;
	let sparkleSeen = false;
	const sparkleFramesSeen = new Set();
	const sparklePhasesSeen = new Set();
	let sparkleMinX = Number.POSITIVE_INFINITY;
	let sparkleMaxX = Number.NEGATIVE_INFINITY;
	let maxSparkleTimelineHead = -1;

	const timeout = setTimeout(() => {
		fail(`timeout while waiting for scenario=${scenario} state=${lastStateSummary}`);
	}, TIMEOUT_MS);

	const poll = setInterval(() => {
		const engine = globalThis.$;
		if (!engine.initialized) {
			return;
		}
		if (!engine.is_cart_program_active()) {
			cartActiveAt = 0;
			return;
		}
		if (cartActiveAt === 0) {
			cartActiveAt = Date.now();
			logger('[assert] cart active, waiting for title boot');
			return;
		}
		if (Date.now() - cartActiveAt < CART_SETTLE_MS) {
			return;
		}

		const state = getTitleState(engine);
		const engineElapsedMs = Math.round((engine.view?.renderFrameIndex ?? 0) * frameIntervalMs);
		lastStateSummary = `space=${state.active_space} director=${state.director_state} roomMode=${state.room_mode} titleState=${state.title_state} titleSpace=${state.title_space} visible=${state.title_visible} imgid=${state.title_imgid} head=${state.title_timeline_head} sparklePhase=${state.sparkle_phase} sparkleVisible=${state.sparkle_visible} music=${state.current_music}`;
		if (engineElapsedMs > MAX_ENGINE_MS) {
			fail(`engine timeout at ${engineElapsedMs}ms while waiting for scenario=${scenario} state=${lastStateSummary}`);
		}

		assert(state.has_castle, 'title boot missing castle');
		assert(state.has_room, 'title boot missing room');
		assert(state.has_player, 'title boot missing player');
		assert(state.has_director, 'title boot missing director');
		assert(state.has_transition, 'title boot missing transition');
		assert(state.has_title, 'title boot missing title screen');
		assert(state.has_ui, 'title boot missing ui');

		if (scenario === 'boot') {
			if (titleReadyAt === 0) {
				logger(`[assert] title boot state space=${state.active_space} director=${state.director_state} bootMode=${state.director_boot_mode} roomMode=${state.room_mode} titleState=${state.title_state} visible=${state.title_visible} imgid=${state.title_imgid} music=${state.current_music}`);
			}
			assert(state.active_space === 'transition', `title boot active_space=${state.active_space}`);
			assert(state.director_state === 'title_screen', `title boot director=${state.director_state}`);
			assert(state.title_visible === true, `title boot visible=${state.title_visible}`);
			assert(state.title_imgid === 'title_screen', `title idle imgid=${state.title_imgid}`);
			assert(state.current_music === null, `title boot music leaked current=${state.current_music}`);
			if (titleReadyAt === 0) {
				titleReadyAt = Date.now();
				baselineRoomNumber = state.room_number;
				baselinePlayerX = state.player_x;
				baselinePlayerY = state.player_y;
				expectedTitleLastHead = state.expected_title_last_head;
				expectedTitleWaitFrames = state.expected_title_wait_frames;
				expectedFirstBlinkHead = state.expected_first_blink_head;
				expectedFirstPlayAfterBlinkHead = state.expected_first_play_after_blink_head;
				logger('[assert] title idle boot ok');
				return;
			}
			assert(state.room_number === baselineRoomNumber, `title idle room changed room=${state.room_number} baseline=${baselineRoomNumber}`);
			assert(state.player_x === baselinePlayerX, `title idle player.x changed x=${state.player_x} baseline=${baselinePlayerX}`);
			assert(state.player_y === baselinePlayerY, `title idle player.y changed y=${state.player_y} baseline=${baselinePlayerY}`);
			assert(state.current_music === null, `title idle music leaked current=${state.current_music}`);
			sparklePhasesSeen.add(state.sparkle_phase);
			if (state.sparkle_timeline_head !== null && state.sparkle_timeline_head !== undefined && state.sparkle_timeline_head > maxSparkleTimelineHead) {
				maxSparkleTimelineHead = state.sparkle_timeline_head;
			}
			if (state.sparkle_phase === 'delay' || state.sparkle_phase === 'tail') {
				assert(state.sparkle_visible === false, `title sparkle visible leak phase=${state.sparkle_phase} visible=${state.sparkle_visible}`);
			}
			if (state.sparkle_visible) {
				sparkleSeen = true;
				if (/^tsf[4-7]$/.test(state.sparkle_sprite_id) || state.sparkle_sprite_id === 'tsf_pair' || state.sparkle_sprite_id === 'tsf_burst_single') {
					sparkleFramesSeen.add(state.sparkle_sprite_id);
				}
				if (state.sparkle_phase === 'sweep') {
					sparkleMinX = Math.min(sparkleMinX, state.sparkle_x);
					sparkleMaxX = Math.max(sparkleMaxX, state.sparkle_x);
				}
				if (state.sparkle_phase === 'burst_single' || state.sparkle_phase === 'burst_return') {
					assert(state.sparkle_sprite_id === 'tsf_burst_single', `title sparkle burst sprite=${state.sparkle_sprite_id}`);
				}
				if (state.sparkle_phase === 'burst_pair') {
					assert(state.sparkle_sprite_id === 'tsf_pair', `title sparkle burstPair sprite=${state.sparkle_sprite_id}`);
				}
			}
			const sparkleReady = (
				sparkleSeen === true
				&& sparklePhasesSeen.has('sweep')
				&& sparklePhasesSeen.has('burst_single')
				&& sparklePhasesSeen.has('burst_pair')
				&& maxSparkleTimelineHead >= 124
				&& sparkleFramesSeen.has('tsf4')
				&& sparkleFramesSeen.has('tsf5')
				&& sparkleFramesSeen.has('tsf6')
				&& sparkleFramesSeen.has('tsf7')
				&& sparkleFramesSeen.has('tsf_burst_single')
				&& sparkleFramesSeen.has('tsf_pair')
				&& sparkleMaxX > sparkleMinX
			);
			if (!sparkleReady && Date.now() - titleReadyAt < TITLE_IDLE_SETTLE_MS) {
				return;
			}
			assert(sparkleSeen === true, 'title sparkle never became visible');
			assert(sparklePhasesSeen.has('sweep'), `title sparkle never entered sweep phase phases=${Array.from(sparklePhasesSeen).join(',')}`);
			assert(sparklePhasesSeen.has('burst_single'), `title sparkle never entered burst_single phase phases=${Array.from(sparklePhasesSeen).join(',')}`);
			assert(sparklePhasesSeen.has('burst_pair'), `title sparkle never entered burst_pair phase phases=${Array.from(sparklePhasesSeen).join(',')}`);
			assert(maxSparkleTimelineHead >= 124, `title sparkle never advanced into burst_return range maxHead=${maxSparkleTimelineHead}`);
			assert(sparkleFramesSeen.has('tsf4'), `title sparkle missed tsf4 frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleFramesSeen.has('tsf5'), `title sparkle missed tsf5 frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleFramesSeen.has('tsf6'), `title sparkle missed tsf6 frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleFramesSeen.has('tsf7'), `title sparkle missed tsf7 frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleFramesSeen.has('tsf_burst_single'), `title sparkle missed tsf_burst_single frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleFramesSeen.has('tsf_pair'), `title sparkle missed tsf_pair frames=${Array.from(sparkleFramesSeen).join(',')}`);
			assert(sparkleMaxX > sparkleMinX, `title sparkle did not move sparkleMinX=${sparkleMinX} sparkleMaxX=${sparkleMaxX}`);
			if (!startScheduled) {
				const scheduledAtMs = Math.round(engine.platform.clock.now());
				scheduleInput([
					{ description: 'title_start_enter_press', delayMs: 40, event: buttonEvent('Enter', true, 1, scheduledAtMs + 40) },
					{ description: 'title_start_space_press', delayMs: 40, event: buttonEvent('Space', true, 2, scheduledAtMs + 40) },
					{ description: 'title_start_enter_release', delayMs: 200, event: buttonEvent('Enter', false, 1, scheduledAtMs + 200) },
					{ description: 'title_start_space_release', delayMs: 200, event: buttonEvent('Space', false, 2, scheduledAtMs + 200) },
				]);
				startScheduled = true;
				scenario = 'starting';
				logger('[assert] title start scheduled');
			}
			return;
		}

		if (scenario === 'starting') {
			assert(state.active_space === 'transition' || state.active_space === 'main', `title start active_space=${state.active_space}`);
			if (state.director_state === 'title_screen') {
				assert(state.title_visible === true, `title start invisible titleState=${state.title_state} imgid=${state.title_imgid}`);
				assert(state.current_music === null, `title start music leaked current=${state.current_music}`);
				if (state.title_timeline_head === null || state.title_timeline_head === undefined) {
					assert(state.title_imgid === 'title_screen', `title start idle titleState=${state.title_state} imgid=${state.title_imgid}`);
					return;
				}
				assert(state.title_imgid === 'title_screen_play_start' || state.title_imgid === 'title_screen_play_start_blink', `title start unexpected titleState=${state.title_state} imgid=${state.title_imgid}`);
				if (startPressFrame < 0 && state.title_timeline_head >= 0) {
					startPressFrame = engine.view?.renderFrameIndex ?? 0;
				}
				if (state.title_timeline_head > maxTitleHead) {
					maxTitleHead = state.title_timeline_head;
				}
				if (state.title_imgid === 'title_screen_play_start_blink' && firstBlinkHead < 0) {
					firstBlinkHead = state.title_timeline_head;
				}
				if (firstBlinkHead >= 0 && state.title_imgid === 'title_screen_play_start' && state.title_timeline_head > firstBlinkHead && firstPlayAfterBlinkHead < 0) {
					firstPlayAfterBlinkHead = state.title_timeline_head;
				}
				return;
			}
			if (state.director_state === 'title_start_wait') {
				if (startWaitFrame < 0) {
					startWaitFrame = engine.view?.renderFrameIndex ?? 0;
				}
				assert(state.active_space === 'main', `title wait active_space=${state.active_space}`);
				assert(state.title_state === 'hidden', `title wait title_state=${state.title_state}`);
				assert(state.title_space === 'ui', `title wait title_space=${state.title_space}`);
				assert(state.ui_state === 'hidden', `title wait ui_state=${state.ui_state}`);
				assert(state.hud_visible === false, `title wait hud_visible=${state.hud_visible}`);
				return;
			}

			assert(state.director_state === 'room', `title start ended in director=${state.director_state}`);
			assert(state.active_space === 'main', `title start ended in active_space=${state.active_space}`);
			assert(state.title_state === 'hidden', `title start left title_state=${state.title_state}`);
			assert(state.title_space === 'ui', `title start left title_space=${state.title_space}`);
			assert(startWaitFrame >= 0, 'title start never entered title_start_wait');
			assert(state.ui_state === 'active', `title start ended in ui_state=${state.ui_state}`);
			assert(state.hud_visible === true, `title start ended in hud_visible=${state.hud_visible}`);
			if (state.current_music !== 'music_castle') {
				return;
			}
			assert(maxTitleHead === expectedTitleLastHead, `title start max_head=${maxTitleHead} expected=${expectedTitleLastHead}`);
			assert(firstBlinkHead >= expectedFirstBlinkHead, `title start blink began too early head=${firstBlinkHead} expectedAtLeast=${expectedFirstBlinkHead}`);
			assert(firstPlayAfterBlinkHead >= expectedFirstPlayAfterBlinkHead, `title start play frame returned too early head=${firstPlayAfterBlinkHead} expectedAtLeast=${expectedFirstPlayAfterBlinkHead}`);
			assert(startPressFrame >= 0, 'title start never began timeline playback');
			const roomFrame = engine.view?.renderFrameIndex ?? 0;
			const titleWaitFrames = roomFrame - startWaitFrame;
			assert(titleWaitFrames >= expectedTitleWaitFrames, `title wait finished too early elapsedFrames=${titleWaitFrames} expectedAtLeast=${expectedTitleWaitFrames}`);
			const endFrame = engine.view?.renderFrameIndex ?? 0;
			const elapsedFrames = endFrame - startPressFrame;
			assert(elapsedFrames >= expectedTitleLastHead, `title start finished too early elapsedFrames=${elapsedFrames} expectedAtLeast=${expectedTitleLastHead}`);
			clearInterval(poll);
			clearTimeout(timeout);
			logger('[assert] title screen timing ok');
		}
	}, POLL_MS);
}
