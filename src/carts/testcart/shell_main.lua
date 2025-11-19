local HERO_DEF_ID = 'demo.hero'
local HERO_INSTANCE_ID = 'demo.hero.instance'
local HERO_FSM_ID = 'demo.hero.fsm'
local HERO_TIMELINE_ID = 'demo.hero.timeline'
local SERVICE_ID = 'demo.service.director'
local ABILITY_ID = 'demo.ability.blink'

local demo = {
	stats = { saves = 0, loads = 0 },
	last_plain_input = 'none',
	snapshot = nil,
	tick = 0,
}

local function track_plain_input()
	local bindings = {
		{ 'console_left', 'left' },
		{ 'console_right', 'right' },
		{ 'console_up', 'up' },
		{ 'console_down', 'down' },
	}
	for index = 1, #bindings do
		local entry = bindings[index]
		local state = game:get_action_state(1, entry[1])
		if state.guardedjustpressed then
			demo.last_plain_input = entry[2]
			emit('demo.input', nil, { action = entry[2], t = demo.tick })
		end
	end
end

Hero = {}
Hero.__index = Hero

function Hero:create(self)
	self.label = 'hero'
	self.x = 48
	self.y = 64
	self.sx = 10
	self.sy = 10
	self.speed = 54
	self.facing = 'right'
	self.charge_time = 0
	self.active_state = 'idle'
end

function Hero:on_spawn()
	self:define_timeline({
		id = HERO_TIMELINE_ID,
		frames = { 'rise', 'peak', 'cool', 'reset' },
		ticks_per_frame = 0.35,
		playback_mode = 'loop',
		markers = {
			{ frame = 0, event = 'demo.timeline.frame', payload = { label = 'rise' }, add_tags = { 'demo.tempo.ready' } },
			{ frame = 1, event = 'demo.timeline.frame', payload = { label = 'peak' }, remove_tags = { 'demo.tempo.ready' } },
			{ frame = 3, event = 'demo.timeline.frame', payload = { label = 'reset' }, add_tags = { 'demo.tempo.ready' } },
		},
	})
	self:play_timeline(HERO_TIMELINE_ID)
end

function Hero:emit_move(dx, dy)
	local payload = { x = self.x, y = self.y, dx = dx, dy = dy }
	self.events:emit('demo.hero.move', payload)
	emit('demo.hero.global_move', self, payload)
end

function Hero:run_motion(dt)
	local left = game:get_action_state(1, 'console_left')
	local right = game:get_action_state(1, 'console_right')
	local up = game:get_action_state(1, 'console_up')
	local down = game:get_action_state(1, 'console_down')
	local dx = (right.pressed and 1 or 0) - (left.pressed and 1 or 0)
	local dy = (down.pressed and 1 or 0) - (up.pressed and 1 or 0)
	local moved = dx ~= 0 or dy ~= 0
	if moved then
		self.x = self.x + dx * self.speed * dt
		self.y = self.y + dy * self.speed * dt
		if dx < 0 then
			self.facing = 'left'
		elseif dx > 0 then
			self.facing = 'right'
		end
		self:emit_move(dx, dy)
	end
	return moved
end

function Hero:try_blink()
	local action = game:get_action_state(1, 'console_x')
	if not action.guardedjustpressed then
		return
	end
	local ok = request_ability(self.id, ABILITY_ID, { payload = { facing = self.facing, t = demo.tick } })
	if ok then
		self.events:emit('demo.hero.ability', { phase = 'request', facing = self.facing })
	end
end

local function build_hero_fsm()
	register_prepared_fsm(HERO_FSM_ID, {
		initial = 'idle',
		states = {
			idle = {
				entering_state = function(self)
					self.active_state = 'idle'
				end,
				tick = function(self)
					local moved = self:run_motion(game.deltatime_seconds)
					self:try_blink()
					if moved then
						return '/moving'
					end
				end,
				process_input = function(self)
					if game:get_action_state(1, 'console_o').guardedjustpressed then
						return '/charging'
					end
					if game:get_action_state(1, 'console_x').guardedjustpressed then
						return '/blinking'
					end
				end,
				},
				moving = {
					entering_state = function(self)
						self.active_state = 'moving'
					end,
					tick = function(self)
						local moved = self:run_motion(game.deltatime_seconds)
						self:try_blink()
						if not moved then
							return '/idle'
						end
					end,
				process_input = function(self)
					if game:get_action_state(1, 'console_o').guardedjustpressed then
						return '/charging'
					end
					if game:get_action_state(1, 'console_x').guardedjustpressed then
						return '/blinking'
					end
				end,
			},
				charging = {
					entering_state = function(self)
						self.active_state = 'charging'
						self.charge_time = 0
					end,
					tick = function(self)
						self.charge_time = self.charge_time + game.deltatime_seconds
						self:run_motion(game.deltatime_seconds * 0.5)
						self:try_blink()
						if not game:get_action_state(1, 'console_o').pressed then
							self.events:emit('demo.hero.charge', { time = self.charge_time })
							return '/moving'
						end
					end,
				},
				blinking = {
					entering_state = function(self)
						self.active_state = 'blinking'
						self:try_blink()
					end,
					tick = function(self)
						local asc = self.abilitysystem
						if not asc:has_gameplay_tag('demo.tag.blinking') then
							return '/moving'
						end
					end,
				},
			},
		})
	end

local function register_hero()
	register_world_object({
		id = HERO_DEF_ID,
		class = 'Hero',
		components = { 'AbilitySystemComponent' },
		fsms = { { id = HERO_FSM_ID } },
		abilities = { ABILITY_ID },
		tags = { 'demo.hero' },
		defaults = { speed = 54 },
	})
end

