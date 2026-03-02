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

-- All states that switch to transition space + emit a named event + play the mask follow
-- the exact same three-line pattern. Extract it so every entering_state is a single call.
function director:enter_transition(event_name)
	self:set_active_space('transition')
	self.events:emit(event_name)
	self.events:emit('transition.mask.play')
end

-- Both daemon appearance variants share the same setup; only the after_death flag differs.
-- Use a single helper and navigate to the correct FSM state (daemon_appearance vs
-- daemon_appearance_post_death) instead of storing a cross-state flag on self.
function director:start_daemon_appearance(after_death)
	self:set_active_space('main')
	self:ensure_daemon_cloud_pool()
	self.daemon_smoke_next = 1
	if after_death then
		self.events:emit('daemon_appearance', { after_death = true })
	else
		self.events:emit('daemon_appearance')
	end
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
			self.events:emit('lithograph_requested', { lines = { event.text_line } })
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
	self.daemon_smoke_next = 1
	self.daemon_clouds = {}
	self.seal_flash_on = false
	self.banner_post_action = nil
	self.pending_shrine_text_lines = {}

	self:activate_spaces()
	self:bind_visual()
	self:ensure_daemon_cloud_pool()
end

-- ARCHITECTURE: Engineering guidelines for this FSM.
--
-- TIMELINE DEFINITION
--   Timelines that belong to a single state are declared inside that state's
--   `timelines` block using `def = { ... }`.  The engine calls timeline.new(def)
--   internally — no timeline.new() call is needed in cart code.
--   The `id` field in `def` is optional; it defaults to the dictionary key.
--   Timelines shared between multiple states are declared in the root `timelines`
--   block of the FSM (before `states`) with `autoplay = false`, then each state
--   that uses them declares only the behaviour (autoplay, stop_on_exit, on_end …).
--
-- PER-STATE TIMELINE BEHAVIOUR
--   autoplay = true   — FSM plays the timeline automatically on state enter.
--   autoplay = false  — play manually with self:play_timeline(id, opts) in
--                       entering_state (needed when target/params are runtime).
--   stop_on_exit = true  — FSM stops the timeline automatically on exit.
--   on_end / on_frame — transition or action callbacks.
--
-- CROSS-OBJECT COMMUNICATION
--   The director must never call methods on other objects directly, and must
--   never emit "command" events that are thinly disguised method calls on a
--   specific object.  A command event is any event whose sole consumer is one
--   named object and whose only effect is to mutate that object's state.
--
--   WRONG — director demands shrine reset itself:
--     self.events:emit('shrine.clear')   -- shrine is the only subscriber; this
--                                        -- is just shrine:clear() in disguise.
--   RIGHT — each subsystem owns its own reset trigger:
--     shrine subscribes to 'room' in its own bind() and clears itself there.
--
--   BROADCAST events emitted by director:
--     'room'            — director has entered room state; all subsystems that
--                         need to reset on room entry subscribe to this in their
--                         own bind().  castle also emits 'room.enter' here.
--     'transition'      — director has entered transition sub-state.
--     'seal_dissolution', 'daemon_appearance', 'halo', 'shrine', 'item',
--     'lithograph', 'title', 'story', 'ending', 'victory_dance', 'death' —
--                         broadcast mode switches; room FSM and renders subscribe.
--
--   REQUEST/REPLY:
--     director emits 'player.death_resolve' and enters a waiting state.
--     → castle handles the event, does its internal bookkeeping, and
--       emits 'death_resolved' with a payload { restart_daemon = bool }.
--     → director reacts via on = { ['death_resolved'] = function(self, _s, e) … }
--
-- FSM STATE SUB-VARIANTS
--   When two states differ only by a boolean context value (e.g. after_death), do not
--   store a cross-state flag on self.  Instead create two distinct FSM states
--   (daemon_appearance / daemon_appearance_post_death) and navigate to the right one
--   from the decision state (death_resolve).  Shared logic lives in a method.
--
-- STAGING FIELDS (pending_*)
--   The only legitimate 'cross-state' data on self are staging fields (pending_*)
--   that are populated synchronously in one breath with the FSM event that
--   triggers the transition, and consumed immediately in the next state's
--   entering_state.  They must be cleared in entering_state after reading.
--   PREFERRED: pass the data directly in the event payload so that the FSM
--   state receives it via the event argument and no self field is needed at all.
--
--   WRONG — staging field (known pre-existing violation: pending_lithograph_lines):
--     self.pending_lithograph_lines = { event.text_line }  -- set here
--     self.events:emit('lithograph_requested')             -- then transition
--     -- lithograph_screen_open.entering_state reads self.pending_lithograph_lines
--   RIGHT — payload in the event:
--     self.events:emit('lithograph_requested', { lines = { event.text_line } })
--     -- lithograph_screen_open.entering_state receives lines via event.lines
local function define_director_fsm()
	-- Shared on-handlers for both daemon appearance variants (avoid duplication).
	local function on_daemon_cloud_spawn(self)
		self:spawn_daemon_cloud()
	end
	local function on_daemon_appearance_done(self)
		self:despawn_daemon_clouds()
		self.events:emit('daemon_appearance_done')
		return '/room'
	end

	define_fsm('director', {
		-- daemon_timeline_id is shared between daemon_appearance and
		-- daemon_appearance_post_death, so it is registered here at FSM root
		-- (autoplay = false = registration only).  Each state configures behaviour.
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
				autoplay = false,
			},
		},
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
					self:despawn_daemon_clouds()
					self:set_active_space('main')
					-- 'room' drives: castle emit_room_enter, room FSM mode+room_state sync,
					-- transition banner clear, shrine clear, lithograph clear.
					self.events:emit('room')
				end,
				on = {
					['room_switched'] = '/room_switch_wait',
					['lithograph_requested'] = function(self, _state, event)
						self.events:emit('lithograph.open', { lines = event.lines })
						self:set_active_space('lithograph')
						self.events:emit('lithograph')
						return '/lithograph_screen_open'
					end,
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
					self:enter_transition('transition')
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
					['shrine_exit_done'] = '/room',
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
				end,
				on = {
					['halo_trigger_cancelled'] = '/item_screen',
				},
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
						self:enter_transition('halo')
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
			-- Timeline def is at FSM root (shared with daemon_appearance_post_death).
			daemon_appearance = {
				timelines = {
					[daemon_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					self:start_daemon_appearance(false)
				end,
				on = {
					['daemon.cloud.spawn'] = on_daemon_cloud_spawn,
					['daemon.appearance.done'] = on_daemon_appearance_done,
				},
			},
			-- Same as daemon_appearance but emits after_death=true in the payload.
			-- Navigated to from death_resolve when restart_daemon is true.
			daemon_appearance_post_death = {
				timelines = {
					[daemon_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
					},
				},
				entering_state = function(self)
					self:start_daemon_appearance(true)
				end,
				on = {
					['daemon.cloud.spawn'] = on_daemon_cloud_spawn,
					['daemon.appearance.done'] = on_daemon_appearance_done,
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
						on_end = '/room',
					},
				},
				entering_state = function(self)
					self.events:emit('lithograph.clear')
				end,
			},
				title_screen = {
					entering_state = function(self) self:enter_transition('title') end,
					on = { ['title_screen_done'] = '/room' },
				},
				story = {
					entering_state = function(self) self:enter_transition('story') end,
					on = { ['story_done'] = '/room' },
				},
				ending = {
					entering_state = function(self) self:enter_transition('ending') end,
					on = { ['ending_done'] = '/room' },
				},
				victory_dance = {
					entering_state = function(self) self:enter_transition('victory_dance') end,
					on = { ['victory_dance_done'] = '/room' },
				},
				death = {
					entering_state = function(self) self:enter_transition('death') end,
					on = { ['death_done'] = '/death_resolve' },
				},
				-- Emit a request event; castle handles it (updates tags, evaluates
				-- should_restart_daemon) and replies with 'death_resolved' carrying
				-- { restart_daemon = bool }. No direct object() calls here.
				death_resolve = {
					entering_state = function(self)
						self.events:emit('player.death_resolve')
					end,
					on = {
						['death_resolved'] = function(self, _state, event)
							if event.restart_daemon then
								return '/daemon_appearance_post_death'
							end
							return '/room'
						end,
					},
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
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
}
