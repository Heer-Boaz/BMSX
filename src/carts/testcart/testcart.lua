local hero_def_id = 'demo.hero'
local hero_instance_id = 'demo.hero.instance'
local hero_fsm_id = 'demo.hero.fsm'
local hero_timeline_id = 'demo.hero.timeline'
local service_id = 'demo.service.director'
local effect_id = 'demo.effect.blink'
local hero_spawn_pos = { x = 48, y = 64, z = 0 }

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
		if game:action_triggered(1, entry[1] .. '[j]') then
			demo.last_plain_input = entry[2]
			emit('demo.input', nil, { action = entry[2], t = demo.tick })
			print('[hotreload-test] input action=' .. entry[2] .. ' tick=' .. demo.tick)
		end
	end
end

hero = {}
hero.__index = hero

function hero:onspawn(spawn_pos)
	print('[debug] onspawn native=' .. tostring(self.__native__) .. ' play_ani=' .. tostring(self.play_ani))
	print('[debug] define_timeline value=' .. tostring(self.define_timeline) .. ' type=' .. type(self.define_timeline))
	local timeline_component = self.timeline_component
	print('[debug] timeline_component=' .. tostring(timeline_component) .. ' type=' .. type(timeline_component) .. ' has_define=' .. tostring(timeline_component and timeline_component.define) .. ' has_play=' .. tostring(timeline_component and timeline_component.play))
	local define_fn = timeline_component.define
	local play_fn = timeline_component.play
	self.label = 'hero'
	self.x = spawn_pos.x -- no defensive code allowed
	self.y = spawn_pos.y -- no defensive code allowed
	self.sx = 10
	self.sy = 10
	self.speed = 54
	self.facing = 'right'
	self.charge_time = 0
	self.active_state = 'idle'
	self.tempo_ready = true
	self.blinking_timer = 0
	define_fn(timeline_component, {
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
	play_fn(timeline_component, hero_timeline_id, { rewind = true, snap_to_start = true })
	self.events:on({
		event = 'demo.timeline.frame',
		subscriber = self,
		handler = function(event)
			local label = event.label
			if label == 'peak' then
				self.tempo_ready = false
			elseif label == 'rise' or label == 'reset' then
				self.tempo_ready = true
			end
		end,
	})
	self:activate()
end

function hero:emit_move(dx, dy)
	local payload = { x = self.x, y = self.y, dx = dx, dy = dy }
	self.events:emit('demo.hero.move', payload)
	emit('demo.hero.global_move', self, payload)
end

function hero:run_motion(dt)
	local left = game:action_triggered(1, 'console_left[p]')
	local right = game:action_triggered(1, 'console_right[p]')
	local up = game:action_triggered(1, 'console_up[p]')
	local down = game:action_triggered(1, 'console_down[p]')
	local dx = (right and 1 or 0) - (left and 1 or 0)
	local dy = (down and 1 or 0) - (up and 1 or 0)
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
	if not game:action_triggered(1, 'console_a[j]') then
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
	define_fsm(hero_fsm_id, {
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
				input_eval = 'first',
				input_event_handlers = {
					['console_b[j]'] = {
						['do'] = function(self)
							return '/charging'
						end,
					},
					['console_a[j]'] = {
						['do'] = function(self)
							return '/blinking'
						end,
					},
				},
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
				input_eval = 'first',
				input_event_handlers = {
					['console_b[j]'] = {
						['do'] = function(self)
							return '/charging'
						end,
					},
					['console_a[j]'] = {
						['do'] = function(self)
							return '/blinking'
						end,
					},
				},
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
					if not game:action_triggered(1, 'console_b[p]') then
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
	define_world_object({
		def_id = hero_def_id,
		class = hero,
		components = { 'actioneffectcomponent', },
		fsms = { hero_fsm_id, },
		effects = { effect_id, },
		defaults = { speed = 54 },
	})
end

local director = { id = service_id, stats = { moves = 0, pulses = 0, effects = 0, charges = 0 } }

local function timelinehandler(event)
	print("director.stats.pulses!  rewsfasfsffs" .. director.stats.pulses)
	director.stats.pulses = director.stats.pulses + 1
end

local function register_director_listeners()
	events:on({
		event = 'demo.hero.move',
		subscriber = director,
		handler = function(event)
			director.stats.moves = director.stats.moves + 1
		end,
	})
	events:on({
		event = 'demo.hero.effect',
		subscriber = director,
		handler = function(event)
			director.stats.effects = director.stats.effects + 1
		end,
	})
	events:on({
		event = 'demo.hero.charge',
		subscriber = director,
		handler = function(event)
			director.stats.charges = director.stats.charges + 1
		end,
	})
	events:on({
		event = 'timeline.frame.' .. hero_timeline_id,
		subscriber = director,
		handler = timelinehandler,
	})
end

local function reset_director_stats()
	director.stats = { moves = 0, pulses = 0, effects = 0, charges = 0 }
end

local function define_blink()
	define_effect({
		id = effect_id,
		event = 'demo.hero.blink',
		cooldown_ms = 420,
		-- handle the blink directly in the effect so a single trigger applies movement/timer/emits without relying on a separate lis
		handler = function(ctx, payload)
			print('[hotreload-test] blink effect handler invoked tick=' .. demo.tick)
			local owner = ctx.owner
			local facing = payload.facing
			local offset = facing == 'left' and -24 or 24
			owner.x = owner.x + offset
			owner.y = owner.y - 2
			owner.blinking_timer = 0.2
			owner.events:emit('demo.hero.effect', { phase = 'active', facing = facing, offset = offset })
			emit('demo.hero.effect.global', owner, { phase = 'active', facing = facing, offset = offset })
			owner.events:emit('demo.hero.effect', { phase = 'done' })
			print('[hotreload-test] blink facing=' .. facing .. ' offset=' .. offset .. ' tick=' .. demo.tick)
			return { facing = facing }
		end,
	})
end

local function define_blueprints_and_handlers()
	build_hero_fsm()
	define_blink()
	register_hero()
	register_director_listeners()
end

function init()
	cartdata('bmsx_test_cart_demo')
	define_blueprints_and_handlers()
	print('[hotreload-test] init completed')
end

function new_game()
	reset_director_stats()
	spawn_sprite(hero_def_id, {
		id = hero_instance_id,
		pos = { x = hero_spawn_pos.x, y = hero_spawn_pos.y, z = hero_spawn_pos.z },
	})
end

function update(dt)
	demo.tick = demo.tick + dt
	track_plain_input()
end

local function draw_hero(hero)
	local ready = hero.tempo_ready
	local blinking = hero.blinking_timer > 0
	local basecolor = blinking and 8 or (ready and 10 or 12)
	rectfill(hero.x, hero.y, hero.x + hero.sx, hero.y + hero.sy, 0, basecolor)
end

local function draw_hud(hero)
	local stats = director.stats
	print("UPDATE PULSES: " .. director.stats.pulses .. "/ " .. stats.pulses)
	write('bmsx lua engine tour', 6, 4, 0, 15)
	write('worldobject : ' .. hero.id, 6, 14, 0, 11)
	write('service     : ' .. service_id, 6, 22, 0, 11)
	write('fsm state   : ' .. hero.active_state, 6, 30, 0, 7)
	write('timeline    : ' .. hero_timeline_id, 6, 38, 0, 7)
	write('effect      : ' .. effect_id, 6, 46, 0, 7)
	write('plain input : ' .. demo.last_plain_input, 6, 60, 0, 6)
	write('moves       : ' .. stats.moves, 6, 69, 0, 6)
	write('pulses      : ' .. stats.pulses, 6, 78, 0, 6)
	write('effects     : ' .. stats.effects, 6, 87, 0, 6)
	write('charges     : ' .. stats.charges, 6, 96, 0, 6)
	write('controls:', 6, 118, 0, 13)
	write('- arrows: move world object', 6, 128, 0, 13)
	write('- a: blink (inputactiontoeffect + input)', 6, 148, 0, 13)
	write('- b: hold (fsm + input)', 6, 138, 0, 13)
end

function draw()
	cls(4)
	local hero_instance = world_object(hero_instance_id)
	draw_hero(hero_instance)
	draw_hud(hero_instance)
end
