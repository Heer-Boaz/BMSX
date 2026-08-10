host = {
	press = function(code, frames)
		return { press = code, hold_frames = frames or 1 }
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
}
