local constants = require('constants')
local halo_teleport_timeline_id = 'director.halo.transition'
local banner_world_timeline_id = 'director.banner.world'
local banner_castle_timeline_id = 'director.banner.castle'
local room_switch_wait_timeline_id = 'director.wait.room_switch'
local item_screen_open_timeline_id = 'director.wait.item.open'
local item_screen_close_timeline_id = 'director.wait.item.close'
local lithograph_open_timeline_id = 'director.wait.lithograph.open'
local lithograph_close_timeline_id = 'director.wait.lithograph.close'
local seal_timeline_id = 'director.seal'
local daemon_timeline_id = 'director.daemon'

local director = {}
director.__index = director

function director:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		if not self.seal_flash_on then
			return
		end
		put_rectfillcolor(
			0,
			constants.room.tile_origin_y,
			display_width(),
			display_height(),
			500,
			{ r = 1, g = 1, b = 1, a = 0.7 },
			{ layer = 'ui' }
		)
	end
end

function director:activate_spaces()
	add_space('main')
	add_space('transition')
	add_space('shrine')
	add_space('lithograph')
	add_space('item')
	add_space('ui')
end

function director:set_active_space(space_id)
	set_space(space_id)
	self:set_space(space_id)
	object('ui'):set_space(space_id)
end

function director:begin_black_wait()
	self:set_active_space('transition')
	self.events:emit('transition')
	self.events:emit('transition.mask.play')
end

function director:banner_lines(mode)
	if mode == 'world_banner' then
		return {
			'WORLD ' .. tostring(self.pending_banner_world_number) .. ' !',
		}
	end
	return {
		'CASTLE !',
	}
end

function director:queue_banner_transition(mode, world_number, post_action)
	self.pending_banner_mode = mode
	self.pending_banner_world_number = world_number
	self.pending_banner_post_action = post_action
	self.events:emit('banner_requested')
end

function director:expect_room_switch_banner(mode, world_number, post_action)
	self.next_room_switch_banner_mode = mode
	self.next_room_switch_banner_world_number = world_number
	self.next_room_switch_banner_post_action = post_action
end

function director:clear_expected_room_switch_banner()
	self.next_room_switch_banner_mode = nil
	self.next_room_switch_banner_world_number = 0
	self.next_room_switch_banner_post_action = nil
end

function director:queue_expected_room_switch_banner_if_any()
	if self.next_room_switch_banner_mode == nil then
		return false
	end
	self:queue_banner_transition(
	self.next_room_switch_banner_mode,
	self.next_room_switch_banner_world_number,
	self.next_room_switch_banner_post_action
	)
	self:clear_expected_room_switch_banner()
	return true
end

function director:open_shrine(text_lines)
	self.pending_shrine_text_lines = text_lines
	self.events:emit('shrine_overlay_requested')
end

function director:ensure_daemon_cloud_pool()
	local clouds = self.daemon_clouds
	for i = 1, constants.flow.daemon_cloud_max do
		if clouds[i] == nil then
			clouds[i] = inst('daemon_cloud', {
				id = 'dc.' .. tostring(i),
				space_id = 'main',
				pos = { x = 0, y = 0, z = 23 },
			})
		end
		clouds[i]:stop_and_hide()
	end
end

function director:spawn_daemon_cloud()
	local clouds = self.daemon_clouds
	local start_index = self.daemon_smoke_next
	for i = 0, constants.flow.daemon_cloud_max - 1 do
		local index = ((start_index - 1 + i) % constants.flow.daemon_cloud_max) + 1
		local cloud = clouds[index]
		if not cloud.visible then
			cloud:play_once_at(
				constants.room.tile_origin_x + (math.random(constants.flow.daemon_cloud_spawn_x_min, constants.flow.daemon_cloud_spawn_x_max) * constants.room.tile_size),
				constants.room.tile_origin_y + (math.random(constants.flow.daemon_cloud_spawn_y_min, constants.flow.daemon_cloud_spawn_y_max) * constants.room.tile_size)
			)
			self.daemon_smoke_next = index + 1
			if self.daemon_smoke_next > constants.flow.daemon_cloud_max then
				self.daemon_smoke_next = 1
			end
			return
		end
	end
end

