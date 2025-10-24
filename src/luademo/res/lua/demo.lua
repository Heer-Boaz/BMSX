local state = {
	frame = 0,
	paletteIndex = 1,
	balls = {},
	engineActorId = nil,
	serviceHandle = nil,
	serviceState = {
		engineActorId = nil,
		mode = 'idle',
		timer = 0,
		interval = 2,
		toggleCount = 0,
		status = 'Waiting for actor',
	},
	lastServiceToggle = 0,
	serviceFlash = 0,
	servicePulse = 0,
}

local palette = { 6, 8, 10, 12, 14 }
local BALL_ID = 'ball'
local BALL_SIZE = 8
local BALL_RADIUS = BALL_SIZE / 2

local function create_ball(seed)
	return {
		x = math.random(BALL_RADIUS, 128 - BALL_RADIUS),
		y = math.random(BALL_RADIUS, 128 - BALL_RADIUS),
		vx = math.random() * 60 - 30,
		vy = math.random() * 60 - 30,
		radius = BALL_RADIUS,
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

local function ensure_engine_actor()
	if state.engineActorId then
		return
	end
	state.engineActorId = spawnWorldObject('WorldObject', {
		id = 'lua_demo_actor',
		position = { x = 48, y = 48, z = 0 },
	})
	attachFsm(state.engineActorId, 'console_testmachine')
	local actor = registry:get(state.engineActorId)
	events:emit('lua_demo.engine_actor_spawned', actor, { actorId = state.engineActorId })
end

local function refresh_service_state()
	local handle = service('lua_demo_engine_service')
	if handle ~= state.serviceHandle then
		state.serviceHandle = handle
	end
	if not state.serviceHandle then
		state.serviceState.status = 'Lua service offline'
		return
	end
	local snapshot = state.serviceHandle:getState()
	state.serviceState.engineActorId = snapshot.engineActorId
	state.serviceState.mode = snapshot.mode
	state.serviceState.timer = snapshot.timer
	state.serviceState.interval = snapshot.interval
	state.serviceState.toggleCount = snapshot.toggleCount
	state.serviceState.status = snapshot.status
end

local function update_service_feedback(delta)
	refresh_service_state()
	if state.serviceState.toggleCount ~= state.lastServiceToggle then
		state.lastServiceToggle = state.serviceState.toggleCount
		state.serviceFlash = 0.45
	end
	if state.serviceFlash > 0 then
		state.serviceFlash = math.max(state.serviceFlash - delta, 0)
	end
	state.servicePulse = state.servicePulse + delta
end

function init()
	math.randomseed(os.time())
	state.frame = 0
	state.paletteIndex = 1
	state.engineActorId = nil
	state.serviceHandle = service('lua_demo_engine_service')
	state.serviceState.mode = 'idle'
	state.serviceState.timer = 0
	state.serviceState.interval = 2
	state.serviceState.toggleCount = 0
	state.serviceState.status = 'Waiting for actor'
	state.lastServiceToggle = 0
	state.serviceFlash = 0
	state.servicePulse = 0
	reset_balls()
	ensure_engine_actor()
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
	update_service_feedback(delta)

	for _, ball in ipairs(state.balls) do
		update_ball(ball, delta)
	end

	if btnp(4) then
		state.paletteIndex = state.paletteIndex % #palette + 1
	end

	if btnp(5) then
		reset_balls()
	end
end

local function draw_ball(ball, color)
	local offsetY = 0
	if state.serviceState.mode == 'running' then
		local wave = (state.servicePulse * 6 + ball.seed) % 2
		if wave > 1 then
			wave = 2 - wave
		end
		offsetY = (wave - 0.5) * 3
	end
	if state.serviceFlash > 0 then
		color = 15
	end
	local left = math.floor(ball.x - ball.radius)
	local top = math.floor(ball.y - ball.radius + offsetY)
	spr(BALL_ID, left, top, { color = color })
end

local function draw_service_info()
	local mode = state.serviceState.mode or 'idle'
	local color = mode == 'running' and 11 or 5
	if state.serviceFlash > 0 then
		color = state.serviceFlash > 0.2 and 12 or 13
	end
	print('Actor: ' .. state.engineActorId, 16, 56, 11)
	print('Lua service mode: ' .. mode, 16, 68, color)
	print('Toggles: ' .. state.serviceState.toggleCount, 16, 76, 7)
	local interval = state.serviceState.interval
	local timer = state.serviceState.timer
	local remaining = interval - timer
	if remaining < 0 then
		remaining = 0
	end
	local tenths = math.floor(remaining * 10 + 0.5)
	local seconds = math.floor(tenths / 10)
	local fractional = tenths % 10
	print('Next toggle in ' .. seconds .. '.' .. fractional .. 's', 16, 84, 6)
	print(state.serviceState.status, 16, 92, 10)
	print('Service drives the engine actor automatically', 8, 108, 7)
end

function draw()
	cls(0)
	print('Lua Demo', 38, 10, palette[state.paletteIndex])
	print('O: cycle colors', 16, 24, 7)
	print('X: shuffle balls', 16, 32, 7)
	print('Frame: ' .. state.frame, 12, 46, 10)

	if state.engineActorId then
		draw_service_info()
	else
		print('Actor spawn pending...', 16, 56, 2)
	end

	local running = state.serviceState.mode == 'running'
	local colorShift = running and math.floor((state.servicePulse * 4) % #palette) or 0

	for index, ball in ipairs(state.balls) do
		local paletteIndex = ((state.paletteIndex + index + colorShift - 2) % #palette) + 1
		local color = palette[paletteIndex]
		draw_ball(ball, color)
	end
end
