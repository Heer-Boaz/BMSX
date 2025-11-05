state = {
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
		togglecount = 0, -- asd
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
local sprite_colors = {
	[6] = { r = 250 / 255, g = 80 / 255, b = 51 / 255, a = 1 },
	[8] = { r = 255 / 255, g = 81 / 255, b = 52 / 255, a = 1 },
	[10] = { r = 226 / 255, g = 210 / 255, b = 4 / 255, a = 1 },
	[12] = { r = 4 / 255, g = 212 / 255, b = 19 / 255, a = 1 },
	[14] = { r = 208 / 255, g = 208 / 255, b = 208 / 255, a = 1 },
	[15] = { r = 1, g = 1, b = 1, a = 1 },
}
local ball_id = 'ball'
local ball_size = 8
local ball_radius = ball_size / 2

local function create_ball(seed)
	local object_id = 'lua_demo_ball_' .. tostring(seed)
	return {
		x = math.random(ball_radius, 128 - ball_radius),
		y = math.random(ball_radius, 128 - ball_radius),
		vx = math.random() * 60 - 30,
		vy = math.random() * 60 - 30,
		radius = ball_radius,
		seed = seed,
		object_id = object_id,
	}
end

local function ensure_ball_sprite(ball)
	local object = registry:get(ball.object_id)
	if not object then
		spawn_world_object('WorldObject', {
			id = ball.object_id,
			position = { x = ball.x, y = ball.y, z = 0 },
			components = {
				{
					class = 'SpriteComponent',
					id_local = 'ball_sprite',
					layer = 'ui',
					imgid = ball_id,
				},
			},
		})
		object = registry:get(ball.object_id)
	end
	if not object then
		return
	end
	local sprite = object:getcomponentbyid('ball_sprite')
	if sprite then
		sprite.offset = sprite.offset or { x = 0, y = 0, z = 0 }
		sprite.offset.x = -ball.radius
		sprite.offset.y = -ball.radius
		sprite.layer = 'ui'
		sprite.colorize = sprite.colorize or sprite_colors[palette[1]]
	end
	object.visible = true
end

local function update_ball_sprite_position(ball)
	local object = registry:get(ball.object_id)
	if not object then
		return
	end
	object.x = ball.x
	object.y = ball.y
end

local function apply_ball_sprite_color(ball, color_index)
	local object = registry:get(ball.object_id)
	if not object then
		return
	end
	local sprite = object:getcomponentbyid('ball_sprite')
	if not sprite then
		return
	end
	sprite.colorize = sprite_colors[color_index]
end

local function despawn_ball_sprite(ball)
	if not ball.object_id then
		return
	end
	if registry:get(ball.object_id) then
		despawn(ball.object_id)
	end
end

local function reset_balls()
	for _, existing in ipairs(state.balls) do
		despawn_ball_sprite(existing)
	end
	state.balls = {}
	math.randomseed(os.time())
	for i = 1, 8 do
		local ball = create_ball(i)
		ensure_ball_sprite(ball)
		update_ball_sprite_position(ball)
		table.insert(state.balls, ball)
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

local function create_engine_actor()
	state.engineactorid = spawn_world_object('LuaDemoActor', {
		id = 'lua_demo_actor',
		position = { x = 48, y = 48, z = 0 },
	})
	attach_fsm(state.engineactorid, 'console_testmachine')
	local actor = registry:get(state.engineactorid)
	events:emit('lua_demo.engine_actor_spawned', actor, { actorid = state.engineactorid })
	update_actor_snapshot()
end

local function spawn_lua_actor()
	state.luaactorid = spawn_world_object('LuaDemoActor', {
		id = 'lua_demo_actor_lua',
		position = { x = 96, y = 64, z = 0 },
	})
	local actor = registry:get(state.luaactorid)
	if actor then
		actor.visible = false
	end
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
	create_engine_actor()
	spawn_lua_actor()
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
	update_ball_sprite_position(ball)
end

function update(delta)
	state.frame = state.frame + 1

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
	local object = registry:get(ball.object_id)
	if not object then
		return
	end
	apply_ball_sprite_color(ball, color)
	object.x = ball.x
	object.y = ball.y + offsety
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
