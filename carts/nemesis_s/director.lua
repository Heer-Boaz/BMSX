local bool01<const> = require('cartlib/util/bool01')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local gx_texture<const> = require('cartlib/gx/texture')
local prefab<const> = require('cartlib/world/prefab')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
require('constants')
local player_module<const> = require('player/player')
local stage_module<const> = require('stage')

local director<const> = {}
director.__index = director

local game_start_timeline_id<const> = 'nemesis_s.director.game_start'

function director:set_active_space(space_id)
	world:set_space(space_id)
	self:set_space(space_id)
end

function director:enter_intro()
	self:set_active_space('intro')
	self.events:emit('intro')
end

function director:enter_story()
	self:set_active_space('story')
	self.events:emit('story')
end

function director:enter_title()
	self:set_active_space('title')
	self.events:emit('title')
end

function director:enter_game_start()
	self:set_active_space('game_start')
	local stage<const> = world:spawn(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		space_id = 'main',
		pos = { x = 0, y = 0, z = 0 },
	})
	self.stage = stage
	for player_index = 1, self.player_count do
		local start<const> = player_starts[player_index]
		world:spawn(player_module.player_def_id, {
			id = start.id,
			player_index = player_index,
			space_id = 'main',
			stage = stage,
			pos = { x = start.x, y = start.y },
		})
	end
	self.status_bar:reset(self.player_count)
	gx_texture.upload('status_powerup_empty')
	gx_texture.upload('font_a')
	gx_texture.upload('ground')
	self.events:emit('game_start')
end

function director:enter_gameplay()
	self.status_bar:set_space('main')
	self:set_active_space('main')
	self.frame = 0
end

function director:accept_title_selection(_state, event)
	self.player_count = event.player_count
	return '/game_start'
end

function director:update_telemetry()
	print(string.format(
		'%s|kind=director|f=%d|scroll=%.3f|yellow_blink=%d|blue_blink=%d|yellow_count=%d|blue_count=%d|stage_left=%d|stage_head=%d|stage_px=%.3f|stage_scrolling=%d|stage_mode=%d|stage_rot=%d|stage_gate=%d|stage_adv=%d',
		telemetry_metric_prefix,
		self.frame,
		self.stage.total_smooth_scroll_px % machine_game_width,
		bool01(self.stage.yellow_blink),
		bool01(self.stage.blue_blink),
		#self.stage.yellow_stars,
		#self.stage.blue_stars,
		self.stage.left_tile,
		self.stage.tape_head,
		self.stage.total_scroll_px,
		bool01(self.stage.scrolling),
		self.stage.scroll_mode,
		self.stage.scroll_rotator,
		self.stage.scroll_gate_bit,
		bool01(self.stage.scroll_advanced)
	))
	self.frame = self.frame + 1
end

function director:emit_telemetry_event(name, extra)
	if extra ~= nil then
		print(string.format('%s|kind=director|f=%d|name=%s|%s', telemetry_event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=director|f=%d|name=%s', telemetry_event_prefix, self.frame, name))
end

local telemetry_event_handlers
if telemetry_enabled then
	telemetry_event_handlers = {
		['star_blink_toggle'] = {
			emitter = ids_stage_instance,
			go = function(self)
				local stage<const> = self.stage
				self:emit_telemetry_event(
					'star_blink_toggle',
					string.format(
						'turn=%s|yellow_blink=%d|blue_blink=%d',
						stage.blink_turn,
						bool01(stage.yellow_blink),
						bool01(stage.blue_blink)
					)
				)
			end,
		},
		['stage_scroll_stop'] = {
			emitter = ids_stage_instance,
			go = function(self, _state, event)
				self:emit_telemetry_event(
					'stage_scroll_stop',
					string.format('left=%d|head=%d', event.left, event.head)
				)
			end,
		},
		['stage_scroll_tile'] = {
			emitter = ids_stage_instance,
			go = function(self, _state, event)
				self:emit_telemetry_event(
					'stage_scroll_tile',
					string.format('left=%d|head=%d', event.left, event.head)
				)
			end,
		},
		['stage_scroll_gate'] = {
			emitter = ids_stage_instance,
			go = function(self, _state, event)
				self:emit_telemetry_event(
					'stage_scroll_gate',
					string.format(
						'mode=%d|rot=%d|bit=%d|adv=%d|left=%d|head=%d',
						event.mode,
						event.rot,
						event.bit,
						bool01(event.adv),
						event.left,
						event.head
					)
				)
			end,
		},
	}
end

local define_director_fsm<const> = function()
	local gameplay_state<const> = {
		entering_state = director.enter_gameplay,
	}
	if telemetry_enabled then
		gameplay_state.update = director.update_telemetry
	end
	fsm_library.register(ids_director_fsm, {
		clock_source = timeline_clock_source.frame,
		initial = 'boot',
		on = telemetry_event_handlers,
		states = {
			boot = {
				entering_state = function()
					return '/intro'
				end,
			},
			intro = {
				entering_state = director.enter_intro,
				on = {
					['intro_done'] = {
						emitter = 'nemesis_s.intro',
						go = '/story',
					},
				},
			},
			story = {
				entering_state = director.enter_story,
				on = {
					['story_done'] = {
						emitter = 'nemesis_s.story',
						go = '/title',
					},
				},
			},
			title = {
				entering_state = director.enter_title,
				on = {
					['title_screen_done'] = {
						emitter = 'nemesis_s.title_screen',
						go = director.accept_title_selection,
					},
				},
			},
			game_start = {
				entering_state = director.enter_game_start,
				timelines = {
					[game_start_timeline_id] = {
						def = {
							continuous = true,
							duration_ms = 1500,
							playback_mode = 'once',
							clock_source = timeline_clock_source.frame,
						},
						autoplay = true,
						stop_on_exit = true,
						on_finished = '/gameplay',
					},
				},
			},
			gameplay = gameplay_state,
		},
	})
end

local register_director_definition<const> = function()
	prefab.define({
		def_id = ids_director_def,
		class = director,
		components = {
			timeline_component.new,
			fsm_component.factory({ ids_director_fsm }),
		},
		defaults = {
			id = ids_director_instance,
			frame = 0,
			player_count = 1,
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
	director_def_id = ids_director_def,
	director_instance_id = ids_director_instance,
	director_fsm_id = ids_director_fsm,
}
