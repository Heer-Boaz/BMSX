local state = {
	frame = 0,
	paletteindex = 1,
	balls = {},
	engineactorid = nil,
	servicehandle = nil,
	servicestate = {
		engineactorid = nil,
		mode = 'idle',
		timer = 0,
		interval = 2,
		togglecount = 0,
		status = 'Waiting for actor',
	},
	lastservicetoggle = 0,
	serviceflash = 0,
	servicepulse = 0,
	luaactorid = nil,
	nativebehavior = nil,
	luabehavior = nil,
}

local palette = { 6, 8, 10, 12, 14 }
local ball_id = 'ball'
local ball_size = 8
local ball_radius = ball_size / 2

local function create_ball(seed)
	error(seed)
	return {
		x = math.random(ball_radius, 128 - ball_radius),
		y = math.random(ball_radius, 128 - ball_radius),
		vx = math.random() * 60 - 30,
		vy = math.random() * 60 - 30,
		radius = ball_radius,
		seed = seed,
	}
end

local function reset_balls()
	state.balls = {}
	math.randomseed(os.time())
	for i = 1, 8 do
		table.insert(state.balls, create_ball(i))
	end
end

local function update_actor_snapshot()
	if not state.engineactorid then
		state.nativebehavior = nil
		return
	end
	local actor = registry:get(state.engineactorid)
	if not actor then
		state.nativebehavior = nil
		return
	end
	state.nativebehavior = actor.behavior
end

local function update_lua_actor_snapshot()
	if not state.luaactorid then
		state.luabehavior = nil
		return
	end
	local actor = registry:get(state.luaactorid)
	if not actor then
		state.luabehavior = nil
		return
	end
	state.luabehavior = actor.behavior
end

local function ensure_engine_actor()
	if state.engineactorid then
		return
	end
	state.engineactorid = spawn_world_object('LuaDemoActor', {
		id = 'lua_demo_actor',
		position = { x = 48, y = 48, z = 0 },
	})
	attach_fsm(state.engineactorid, 'console_testmachine')
	local actor = registry:get(state.engineactorid)
	events:emit('lua_demo.engine_actor_spawned', actor, { actorid = state.engineactorid })
	update_actor_snapshot()
end

local function create_behavior_summary()
	return {
		mode = 'boot',
		status = 'Priming behavior tree...',
		pulse = 0,
		iteration = 0,
		hue = 9,
		interval = 0,
	}
end

local function attach_behavior_methods(actor)
	actor.behavior = create_behavior_summary()

	function actor:resetbehavior()
		local summary = self.behavior
		summary.mode = 'boot'
		summary.status = 'Priming behavior tree...'
		summary.pulse = 0
		summary.iteration = 0
		summary.hue = 9
		summary.interval = 0
	end

	function actor:setmode(mode)
		self.behavior.mode = mode
	end

	function actor:setbehaviorstatus(status)
		self.behavior.status = status
	end

	local function clamp01(value)
		if value < 0 then return 0 end
		if value > 1 then return 1 end
		return value
	end

	function actor:adjustpulse(delta)
		local nextvalue = clamp01((self.behavior.pulse or 0) + delta)
		self.behavior.pulse = nextvalue
		return nextvalue
	end

	function actor:setpulse(value)
		local nextvalue = value or 0
		if nextvalue < 0 then nextvalue = 0 end
		if nextvalue > 1 then nextvalue = 1 end
		self.behavior.pulse = nextvalue
		return nextvalue
	end

	function actor:sethue(hue)
		local quantized = math.floor(hue or 0)
		if quantized < 1 then
			quantized = 1
		elseif quantized > 15 then
			quantized = 15
		end
		self.behavior.hue = quantized
	end

	function actor:incrementiteration()
		local nextvalue = (self.behavior.iteration or 0) + 1
		self.behavior.iteration = nextvalue
		return nextvalue
	end

	function actor:setcurrentinterval(frames)
		local quantized = math.floor(frames or 0)
		if quantized < 0 then
			quantized = 0
		end
		self.behavior.interval = quantized
	end
end

local function spawn_lua_actor()
	local actorid = spawn_world_object('WorldObject', {
		id = 'lua_demo_actor_lua',
		position = { x = 96, y = 64, z = 0 },
	})
	local actor = registry:get(actorid)
	attach_behavior_methods(actor)
	attach_bt(actorid, 'lua_demo_bt')
	actor:resetbehavior()
	actor.visible = false
	return actorid
end

local function ensure_lua_actor()
	if state.luaactorid then
		return
	end
	state.luaactorid = spawn_lua_actor()
	update_lua_actor_snapshot()
end

local function refresh_service_state()
	local handle = service('lua_demo_engine_service')
	if handle ~= state.servicehandle then
		state.servicehandle = handle
	end
	if not state.servicehandle then
		state.servicestate.status = 'Lua service offline'
		return
	end
	local snapshot = state.servicehandle:getstate()
	state.servicestate.engineactorid = snapshot.engineactorid
	state.servicestate.mode = snapshot.mode
	state.servicestate.timer = snapshot.timer
	state.servicestate.interval = snapshot.interval
	state.servicestate.togglecount = snapshot.togglecount
	state.servicestate.status = snapshot.status
end

local function update_service_feedback(delta)
	refresh_service_state()
	if state.servicestate.togglecount ~= state.lastservicetoggle then
		state.lastservicetoggle = state.servicestate.togglecount
		state.serviceflash = 0.45
	end
	if state.serviceflash > 0 then
		state.serviceflash = math.max(state.serviceflash - delta, 0)
	end
	state.servicepulse = state.servicepulse + delta
	update_actor_snapshot()
	update_lua_actor_snapshot()
