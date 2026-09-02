export const SCENARIO_TEST_LOADER_GLOBAL = '__bmsx_host_test_loader';

export const SCENARIO_GUEST_API_SOURCE = `host = {
	press = function(code, frames)
		return { press = code, hold_frames = frames or 1 }
	end,
	gamepad_press = function(player_index, code, frames)
		return { gamepad = player_index, press = code, hold_frames = frames or 1 }
	end,
	down = function(code)
		return { down = code }
	end,
	up = function(code)
		return { up = code }
	end,
	at = function(frame, command)
		command.frame = frame
		return command
	end,
	capture = function(label)
		return { capture = label or true }
	end,
	log = function(message)
		return { log = message }
	end,
}`;
