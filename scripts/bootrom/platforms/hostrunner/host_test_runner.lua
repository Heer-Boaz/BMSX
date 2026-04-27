__bmsx_host_runner = {
	phase = 'cart',
	tick_timestamp_ms = 0,
	cart_settle_frames = 0,
	gameplay_settle_frames = 0,
	update_frames = 0,
	active_keys = {},
	scheduled_commands = {},
	finished = false,
}

local cart_settle_frames<const> = 5
local gameplay_settle_frames<const> = 50

local bridge<const> = __bmsx_host_bridge
local runner<const> = __bmsx_host_runner

local function input_timestamp()
	return runner.tick_timestamp_ms
end

local function schedule_command(frame, command)
	local due_frame<const> = runner.update_frames + frame
	local commands = runner.scheduled_commands[due_frame]
	if commands == nil then
		commands = {}
		runner.scheduled_commands[due_frame] = commands
	end
	commands[#commands + 1] = command
end

local function post_key(code, down)
	bridge.post_key(code, down, input_timestamp())
end

local function button_down(code)
	if runner.active_keys[code] then
		error('host test button "' .. code .. '" is already down.')
	end
	runner.active_keys[code] = true
	post_key(code, true)
end

local function button_up(code)
	if not runner.active_keys[code] then
		error('host test button "' .. code .. '" was released before it was pressed.')
	end
	runner.active_keys[code] = nil
	post_key(code, false)
end

local function press_button(code, frames)
	button_down(code)
	schedule_command(frames < 1 and 1 or frames, { up = code })
end

local function apply_command(command)
	if command.log ~= nil then
		bridge.log(command.log)
	end
	if command.capture == true then
		bridge.capture('test:capture')
	elseif command.capture ~= nil then
		bridge.capture('test:' .. tostring(command.capture))
	end
	if command.down ~= nil then
		button_down(command.down)
	end
	if command.up ~= nil then
		button_up(command.up)
	end
	if command.press ~= nil then
		press_button(command.press, command.hold_frames or 1)
	end
end

local function apply_commands(commands)
	if commands == nil or commands == true or commands == false then
		return
	end
	if type(commands) == 'string' then
		bridge.log(commands)
		return
	end
	if commands.press ~= nil or commands.down ~= nil or commands.up ~= nil or commands.capture ~= nil or commands.log ~= nil then
		if commands.frame ~= nil and commands.frame > 0 then
			schedule_command(commands.frame, commands)
		else
			apply_command(commands)
		end
		return
	end
	for i = 1, #commands do
		apply_commands(commands[i])
	end
end

local function apply_scheduled_commands()
	local commands = runner.scheduled_commands[runner.update_frames]
	if commands == nil then
		return
	end
	runner.scheduled_commands[runner.update_frames] = nil
	for i = 1, #commands do
		apply_command(commands[i])
	end
end

local function result_done(result)
	return result == true or (type(result) == 'table' and result.done == true)
end

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

function runner.install()
	runner.phase = 'cart'
	runner.tick_timestamp_ms = 0
	runner.cart_settle_frames = 0
	runner.gameplay_settle_frames = 0
	runner.update_frames = 0
	runner.active_keys = {}
	runner.scheduled_commands = {}
	runner.finished = false
	bridge.log('loaded')
end

function runner.tick(timestamp_ms)
	runner.tick_timestamp_ms = timestamp_ms
	if runner.finished then
		return true
	end
	if runner.phase == 'cart' then
		runner.cart_settle_frames = runner.cart_settle_frames + 1
		if runner.cart_settle_frames < cart_settle_frames then
			return false
		end
		bridge.log('cart active, requesting new_game')
		bridge.request_new_game()
		runner.phase = 'ready'
		return false
	end
	if runner.phase == 'ready' then
		if __bmsx_host_test.ready() ~= true then
			runner.gameplay_settle_frames = 0
			return false
		end
		runner.gameplay_settle_frames = runner.gameplay_settle_frames + 1
		if runner.gameplay_settle_frames < gameplay_settle_frames then
			return false
		end
		bridge.log('gameplay ready')
		runner.phase = 'setup'
		return false
	end
	if runner.phase == 'setup' then
		apply_commands(__bmsx_host_test.setup())
		runner.phase = 'update'
		return false
	end

	runner.update_frames = runner.update_frames + 1
	apply_scheduled_commands()
	local result<const> = __bmsx_host_test.update(runner.update_frames)
	apply_commands(result)
	if result_done(result) then
		runner.finished = true
		bridge.pass()
		return true
	end
	return false
end