local Director = { id = SERVICE_ID, stats = { moves = 0, pulses = 0, ability = 0, charges = 0 } }

function Director:on_boot()
	self.stats = { moves = 0, pulses = 0, ability = 0, charges = 0 }
end

function Director:on_activate()
	events:on('demo.hero.move', function(event)
		self.stats.moves = self.stats.moves + 1
	end, self)
	events:on('demo.hero.ability', function(event)
		self.stats.ability = self.stats.ability + 1
	end, self)
	events:on('demo.hero.charge', function(event)
		self.stats.charges = self.stats.charges + 1
	end, self)
	events:on('timeline.frame.' .. HERO_TIMELINE_ID, function(event)
		self.stats.pulses = self.stats.pulses + 1
	end, self)
end

function Director:on_tick(dt)
	demo.tick = demo.tick + dt
end

function Director:get_state()
	return { stats = self.stats, tick = demo.tick }
end

function Director:set_state(state)
	self.stats = state.stats
	demo.tick = state.tick
end

local function define_blink()
	define_ability({
		id = ABILITY_ID,
		requiredTags = { 'demo.tempo.ready' },
		grantTags = { 'demo.tag.blinking' },
		removeOnEnd = { 'demo.tag.blinking' },
		cooldownMs = 420,
		activation = function(ctx, payload)
			local owner = ctx.owner
			local facing = payload and payload.facing or owner.facing or 'right'
			local offset = facing == 'left' and -24 or 24
			owner.x = owner.x + offset
			owner.y = owner.y - 2
			owner.events:emit('demo.hero.ability', { phase = 'active', facing = facing, offset = offset })
			emit('demo.hero.ability.global', owner, { phase = 'active', facing = facing, offset = offset })
		end,
		completion = function(ctx)
			ctx.owner.events:emit('demo.hero.ability', { phase = 'done' })
		end,
	})
end

local function build_snapshot()
	local hero = world_object(HERO_INSTANCE_ID)
	local timeline = hero:get_timeline(HERO_TIMELINE_ID)
	local svc = service(SERVICE_ID)
	return {
		hero = {
			x = hero.x,
			y = hero.y,
			facing = hero.facing,
			active_state = hero.active_state,
			timeline_head = timeline.head,
		},
		stats = demo.stats,
		service = Director:get_state(),
		tick = demo.tick,
	}
end

function __bmsx_snapshot_save()
	local snapshot = build_snapshot()
	demo.snapshot = snapshot
	demo.stats.saves = demo.stats.saves + 1
	return snapshot
end

function __bmsx_snapshot_load(snapshot)
	demo.snapshot = snapshot
	demo.stats.loads = demo.stats.loads + 1
	demo.stats = snapshot.stats
	demo.tick = snapshot.tick
	local hero = world_object(HERO_INSTANCE_ID)
	hero.x = snapshot.hero.x
	hero.y = snapshot.hero.y
	hero.facing = snapshot.hero.facing
	hero.active_state = snapshot.hero.active_state
	hero:force_timeline_head(HERO_TIMELINE_ID, snapshot.hero.timeline_head)
	Director:set_state(snapshot.service)
end

local function init_runtime()
	cartdata('bmsx_test_cart_demo')
	build_hero_fsm()
	define_blink()
	register_hero()
	spawn_object(HERO_DEF_ID, { id = HERO_INSTANCE_ID, position = { x = 48, y = 64, z = 0 } })
	register_service(Director)
	demo.snapshot = build_snapshot()
end

function init()
	init_runtime()
end

function update(dt)
	track_plain_input()
	local save = game:get_action_state(1, 'console_down')
	if save.guardedjustpressed then
		__bmsx_snapshot_save()
	end
	local load = game:get_action_state(1, 'console_up')
	if load.guardedjustpressed then
		__bmsx_snapshot_load(demo.snapshot)
	end
end

local function draw_hero(hero)
	local asc = hero.abilitysystem
	local ready = asc:has_gameplay_tag('demo.tempo.ready')
	local blinking = asc:has_gameplay_tag('demo.tag.blinking')
	local baseColor = blinking and 8 or (ready and 10 or 12)
	rectfill(hero.x, hero.y, hero.x + hero.sx, hero.y + hero.sy, baseColor)
end

local function draw_hud(hero)
	local svc = service(SERVICE_ID)
	write('BMSX Lua Engine Tour', 6, 4, 15)
	write('WorldObject : ' .. hero.id, 6, 14, 11)
	write('Service     : ' .. svc.id, 6, 22, 11)
	write('FSM state   : ' .. hero.active_state, 6, 30, 7)
	write('Timeline    : ' .. HERO_TIMELINE_ID, 6, 38, 7)
	write('Ability     : ' .. ABILITY_ID, 6, 46, 7)
	write('Plain input : ' .. demo.last_plain_input, 6, 60, 6)
	write('Moves       : ' .. svc.stats.moves, 6, 69, 6)
	write('Pulses      : ' .. svc.stats.pulses, 6, 78, 6)
	write('Abilities   : ' .. svc.stats.ability, 6, 87, 6)
	write('Charges     : ' .. svc.stats.charges, 6, 96, 6)
	write('Saves/Loads : ' .. demo.stats.saves .. '/' .. demo.stats.loads, 6, 105, 6)
	write('Controls:', 6, 118, 13)
	write('- Arrows: move world object', 6, 128, 13)
	write('- O: hold to charge (FSM + input)', 6, 138, 13)
	write('- X: blink ability (GAS + input)', 6, 148, 13)
	write('- Down/Up: save/load snapshot', 6, 158, 13)
end

function draw()
	cls(1)
	local hero = world_object(HERO_INSTANCE_ID)
	draw_hero(hero)
	draw_hud(hero)
end