function director:despawn_daemon_clouds()
	local clouds = self.daemon_clouds
	for i = 1, #clouds do
		clouds[i]:stop_and_hide()
	end
end

function director:finish_banner_transition()
	self.events:emit('transition.banner', { lines = {} })
	if self.banner_post_action == 'castle_emerge' then
		self.banner_post_action = nil
		self.events:emit('player.world_emerge')
		return '/world_transition'
	end
	self.banner_post_action = nil
	self.events:emit('world_banner_done')
	return '/room_switch_wait'
end

function director:go_room_resume_music()
	object('c'):emit_room_enter()
	return '/room'
end

function director:bind()
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self.events:emit('room_state.sync')
			if self:queue_expected_room_switch_banner_if_any() then
				return
			end
			self.events:emit('room_switched')
		end,
	})

	self.events:on({
		event = 'lithograph.request',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(event)
			self.pending_lithograph_lines = { event.text_line }
			self.events:emit('lithograph_requested')
		end,
	})
end

function director:ctor()
	self.pending_banner_mode = nil
	self.pending_banner_world_number = 0
	self.pending_banner_post_action = nil
	self.next_room_switch_banner_mode = nil
	self.next_room_switch_banner_world_number = 0
	self.next_room_switch_banner_post_action = nil
	self.daemon_appearance_after_death = false
	self.daemon_smoke_next = 1
	self.daemon_clouds = {}
	self.seal_flash_on = false
	self.banner_post_action = nil
	self.pending_shrine_text_lines = {}
	self.pending_lithograph_lines = {}
	self:activate_spaces()
	self:bind_visual()
	self:ensure_daemon_cloud_pool()
end

