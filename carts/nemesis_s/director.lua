local bool01<const> = require('cartlib/util/bool01')
local clock<const> = require('cartlib/clock')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local fsm_library<const> = require('cartlib/fsm/library')
local atlas<const> = require('cartlib/gx/atlas')
local input_actioneffect_component<const> = require('cartlib/input/actioneffect/actioneffect_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
require('constants')
local end_demo_module<const> = require('end_demo')
local player_module<const> = require('player/player')
local player_state<const> = require('player/player_state')
local stage_module<const> = require('stage')
local status_bar_module<const> = require('status_bar')

local director<const> = {}
director.__index = director

local game_start_timeline_id<const> = 'nemesis_s.director.game_start'
local game_start_duration_frames<const> = 41
local game_over_curtain_timeline_id<const> = 'nemesis_s.director.game_over_curtain'
local game_over_blackout_timeline_id<const> = 'nemesis_s.director.game_over_blackout'
local game_over_curtain_visual_id<const> = 'game_over_curtain'
local metalion_cheat_command<const> = 'cheat.metalion'
local full_loadout_cheat_command<const> = 'cheat.lars18th'
local cheat_input_program<const> = {
	bindings = {
		{
			name = 'metalion',
			when = {
				mode = { path = '/gameplay/pause' },
			},
			on = {
				combo = {
					keyboard = 'metalion',
					submit = true,
				},
			},
			go = {
				combo = {
					['dispatch.command'] = {
						event = metalion_cheat_command,
					},
				},
			},
		},
		{
			name = 'lars18th',
			when = {
				mode = { path = '/gameplay/pause' },
			},
			on = {
				combo = {
					keyboard = 'lars18th',
					submit = true,
				},
			},
			go = {
				combo = {
					['dispatch.command'] = {
						event = full_loadout_cheat_command,
					},
				},
			},
		},
	},
}
local new_cheat_input<const> = input_actioneffect_component.factory({
	clock_source = clock.frame,
	program = cheat_input_program,
})
local draw_game_over_curtain<const> = function(component, draw)
	draw:rect(0, 0, component.parent.game_over_curtain_width, presentation_height, 0xff000000)
end
local new_game_over_curtain<const> = custom_visual_component.factory({
	id_local = game_over_curtain_visual_id,
	draw = draw_game_over_curtain,
	offset_z = game_over_curtain_draw_z,
	enabled = false,
})

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

function director:populate_game_start()
	self.frame = 0
	local stage<const> = world:spawn(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		space_id = 'main',
		start_column = self.stage_start_column,
		restarting = self.restarting,
		pos = { x = 0, y = 0, z = 0 },
	})
	self.stage = stage
	local player_states<const> = {}
	local players<const> = {}
	for player_index = 1, self.player_count do
		player_states[player_index] = player_state.new(player_index)
	end
	local status_bar<const> = world:spawn(status_bar_module.definition_id, {
		space_id = 'game_start',
		player_states = player_states,
		pos = { x = 0, y = 0, z = 100 },
	})
	for player_index = 1, self.player_count do
		local start<const> = player_starts[player_index]
		players[player_index] = world:spawn(player_module.player_def_id, {
			id = start.id,
			player_index = player_index,
			player_state = player_states[player_index],
			metalion_cheat_active = self.metalion_cheat_active,
			space_id = 'main',
			stage = stage,
			pos = { x = start.x, y = start.y },
		})
	end
	self.player_states = player_states
	self.players = players
	self.status_bar = status_bar
	atlas.load('status')
	atlas.load('font')
	atlas.load('gameplay')
	self.events:emit('game_start')
end

function director:enter_game_start()
	self:set_active_space('game_start')
	world:clear_space('end_demo')
	world:unload_space('main', director.populate_game_start, self)
end

function director:enter_gameplay()
	self.status_bar:set_space('main')
	self:set_active_space('main')
	self.frame = 0
	self.telemetry_stage_head = self.stage.tape_head
end

function director:enter_pause()
	world:set_gameplay_clock_running(false)
	self.events:emit('pause_entered')
end

function director:leave_pause()
	world:set_gameplay_clock_running(true)
	self.events:emit('pause_exited')
end

function director:can_pause()
	local players<const> = self.players
	for player_index = 1, #players do
		if players[player_index]:has_tag(player_module.active_state_tag) then
			return true
		end
	end
	return false
end

function director:toggle_metalion_cheat()
	local active<const> = not self.metalion_cheat_active
	self.metalion_cheat_active = active
	for player_index = 1, #self.players do
		self.players[player_index]:set_metalion_cheat(active)
	end
end

function director:grant_full_loadout()
	for player_index = 1, #self.player_states do
		self.player_states[player_index]:grant_full_loadout()
	end
end

function director:populate_end_demo()
	self.stage = nil
	self.players = nil
	self.player_states = nil
	self.status_bar = nil
	world:spawn(end_demo_module.definition_id, {
		space_id = 'end_demo',
		pos = { x = 0, y = 0, z = 0 },
	})
	self.events:emit('end_demo')
end

function director:enter_end_demo()
	self:set_active_space('end_demo')
	world:unload_space('main', director.populate_end_demo, self)
end

function director:accept_title_selection(_state, event)
	self.player_count = event.player_count
	self.stage_start_column = 0
	self.restarting = false
	self.metalion_cheat_active = false
	return '/game_start'
end

function director:on_player_death()
	for player_index = 1, #self.player_states do
		if self.player_states[player_index].lives >= 0 then
			return
		end
	end
	self.stage_start_column = self.stage:restart_column()
	self.restarting = true
	return '/game_over'
end

