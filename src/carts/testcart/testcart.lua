local hero_def_id = 'demo.hero'
local hero_instance_id = 'demo.hero.instance'
local hero_fsm_id = 'demo.hero.fsm'
local hero_timeline_id = 'demo.hero.timeline'
local service_id = 'demo.service.director'
local effect_id = 'demo.effect.blink'

local demo = {
	last_plain_input = 'none',
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

hero = {}
hero.__index = hero

function hero:create(self)
	self.label = 'hero'
	self.x = 48
	self.y = 64
	self.sx = 10
	self.sy = 10
	self.speed = 54
	self.facing = 'right'
	self.charge_time = 0
	self.active_state = 'idle'
	self.tempo_ready = true
	self.blinking_timer = 0
end

function hero:on_spawn()
	self:define_timeline({
		id = hero_timeline_id,
		frames = { 'rise', 'peak', 'cool', 'reset' },
		ticks_per_frame = 0.35,
		playback_mode = 'loop',
		markers = {
			{ frame = 0, event = 'demo.timeline.frame', payload = { label = 'rise' } },
			{ frame = 1, event = 'demo.timeline.frame', payload = { label = 'peak' } },
			{ frame = 3, event = 'demo.timeline.frame', payload = { label = 'reset' } },
		},
	})
	self:play_timeline(hero_timeline_id)
	self.events:on({
		event = 'demo.timeline.frame',
		subscriber = self,
		handler = function(event)
		local label = event and event.label
		if label == 'peak' then
			self.tempo_ready = false
		elseif label == 'rise' or label == 'reset' then
			self.tempo_ready = true
		end
	end,
	})
end

function hero:emit_move(dx, dy)
	local payload = { x = self.x, y = self.y, dx = dx, dy = dy }
	self.events:emit('demo.hero.move', payload)
	emit('demo.hero.global_move', self, payload)
end

function hero:run_motion(dt)
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

function hero:try_blink()
	local action = game:get_action_state(1, 'console_a')
	if not action.guardedjustpressed then
		return
	end
	if not self.tempo_ready then
		return
	end
	local ok = trigger_effect(self.id, effect_id, { payload = { facing = self.facing, t = demo.tick } })
	if ok then
		self.events:emit('demo.hero.effect', { phase = 'request', facing = self.facing })
	end
end

local function build_hero_fsm()
	register_prepared_fsm(hero_fsm_id, {
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
					if game:get_action_state(1, 'console_b').guardedjustpressed then
						return '/charging'
					end
					if game:get_action_state(1, 'console_a').guardedjustpressed then
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
					if game:get_action_state(1, 'console_b').guardedjustpressed then
						return '/charging'
					end
					if game:get_action_state(1, 'console_a').guardedjustpressed then
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
						self:run_motion(1)
						self:try_blink()
						if not game:get_action_state(1, 'console_b').pressed then
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
						self.blinking_timer = math.max(0, self.blinking_timer - game.deltatime_seconds)
						if self.blinking_timer <= 0 then return '/moving' end
					end,
				},
			},
		})
	end

local function register_hero()
	register_world_object({
		id = hero_def_id,
		class = 'Hero',
		components = { 'ActionEffectComponent' },
		fsms = { { id = hero_fsm_id } },
		effects = { effect_id },
		defaults = { speed = 54 },
	})
end

local director = { id = service_id, stats = { moves = 0, pulses = 0, effects = 0, charges = 0 } }

function director:on_boot()
	self.stats = { moves = 0, pulses = 0, effects = 0, charges = 0 }
end

function director:on_activate()
	events:on({
		event = 'demo.hero.move',
		subscriber = self,
		handler = function(event)
			self.stats.moves = self.stats.moves + 1
		end,
	})
	events:on({
		event = 'demo.hero.effect',
		subscriber = self,
		handler = function(event)
			self.stats.effects = self.stats.effects + 1
		end,
	})
	events:on({
		event = 'demo.hero.charge',
		subscriber = self,
		handler = function(event)
			self.stats.charges = self.stats.charges + 1
		end,
	})
	events:on({
		event = 'timeline.frame.' .. hero_timeline_id,
		subscriber = self,
		handler = function(event)
			self.stats.pulses = self.stats.pulses + 1
		end,
	})
end

function director:on_tick(dt)
	demo.tick = demo.tick + dt
end

function director:get_state()
	return { stats = self.stats, tick = demo.tick }
end

function director:set_state(state)
	self.stats = state.stats
	demo.tick = state.tick
end

local function define_blink()
	define_effect({
		id = effect_id,
		event = 'demo.hero.blink',
		cooldown_ms = 420,
		-- Handle the blink directly in the effect so a single trigger applies movement/timer/emits without relying on a separate listener.
		on_trigger = function(ctx, payload)
			local owner = ctx.owner
			local facing = payload and payload.facing or owner.facing or 'right'
			local offset = facing == 'left' and -24 or 24
			owner.x = owner.x + offset
			owner.y = owner.y - 2
			owner.blinking_timer = 0.2
			owner.events:emit('demo.hero.effect', { phase = 'active', facing = facing, offset = offset })
			emit('demo.hero.effect.global', owner, { phase = 'active', facing = facing, offset = offset })
			owner.events:emit('demo.hero.effect', { phase = 'done' })
			return { facing = facing }
		end,
	})
end

function init()
	cartdata('bmsx_test_cart_demo')
	build_hero_fsm()
	define_blink()
	register_hero()
	spawn_object(hero_def_id, { id = hero_instance_id, position = { x = 48, y = 64, z = 0 } })
	register_service(director)
end

function update(dt)
	track_plain_input()
end

local function draw_hero(hero)
	local ready = hero.tempo_ready
	local blinking = hero.blinking_timer > 0
	local basecolor = blinking and 8 or (ready and 10 or 12)
	rectfill(hero.x, hero.y, hero.x + hero.sx, hero.y + hero.sy, basecolor)
end

local function draw_hud(hero)
	local stats = director.stats
	write('BMSX Lua Engine Tour', 6, 4, 15)
	write('WorldObject : ' .. hero.id, 6, 14, 11)
	write('Service     : ' .. service_id, 6, 22, 11)
	write('FSM state   : ' .. hero.active_state, 6, 30, 7)
	write('Timeline    : ' .. hero_timeline_id, 6, 38, 7)
	write('Effect      : ' .. effect_id, 6, 46, 7)
	write('Plain input : ' .. demo.last_plain_input, 6, 60, 6)
	write('Moves       : ' .. stats.moves, 6, 69, 6)
	write('Pulses      : ' .. stats.pulses, 6, 78, 6)
	write('Effects     : ' .. stats.effects, 6, 87, 6)
	write('Charges     : ' .. stats.charges, 6, 96, 6)
	write('Controls:', 6, 118, 13)
	write('- Arrows: move world object', 6, 128, 13)
	write('- A: blink (InputActionToEffect + input)', 6, 148, 13)
	write('- B: hold (FSM + input)', 6, 138, 13)
end

function draw()
	cls(1)
	local hero = world_object(hero_instance_id)
	draw_hero(hero)
	draw_hud(hero)
end
