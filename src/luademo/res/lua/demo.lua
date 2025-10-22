local state = {
	frame = 0,
	paletteIndex = 1,
	balls = {},
	engineActorId = nil,
	fsmTimer = 0,
	fsmState = 'idle',
	engineMessage = nil,
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
	if state.engineActorId ~= nil then
		return
	end
	state.engineMessage = nil
	local spawnFunction = nil
	if type(spawnWorldObject) == 'function' then
		spawnFunction = spawnWorldObject
	elseif type(api) == 'table' and type(api.spawnWorldObject) == 'function' then
		spawnFunction = api.spawnWorldObject
	end
	if spawnFunction == nil then
		state.engineMessage = 'spawnWorldObject unavailable'
		return
	end
	local actorId = spawnFunction('WorldObject', {
		id = 'lua_demo_actor',
		position = { x = 48, y = 48, z = 0 },
	})
	state.engineActorId = actorId
	state.fsmState = 'idle'
	state.fsmTimer = 0
	local attachFunction = nil
	if type(attachFsm) == 'function' then
		attachFunction = attachFsm
	elseif type(api) == 'table' and type(api.attachFsm) == 'function' then
		attachFunction = api.attachFsm
	end
	if attachFunction == nil then
		state.engineMessage = 'attachFsm unavailable'
		return
	end
	attachFunction(state.engineActorId, 'console_testmachine')
end

function init()
	math.randomseed(os.time())
	state.frame = 0
	state.paletteIndex = 1
	reset_balls()
	ensure_engine_actor()
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

	if state.engineActorId == nil then
		ensure_engine_actor()
	end

	for _, ball in ipairs(state.balls) do
		update_ball(ball, delta)
	end

	if state.engineActorId ~= nil then
		state.fsmTimer = state.fsmTimer + delta
		if state.fsmTimer >= 2 then
			state.fsmTimer = 0
			if state.fsmState == 'idle' then
				emit('start', nil, state.engineActorId)
				state.fsmState = 'running'
			else
				emit('stop', nil, state.engineActorId)
				state.fsmState = 'idle'
			end
		end
	end

	if btnp(4) then
		state.paletteIndex = state.paletteIndex % #palette + 1
	end

	if btnp(5) then
		reset_balls()
	end
end

local function draw_ball(ball, color)
	local left = math.floor(ball.x - ball.radius)
	local top = math.floor(ball.y - ball.radius)
	spr(BALL_ID, left, top, { color = color })
	-- rect(left, top, left + BALL_SIZE, top + BALL_SIZE, color)
end

function draw()
	cls(0)
	print('Lua Demo', 38, 10, palette[state.paletteIndex])
	print('O: cycle colors', 16, 24, 7)
	print('X: shuffle balls', 16, 32, 7)
	print('Frame: ' .. state.frame, 12, 46, 10)
	if state.engineActorId ~= nil then
		print('Actor: ' .. state.engineActorId, 16, 56, 11)
		print('FSM state: ' .. state.fsmState, 16, 64, 11)
	else
		print('Actor spawn failed', 16, 56, 2)
	end
	if state.engineMessage ~= nil then
		print('Engine: ' .. state.engineMessage, 16, 72, 2)
	end

	for index, ball in ipairs(state.balls) do
		local color = palette[((state.paletteIndex + index - 2) % #palette) + 1]
		draw_ball(ball, color)
	end
end