function director:apply_game_over_curtain_frame(frame)
	self.game_over_curtain_width = frame * game_over_curtain_tile_width
	self.game_over_curtain:set_enabled(frame ~= 0)
end

function director:enter_game_over()
	self.metalion_cheat_active = false
	self.game_over_curtain_width = 0
	self.game_over_curtain:set_enabled(false)
	self.events:emit('game_over')
end

function director:enter_game_over_blackout()
	world:set_gameplay_clock_running(false)
	self.game_over_curtain:set_enabled(false)
	self:set_active_space('game_over')
end

function director:ctor()
	self.game_over_curtain = self:get_component(
		custom_visual_component,
		game_over_curtain_visual_id
	)
end

function director:update_telemetry()
	local stage<const> = self.stage
	local stage_head<const> = stage.tape_head
	local stage_advanced<const> = stage_head ~= self.telemetry_stage_head
	self.telemetry_stage_head = stage_head
	print(string.format(
		'%s|kind=director|f=%d|scroll=%.3f|yellow_blink=%d|blue_blink=%d|yellow_count=%d|blue_count=%d|stage_left=%d|stage_head=%d|stage_px=%.3f|stage_scrolling=%d|stage_scroll_gate=%d|stage_adv=%d',
		telemetry_metric_prefix,
		self.frame,
		stage.star_scroll_px % playfield_width,
		bool01(stage.yellow_blink),
		bool01(stage.blue_blink),
		#stage.yellow_stars,
		#stage.blue_stars,
		stage.left_tile,
		stage_head,
		stage.total_scroll_px,
		bool01(stage.scrolling),
		stage.scroll_gate,
		bool01(stage_advanced)
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

local director_event_handlers<const> = {
	[metalion_cheat_command] = director.toggle_metalion_cheat,
	[full_loadout_cheat_command] = director.grant_full_loadout,
}
if telemetry_enabled then
	director_event_handlers['star_blink_toggle'] = {
		emitter = ids_stage_instance,
		go = function(self, _state, _event, stage)
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
	}
	director_event_handlers['stage_scroll_stop'] = {
		emitter = ids_stage_instance,
		go = function(self, _state, event)
			self:emit_telemetry_event(
				'stage_scroll_stop',
				string.format('left=%d|head=%d', event.left, event.head)
			)
		end,
	}
	director_event_handlers['stage_scroll_tile'] = {
		emitter = ids_stage_instance,
		go = function(self, _state, event)
			self:emit_telemetry_event(
				'stage_scroll_tile',
				string.format('left=%d|head=%d', event.left, event.head)
			)
		end,
	}
end

local define_director_fsm<const> = function()
	local gameplay_running_state<const> = {
		input_event_handlers = {
			{
				pattern = 'pause[jp]',
				player_index = 1,
				go = '/gameplay/pause',
			},
			{
				pattern = 'pause[jp]',
				player_index = 2,
				go = '/gameplay/pause',
			},
		},
	}
	local gameplay_state<const> = {
		initial = 'running',
		entering_state = director.enter_gameplay,
		on = {
			['player.death'] = {
				emitter = false,
				go = director.on_player_death,
			},
			['stage.completed'] = {
				emitter = ids_stage_instance,
				go = '/end_demo',
			},
		},
		states = {
			running = gameplay_running_state,
			pause = {
				entering_state = director.enter_pause,
				exiting_state = director.leave_pause,
				transition_guards = {
					can_enter = director.can_pause,
				},
				input_event_handlers = {
					{
						pattern = 'pause[jp]',
						player_index = 1,
						go = '/gameplay/running',
					},
					{
						pattern = 'pause[jp]',
						player_index = 2,
						go = '/gameplay/running',
					},
				},
			},
		},
	}
	if telemetry_enabled then
		gameplay_running_state.update = director.update_telemetry
	end
	fsm_library.register(ids_director_fsm, {
		clock_source = timeline_clock_source.frame,
		initial = 'boot',
		on = director_event_handlers,
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
							duration_frames = game_start_duration_frames,
							clock_source = timeline_clock_source.frame,
						},
						autoplay = true,
						stop_on_exit = true,
						on_finished = '/gameplay',
					},
				},
			},
			gameplay = gameplay_state,
			game_over = {
				initial = 'curtain',
				entering_state = director.enter_game_over,
				exiting_state = function(self)
					self.game_over_curtain:set_enabled(false)
					world:set_gameplay_clock_running(true)
				end,
				states = {
					curtain = {
						timelines = {
							[game_over_curtain_timeline_id] = {
								def = {
									frames = timeline.range(game_over_curtain_columns + 1),
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
									apply = director.apply_game_over_curtain_frame,
								},
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = false,
								},
								on_finished = '../blackout',
							},
						},
					},
					blackout = {
						entering_state = director.enter_game_over_blackout,
						timelines = {
							[game_over_blackout_timeline_id] = {
								def = {
									continuous = true,
									duration_ms = game_over_blackout_duration_ms,
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = '/game_start',
							},
						},
					},
				},
			},
			end_demo = {
				entering_state = director.enter_end_demo,
				on = {
					['end_demo_done'] = {
						emitter = 'nemesis_s.end_demo',
						go = '/title',
					},
				},
			},
		},
	})
end

local register_director_definition<const> = function()
	prefab.define({
		def_id = ids_director_def,
		class = director,
		components = {
			new_game_over_curtain,
			timeline_component.new,
			fsm_component.factory({ ids_director_fsm }),
			new_cheat_input,
		},
		defaults = {
			id = ids_director_instance,
			player_index = 1,
			frame = 0,
			player_count = 1,
			stage_start_column = 0,
			restarting = false,
			game_over_curtain_width = 0,
			metalion_cheat_active = false,
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