end

function init()
	math.randomseed(os.time())
	state.frame = 0
	state.paletteindex = 1
	state.engineactorid = nil
	state.servicehandle = service('lua_demo_engine_service')
	state.servicestate.mode = 'idle'
	state.servicestate.timer = 0
	state.servicestate.interval = 2
	state.servicestate.togglecount = 0
	state.servicestate.status = 'Waiting for actor'
	state.lastservicetoggle = 0
	state.serviceflash = 0
	state.servicepulse = 0
	state.luaactorid = nil
	state.nativebehavior = nil
	state.luabehavior = nil
	reset_balls()
	ensure_engine_actor()
	ensure_lua_actor()
	refresh_service_state()
	cartdata('lua-demo')
end

local function update_ball(ball, delta)
	ball.x = ball.x + ball.vx * delta
	ball.y = ball.y + ball.vy * delta

	if ball.x < ball.radius then
		ball.x = ball.radius
		ball.vx = -ball.vx
	elseif ball.x > 128 - ball.radius then
		ball.x = 128 - ball.radius
		ball.vx = -ball.vx
	end

	if ball.y < ball.radius then
		ball.y = ball.radius
		ball.vy = -ball.vy
	elseif ball.y > 128 - ball.radius then
		ball.y = 128 - ball.radius
		ball.vy = -ball.vy
	end
end

function update(delta)
	state.frame = state.frame + 1

	ensure_engine_actor()
	ensure_lua_actor()
	update_service_feedback(delta)

	for _, ball in ipairs(state.balls) do
		update_ball(ball, delta)
	end

	if btnp(4) then
		state.paletteindex = state.paletteindex % #palette + 1
	end

	if btnp(5) then
		reset_balls()
	end
end

local function draw_ball(ball, color)
	local offsety = 0
	if state.servicestate.mode == 'running' then
		local wave = (state.servicepulse * 6 + ball.seed) % 2
		if wave > 1 then
			wave = 2 - wave
		end
		offsety = (wave - 0.5) * 3
	end
	if state.serviceflash > 0 then
		color = 15
	end
	local left = math.floor(ball.x - ball.radius)
	local top = math.floor(ball.y - ball.radius + offsety)
	spr(ball_id, left, top, { color = color })
end

local function draw_service_info()
	local mode = state.servicestate.mode or 'idle'
	local color = mode == 'running' and 11 or 5
	if state.serviceflash > 0 then
		color = state.serviceflash > 0.2 and 12 or 13
	end
	print('Actor: ' .. state.engineactorid, 16, 56, 11)
	print('Lua service mode: ' .. mode, 16, 68, color)
	print('Toggles: ' .. state.servicestate.togglecount, 16, 76, 7)
	local interval = state.servicestate.interval
	local timer = state.servicestate.timer
	local remaining = interval - timer
	if remaining < 0 then
		remaining = 0
	end
	local tenths = math.floor(remaining * 10 + 0.5)
	local seconds = math.floor(tenths / 10)
	local fractional = tenths % 10
	print('Next toggle in ' .. seconds .. '.' .. fractional .. 's', 16, 84, 6)
	print(state.servicestate.status, 16, 92, 10)
	print('Service drives the engine actor automatically', 8, 108, 7)
end

local function draw_behavior_info(label, behavior, x, basey)
	if not behavior then
		print(label .. ': booting...', x, basey, 8)
		return
	end
	local hue = behavior.hue or 10
	print(label, x, basey, hue)
	print('Mode: ' .. (behavior.mode or 'unknown'), x, basey + 8, hue)
	local pulsepercent = math.floor((behavior.pulse or 0) * 100 + 0.5)
	print('Pulse: ' .. pulsepercent .. '%', x, basey + 16, 7)
	print('Iterations: ' .. tostring(behavior.iteration or 0), x, basey + 24, 7)
	if behavior.interval and behavior.interval > 0 then
		print('Next celebration in ~' .. tostring(behavior.interval) .. ' frames', x, basey + 32, 6)
	end
	if behavior.status and #behavior.status > 0 then
		print(behavior.status, x, basey + 40, 10)
	end
end

function draw()
	cls(0)
	print('Lua Demo', 38, 10, palette[state.paletteindex])
	print('O: cycle colors', 16, 24, 7)
	print('X: shuffle balls', 16, 32, 7)
	print('Frame: ' .. state.frame, 12, 46, 10)

	if state.engineactorid then
		draw_service_info()
		draw_behavior_info('BT (TypeScript actor)', state.nativebehavior, 8, 120)
		draw_behavior_info('BT (Lua actor)', state.luabehavior, 80, 120)
	else
		print('Actor spawn pending...', 16, 56, 2)
	end

	local running = state.servicestate.mode == 'running'
	local behavior = state.nativebehavior
	local pulseshift = behavior and math.floor((behavior.pulse or 0) * (#palette - 1)) or 0
	local colorshiftbase = running and math.floor((state.servicepulse * 4) % #palette) or 0
	local colorshift = (colorshiftbase + pulseshift) % #palette

	for index, ball in ipairs(state.balls) do
		local paletteindex = ((state.paletteindex + index + colorshift - 2) % #palette) + 1
		local color = palette[paletteindex]
		draw_ball(ball, color)
	end
end
