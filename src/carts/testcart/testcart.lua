require('extra.lua')

local hero_def_id = 'demo.hero'
local hero_instance_id = 'demo.hero.instance'
local hero_fsm_id = 'demo.hero.fsm'
local hero_timeline_id = 'demo.hero.timeline'
local hero_tracker_component_id = 'demo.hero.tracker'
local collision_target_def_id = 'demo.collision.target'
local collision_target_instance_id = 'demo.collision.target.instance'
local collision_target_spawn_pos = { x = 104, y = 64, z = 0 }
local collision_layers = { hero = 0x1, target = 0x2 }
local service_id = 'demo.service.director'
local effect_id = 'demo.effect.blink'
local hero_spawn_pos = { x = 48, y = 64, z = 0 }

local demo = {
	last_plain_input = 'none',
	tick = 0,
	collision = {
		active = false,
		last_event = 'none',
		with = 'none',
		begin_count = 0,
		stay_count = 0,
		end_count = 0,
		contact_depth = 0,
		contact_normal_x = 0,
		contact_normal_y = 0,
	},
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
		if game:action_triggered(1, entry[1] .. '[jp]') then
			demo.last_plain_input = entry[2]
			emit('demo.input', nil, { action = entry[2], t = demo.tick })
			print('[hotreload-test] input action=' .. entry[2] .. ' tick=' .. demo.tick)
		end
	end
end

local function setup_hero_collision(owner)
	local collider = owner.collider
	collider:set_local_area({
		left = 0,
		top = 0,
		right = owner.sx,
		bottom = owner.sy,
	})
	collider.generateoverlapevents = true
	collider.layer = collision_layers.hero
	collider.mask = collision_layers.target
	owner.overlapping = false
	local function capture_contact(event, phase)
		demo.collision.last_event = phase
		demo.collision.with = event.other_id
		local contact = event.contact
		demo.collision.contact_depth = contact.depth
		demo.collision.contact_normal_x = contact.normal.x
		demo.collision.contact_normal_y = contact.normal.y
	end
	owner.events:on({
		event = 'overlap.begin',
		subscriber = owner,
		handler = function(event)
			demo.collision.begin_count = demo.collision.begin_count + 1
			demo.collision.active = true
			owner.overlapping = true
			capture_contact(event, 'begin')
		end,
	})
	owner.events:on({
		event = 'overlap.stay',
		subscriber = owner,
		handler = function(event)
			demo.collision.stay_count = demo.collision.stay_count + 1
			demo.collision.active = true
			owner.overlapping = true
			capture_contact(event, 'stay')
		end,
	})
	owner.events:on({
		event = 'overlap.end',
		subscriber = owner,
		handler = function(event)
			demo.collision.end_count = demo.collision.end_count + 1
			demo.collision.active = false
			owner.overlapping = false
			demo.collision.last_event = 'end'
			demo.collision.with = event.other_id
			demo.collision.contact_depth = 0
			demo.collision.contact_normal_x = 0
			demo.collision.contact_normal_y = 0
		end,
	})
end

hero = {}
hero.__index = hero

function hero:onspawn(spawn_pos)
	print('[debug] onspawn native=' .. tostring(self.__native__) .. ' play_ani=' .. tostring(self.play_ani))
	print('[debug] define_timeline value=' .. tostring(self.timelines.define) .. ' type=' .. type(self.timelines.define))
	local timeline_component = self.timelines
	print('[debug] timeline_component=' .. tostring(timeline_component) .. ' type=' .. type(timeline_component) .. ' has_define=' .. tostring(timeline_component and timeline_component.define) .. ' has_play=' .. tostring(timeline_component and timeline_component.play))
	local define_fn = timeline_component.define
	local play_fn = timeline_component.play
	self.label = 'hero'
	self.sx = 10
	self.sy = 10
	self.speed = 54
	self.facing = 'right'
	self.charge_time = 0
	self.active_state = 'not set'
	self.tempo_ready = true
	self.blinking_timer = 0
	self.move_count = 0
	self.boundary_pushback = 0
	setup_hero_collision(self)
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
end

function hero:emit_move(dx, dy)
	local payload = { x = self.x, y = self.y, dx = dx, dy = dy }
	self.events:emit('demo.hero.move', payload)
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
	if not game:action_triggered(1, 'console_a[jp]') then
		return
	end
	if not self.tempo_ready then
		return
	end
	local ok = trigger_effect(self.id, effect_id, { payload = { facing = self.facing, t = demo.tick } })
	if ok then
		local payload = { phase = 'request', facing = self.facing }
		self.events:emit('demo.hero.effect', payload)
	end
end

local function build_hero_fsm()
	define_fsm(hero_fsm_id, {
		initial = 'idle',
		states = {
			idle = {
				entering_state = function(self, state)
					self.active_state = state.id
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
					['console_b[jp]'] = {
						go = function(self)
							return '/charging'
						end,
					},
					['console_a[jp]'] = {
						go = function(self)
							return '/blinking'
						end,
					},
				},
			},
			moving = {
				entering_state = function(self, state)
					self.active_state = state.id
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
					['console_b[jp]'] = {
						go = function(self)
							return '/charging'
						end,
					},
					['console_a[jp]'] = {
						go = function(self)
							return '/blinking'
						end,
					},
				},
			},
			charging = {
				entering_state = function(self, state)
					self.active_state = state.id
					self.charge_time = 0
				end,
				tick = function(self)
					self.charge_time = self.charge_time + game.deltatime_seconds
					self:run_motion(1)
					self:try_blink()
					if not game:action_triggered(1, 'console_b[p]') then
						local payload = { time = self.charge_time }
						self.events:emit('demo.hero.charge', payload)
						return '/moving'
					end
				end,
			},
			blinking = {
				entering_state = function(self, state)
					self.active_state = state.id
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

local collision_target = {}
collision_target.__index = collision_target

function collision_target:onspawn(spawn_pos)
	self.label = 'collision target'
	self.sx = 16
	self.sy = 16
	self.hit_flash = 0
	self.x = spawn_pos.x
	self.y = spawn_pos.y
	self.z = spawn_pos.z
	local collider = self.collider
	collider:set_local_area({
		left = 0, top = 0, right = self.sx, bottom = self.sy,
	})
	collider.generateoverlapevents = true
	collider.layer = collision_layers.target
	collider.mask = collision_layers.hero
	self.events:on({
		event = 'overlap.begin',
		subscriber = self,
		handler = function()
			self.hit_flash = 0.25
		end,
	})
	self.events:on({
		event = 'overlap.stay',
		subscriber = self,
		handler = function()
			self.hit_flash = 0.15
		end,
	})
end

function collision_target:cooldown_flash(dt)
	self.hit_flash = math.max(0, self.hit_flash - dt)
end

local function register_hero()
	define_world_object({
		def_id = hero_def_id,
		class = hero,
		components = { 'ActionEffectComponent', 'Collider2DComponent', 'ProhibitLeavingScreenComponent', hero_tracker_component_id },
		fsms = { hero_fsm_id, },
		effects = { effect_id, },
		defaults = { speed = 54 },
	})
end

local function register_collision_target()
	define_world_object({
		def_id = collision_target_def_id,
		class = collision_target,
		components = { 'Collider2DComponent', 'ProhibitLeavingScreenComponent' },
		defaults = { sx = 16, sy = 16 },
	})
end

local director = { id = service_id, stats = { moves = 0, pulses = 0, effects = 0, charges = 0 } }

local function timelinehandler(event)
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

local function reset_collision_stats()
	demo.collision = {
		active = false,
		last_event = 'none',
		with = 'none',
		begin_count = 0,
		stay_count = 0,
		end_count = 0,
		contact_depth = 0,
		contact_normal_x = 0,
		contact_normal_y = 0,
	}
end

local function define_blink()
	define_effect({
		id = effect_id,
		event = 'demo.hero.blink',
		cooldown_ms = 420,
		-- handle the blink directly in the effect so a single trigger applies movement/timer/emits without relying on a separate lis
		handler = function(ctx)
			print('[hotreload-test] blink effect handler invoked tick=' .. demo.tick)
			local owner = ctx.owner
			local facing = owner.facing
			local offset = facing == 'left' and -24 or 24
			owner.x = owner.x + offset
			owner.y = owner.y - 2
			owner.blinking_timer = 0.2
			local payload = { phase = 'active', facing = facing, offset = offset }
			owner.events:emit('demo.hero.effect', payload)
			owner.events:emit('demo.hero.effect', { phase = 'done' })
			print('[hotreload-test] blink facing=' .. facing .. ' offset=' .. offset .. ' tick=' .. demo.tick)
			return { facing = facing }
		end,
	})
end

local function define_hero_tracker_component()
	define_component({
		def_id = hero_tracker_component_id,
		class = {
			on_attach = function(self)
				self.moves = 0
				self.boundary_bounces = 0
				local owner = self.parent
				owner.hero_tracker = self
				owner.events:on({
					event = 'demo.hero.move',
					subscriber = self,
					handler = function()
						self.moves = self.moves + 1
						owner.move_count = self.moves
					end,
				})
				owner.events:on({
					event = 'screen.leaving',
					subscriber = self,
					handler = function()
						self.boundary_bounces = self.boundary_bounces + 1
						owner.boundary_pushback = self.boundary_bounces
					end,
				})
			end,
		},
		defaults = { moves = 0, boundary_bounces = 0 },
	})
end

local function define_blueprints_and_handlers()
	define_hero_tracker_component()
	build_hero_fsm()
	define_blink()
	register_hero()
	register_collision_target()
	register_director_listeners()
end

function init()
	cartdata('bmsx_test_cart_demo')
	define_blueprints_and_handlers()
	print('[hotreload-test] init completed')
end

function new_game()
	reset_director_stats()
	reset_collision_stats()
	spawn_sprite(hero_def_id, {
		id = hero_instance_id,
		pos = { x = hero_spawn_pos.x, y = hero_spawn_pos.y, z = hero_spawn_pos.z },
	})
	spawn_sprite(collision_target_def_id, {
		id = collision_target_instance_id,
		pos = { x = collision_target_spawn_pos.x, y = collision_target_spawn_pos.y, z = collision_target_spawn_pos.z },
	})
end

local function tick_collision_flash(dt)
	local target = world_object(collision_target_instance_id)
	target:cooldown_flash(dt)
end

function update(dt)
	demo.tick = demo.tick + dt
	track_plain_input()
	tick_collision_flash(dt)
end

local function draw_hero(hero)
	local ready = hero.tempo_ready
	local blinking = hero.blinking_timer > 0
	local touching = hero.overlapping
	local basecolor = blinking and 8 or (ready and 10 or 12)
	local color = touching and 2 or basecolor
	rectfill(hero.x, hero.y, hero.x + hero.sx, hero.y + hero.sy, 0, color)
end

local function draw_collision_target(target)
	local flash = target.hit_flash
	local color = flash > 0 and 9 or 3
	rectfill(target.x, target.y, target.x + target.sx, target.y + target.sy, 0, color)
end

local function draw_hud(hero)
	local stats = director.stats
	local collision = demo.collision
	write('bmsx lua engine tour', 8, 0, 0, 15)
	write('worldobject : ' .. hero.id, 8, 8, 0, 11)
	write('service     : ' .. service_id, 8, 16, 0, 11)
	write('fsm state   : ' .. hero.active_state, 8, 24, 0, 7)
	write('timeline    : ' .. hero_timeline_id, 8, 32, 0, 7)
	write('effect      : ' .. effect_id, 8, 40, 0, 7)
	write('plain input : ' .. demo.last_plain_input, 6, 48, 0, 6)
	write('moves       : ' .. stats.moves, 8, 56, 0, 6)
	write('pulses      : ' .. stats.pulses, 8, 64, 0, 6)
	write('effects     : ' .. stats.effects, 8, 72, 0, 6)
	write('charges     : ' .. stats.charges, 8, 80, 0, 6)
	write('tracker mv  : ' .. hero.move_count, 8, 88, 0, 6)
	write('screen hits : ' .. hero.boundary_pushback, 8, 96, 0, 6)
	write('collision   : ' .. (collision.active and 'touching' or 'clear'), 8, 104, 0, 9)
	write('overlap evt : ' .. collision.last_event .. ' vs ' .. collision.with, 8, 112, 0, 9)
	write('contact d/n : ' .. string.format('%.2f (%.2f, %.2f)', collision.contact_depth, collision.contact_normal_x, collision.contact_normal_y), 8, 120, 0, 9)
	write('counts b/s/e: ' .. collision.begin_count .. '/' .. collision.stay_count .. '/' .. collision.end_count, 8, 128, 0, 9)
	write('controls:', 8, 152, 0, 13)
	write('- arrows: move world object', 8, 160, 0, 13)
	write('  - a: blink (inputactiontoeffect + input)', 8, 168, 0, 13)
	write('  - b: hold (fsm + input)', 8, 176, 0, 13)
end

function draw()
	cls(4)
	local hero_instance = world_object(hero_instance_id)
	local target_instance = world_object(collision_target_instance_id)
	draw_collision_target(target_instance)
	draw_hero(hero_instance)
	draw_hud(hero_instance)
	extra()
end