-- ARCHITECTURE: Engineering guidelines for FSM states that use timelines.
--
-- DEFINING timelines
--   Declare them in the `timelines` block of the state that owns them, using
--   `def = { ... }` with a plain configuration table. The engine calls
--   timeline.new(def) internally — no timeline.new() call needed in cart code.
--   The `id` field in `def` is optional; it defaults to the dictionary key.
--
-- PER-STATE BEHAVIOUR
--   autoplay = true   — the FSM plays the timeline automatically on state enter.
--                       Use this when no runtime `target` or `params` are needed.
--   autoplay = false  — play manually with self:play_timeline(id, opts) in
--                       entering_state. Required when `target` or `params` are
--                       only known at enter time (e.g. they depend on self.x).
--   stop_on_exit = true  — the FSM stops the timeline automatically on exit.
--   on_end            — transition or action when the timeline finishes.
--   on_frame          — action fired on every timeline frame tick.
local function define_director_fsm()
	define_fsm('director', {
		initial = 'room',
		on = {
			['world_transition_start'] = '/world_transition',
			['shrine_transition_start'] = '/shrine_transition_enter',
			['halo_transition_start'] = '/halo_teleport',
			['seal_dissolution_start'] = '/seal_dissolution',
			['title_screen_start'] = '/title_screen',
			['story_start'] = '/story',
			['ending_start'] = '/ending',
			['victory_dance_start'] = '/victory_dance',
			['death_start'] = '/death',
		},
		states = {
			room = {
				entering_state = function(self)
					self.events:emit('transition.banner', { lines = {} })
					self.events:emit('shrine.clear')
					self.events:emit('lithograph.clear')
					self:despawn_daemon_clouds()
					self:set_active_space('main')
					self.events:emit('shrine_transition_exit')
					self.events:emit('room')
					self.events:emit('room_state.sync')
				end,
				on = {
					['room_switched'] = '/room_switch_wait',
					['lithograph_requested'] = '/lithograph_screen_open',
					['banner_requested'] = '/banner_transition',
				},
				input_event_handlers = {
					['lb[jp] || rb[jp]'] = function(self)
						self.events:emit('f1')
						return '/item_screen_opening'
					end,
				},
			},
			room_switch_wait = {
				timelines = {
					[room_switch_wait_timeline_id] = {
						def = {
							frames = timeline.range(constants.flow.room_switch_wait_frames),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = '/room',
					},
				},
				entering_state = director.begin_black_wait,
			},
				world_transition = {
					entering_state = function(self)
						self:set_active_space('main')
					end,
					on = {
						['world_transition_done'] = '/room_switch_wait',
						['banner_requested'] = '/banner_transition',
					},
				},
				shrine_transition_enter = {
					entering_state = function(self)
						self.events:emit('shrine_transition_enter')
						self:set_active_space('main')
					end,
					on = {
						['shrine_overlay_requested'] = '/shrine_overlay',
					},
				},
			banner_transition = {
				timelines = {
					[banner_world_timeline_id] = {
						def = {
							frames = timeline.range(constants.flow.world_banner_frames),
							playback_mode = 'once',
						},
						autoplay = false,
						stop_on_exit = true,
						on_end = director.finish_banner_transition,
					},
					[banner_castle_timeline_id] = {
						def = {
							frames = timeline.range(constants.flow.castle_banner_frames),
							playback_mode = 'once',
						},
						autoplay = false,
						stop_on_exit = true,
						on_end = director.finish_banner_transition,
					},
				},
				tags = { 'd.bt' },
				entering_state = function(self)
					local banner_mode = self.pending_banner_mode
					self.events:emit('transition.banner', { lines = self:banner_lines(banner_mode) })
					self.banner_post_action = self.pending_banner_post_action
					self.pending_banner_mode = nil
					self.pending_banner_world_number = 0
					self.pending_banner_post_action = nil
					self:set_active_space('transition')
					self.events:emit('transition')
					self.events:emit('transition.mask.play')
					local timeline_id = banner_mode == 'world_banner' and banner_world_timeline_id or banner_castle_timeline_id
					self:play_timeline(timeline_id, { rewind = true, snap_to_start = true })
				end,
			},
			shrine_overlay = {
					entering_state = function(self)
							self.events:emit('shrine.open', { lines = self.pending_shrine_text_lines })
						self.pending_shrine_text_lines = {}
						self:set_active_space('shrine')
						self.events:emit('shrine')
					end,
				input_event_handlers = {
					['down[jp]'] = '/shrine_transition_exit',
				},
			},
				shrine_transition_exit = {
					entering_state = function(self)
							self.events:emit('shrine.clear')
						self:set_active_space('main')
						self.events:emit('player.shrine_overlay_exit')
					end,
				on = {
					['shrine_exit_done'] = director.go_room_resume_music,
				},
			},
			item_screen_opening = {
				timelines = {
					[item_screen_open_timeline_id] = {
						def = {
							frames = timeline.range(constants.flow.item_screen_wait_frames),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = '/item_screen',
					},
				},
				entering_state = director.begin_black_wait,
			},
				item_screen = {
					entering_state = function(self)
						self:set_active_space('item')
						self.events:emit('item')
					end,
				input_event_handlers = {
					['start[jp]'] = '/item_screen_halo',
					['lb[jp] || rb[jp]'] = '/item_screen_closing',
				},
				on = {
					['banner_requested'] = '/banner_transition',
				},
			},
			item_screen_halo = {
				entering_state = function(self)
					self.events:emit('player.halo_trigger')
					return '/item_screen'
				end,
			},
			item_screen_closing = {
				timelines = {
					[item_screen_close_timeline_id] = {
						def = {
							frames = timeline.range(constants.flow.item_screen_wait_frames),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = '/room',
					},
				},
				entering_state = director.begin_black_wait,
			},
				halo_teleport = {
				timelines = {
					[halo_teleport_timeline_id] = {
						def = {
							frames = timeline.range(1),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_end = '/room_switch_wait',
					},
				},
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('halo')
						self.events:emit('transition.mask.play')
					end,
			},
				seal_dissolution = {
					timelines = {
						[seal_timeline_id] = {
							def = {
								frames = timeline.range(95),
								playback_mode = 'once',
								markers = {
									{ frame = 0, event = 'seal.phase', payload = { phase = 'flash' } },
									{ frame = 31, event = 'seal.phase', payload = { phase = 'room_dissolve' } },
									{ frame = 63, event = 'seal.phase', payload = { phase = 'seal_dissolve' } },
								},
								windows = {
									{
										name = 'dissolve',
										tag = 'd.seal.dissolve',
										start = { frame = 31 },
										['end'] = { frame = 94 },
									},
									{
										name = 'smoke',
										tag = 'd.seal.smoke',
										start = { frame = 63 },
										['end'] = { frame = 94 },
									},
								},
							},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_frame = function(self, _state, event)
							local intro_state = event.frame_value + 1
							self.seal_flash_on = intro_state < 32 and (intro_state % 4) >= 2
							if self.seal_flash_on then
								self:add_tag('d.seal.flash')
							else
								self:remove_tag('d.seal.flash')
							end
							if intro_state == 32 then
								self.events:emit('seal_flash_done')
							end
						end,
						on_end = function(self)
							self.seal_flash_on = false
							self:remove_tag('d.seal.flash')
							self.events:emit('seal_dissolution_done')
							return '/daemon_appearance'
						end,
					},
					},
					tags = { 'd.seal' },
					entering_state = function(self)
						self:set_active_space('main')
						self.seal_flash_on = false
						self:remove_tag('d.seal.flash')
						self.events:emit('seal_breaking')
						self.events:emit('seal_dissolution')
					end,
				},
				daemon_appearance = {
				timelines = {
						[daemon_timeline_id] = {
							def = {
								frames = timeline.range(126),
								playback_mode = 'once',
								markers = (function()
								local markers = {}
								for frame_value = 0, 125 do
									local intro_state = math.modf(frame_value / 2) + 97
									if (frame_value % 2) == 0 and intro_state > 96 and intro_state < 160 and (intro_state % 8) < 4 then
										markers[#markers + 1] = { frame = frame_value, event = 'daemon.cloud.spawn' }
									end
								end
								markers[#markers + 1] = { frame = 124, event = 'daemon.appearance.done' }
								return markers
							end)(),
								windows = {
									{
										name = 'clouds',
										tag = 'd.daemon.clouds',
										start = { frame = 0 },
										['end'] = { frame = 125 },
									},
								},
							},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
					},
					entering_state = function(self)
						self:set_active_space('main')
						self:ensure_daemon_cloud_pool()
						self.daemon_smoke_next = 1
						if self.daemon_appearance_after_death then
							self.daemon_appearance_after_death = false
							self.events:emit('daemon_appearance', { after_death = true })
						else
							self.events:emit('daemon_appearance')
					end
				end,
				on = {
					['daemon.cloud.spawn'] = function(self)
						self:spawn_daemon_cloud()
					end,
					['daemon.appearance.done'] = function(self)
						self:despawn_daemon_clouds()
						self.events:emit('daemon_appearance_done')
						return '/room'
					end,
				},
			},
				lithograph_screen_open = {
				timelines = {
					[lithograph_open_timeline_id] = {
						def = {
							frames = timeline.range(1),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						on_end = '/lithograph_screen',
					},
				},
					entering_state = function(self)
						self.events:emit('lithograph.open', { lines = self.pending_lithograph_lines })
						self.pending_lithograph_lines = {}
						self:set_active_space('lithograph')
						self.events:emit('lithograph')
					end,
			},
			lithograph_screen = {
				input_event_handlers = {
					['b[jp] || x[jp]'] = '/lithograph_screen_close',
				},
			},
			lithograph_screen_close = {
				timelines = {
					[lithograph_close_timeline_id] = {
						def = {
							frames = timeline.range(1),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						on_end = director.go_room_resume_music,
					},
				},
				entering_state = function(self)
					self.events:emit('lithograph.clear')
				end,
			},
				title_screen = {
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('title')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['title_screen_done'] = director.go_room_resume_music,
				},
			},
				story = {
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('story')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['story_done'] = director.go_room_resume_music,
				},
			},
				ending = {
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('ending')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['ending_done'] = director.go_room_resume_music,
				},
			},
				victory_dance = {
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('victory_dance')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['victory_dance_done'] = director.go_room_resume_music,
				},
			},
				death = {
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('death')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['death_done'] = '/death_resolve',
				},
			},
			death_resolve = {
				entering_state = function(self)
					local restart_daemon = object('c'):resolve_death()
					if restart_daemon then
						self.daemon_appearance_after_death = true
						return '/daemon_appearance'
					end
					object('c'):emit_room_enter()
					return '/room'
				end,
			},
		},
	})
end

local function register_director_definition()
	define_prefab({
		def_id = 'director',
		class = director,
		fsms = { 'director' },
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'd',
			pending_banner_world_number = 0,
			next_room_switch_banner_world_number = 0,
			pending_shrine_text_lines = {},
			pending_lithograph_lines = {},
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
}
