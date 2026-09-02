export const SCENARIO_TEST_LOADER_GLOBAL = '__bmsx_host_test_loader';
export const SCENARIO_GUEST_OBSERVE_FSM_TRANSITIONS_KEY = 'observe_fsm_transitions';

export const SCENARIO_GUEST_API_SOURCE = `host = {
	press = function(code, ticks)
		return { press = code, hold_ticks = ticks or 1 }
	end,
	gamepad_press = function(player_index, code, ticks)
		return { gamepad = player_index, press = code, hold_ticks = ticks or 1 }
	end,
	down = function(code)
		return { down = code }
	end,
	up = function(code)
		return { up = code }
	end,
	at = function(tick, command)
		command.tick = tick
		return command
	end,
	capture = function(label)
		return { capture = label or true }
	end,
	log = function(message)
		return { log = message }
	end,
	${SCENARIO_GUEST_OBSERVE_FSM_TRANSITIONS_KEY} = function(recorder)
		return { ${SCENARIO_GUEST_OBSERVE_FSM_TRANSITIONS_KEY} = recorder }
	end,
}`;
