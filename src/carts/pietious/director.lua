-- director.lua
-- game flow orchestrator — owns the master FSM that governs which mode the
-- game is in (room, shrine, lithograph, item screen, death, etc.) and
-- coordinates transitions between modes via broadcast events.
--
-- KEY DESIGN DECISIONS
--
-- 1. SINGLE BROADCAST PER MODE SWITCH.
--    When the director enters a mode (e.g. shrine, lithograph), it emits ONE
--    broadcast event whose name matches the mode.  Any data that a specific
--    subsystem needs is carried as a payload on that broadcast.  There is no
--    second "open" or "clear" event — subsystems self-clear when they hear the
--    next mode broadcast (typically 'room').
--
--    Example:  entering shrine/overlay emits `shrine { lines = … }`.
--    The shrine overlay reads the lines from the payload in its own handler.
--    When the director later re-enters 'room', shrine hears the 'room'
--    broadcast and clears its lines — no explicit 'shrine.clear' event.
--
-- 2. enter_transition() HELPER.
--    All mode switches that require the transition overlay (fade mask) follow
--    the same three-step pattern: (a) switch to transition space, (b) emit
--    the mode broadcast (optionally with payload), (c) emit
--    'transition.mask.play' to tell the transition overlay to play its fade
--    timeline. The enter_transition() helper captures this so entering_state
--    callbacks are one-liners.
--
--    'transition.mask.play' is cross-cutting: emitted for ALL mode switches
--    (halo, title, story, death, etc.), not just the 'transition' mode.  The
--    transition overlay subscribes to it independently of any specific mode.
--
-- 3. NO DISGUISED METHOD CALLS.
--    The director never calls methods on other objects directly and never emits
--    "command" events that are thinly disguised method calls targeting a single
--    object.  If a subsystem needs to act on a mode change, it subscribes to
--    the mode broadcast in its own bind().
--
-- 4. FSM STATE SUB-VARIANTS INSTEAD OF CROSS-STATE FLAGS.
--    When two states differ only by a boolean context value (e.g. after_death
--    in daemon_appearance), two distinct FSM states exist and the decision
--    point navigates to the correct one.  Shared setup lives in a helper
--    method (start_daemon_appearance).  No boolean flags are stored on self.
--
-- 5. STAGING FIELDS (pending_*).
--    The only legitimate cross-state data on self are staging fields populated
--    synchronously in one breath with the FSM event that triggers the
--    transition.  They are consumed and cleared immediately in the next
--    state's entering_state.  Prefer passing data in the event payload so no
--    staging field is needed at all (e.g. lithograph_requested.lines).
--
-- 6. REQUEST / REPLY.
--    For interactions that require a round-trip (player death → castle
--    evaluates restart_daemon → reply), director emits a request event
--    (e.g. 'player.death_resolve') and waits via `on` for the reply
--    (e.g. 'death_resolved').  No polling, no pending flag — the FSM state
--    IS the waiting mechanism.

local constants = require('constants')
local halo_teleport_timeline_id = 'director.halo.transition'
local banner_world_timeline_id = 'director.banner.world'
local banner_castle_timeline_id = 'director.banner.castle'
local room_switch_wait_timeline_id = 'director.wait.room_switch'
local immediate_room_banner_modes = {
	world_banner = true,
	castle_banner = true,
}
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
	self:enter_transition('transition')
end

function director:banner_lines(mode, world_number)
	if mode == 'world_banner' then
		return {
			'WORLD ' .. tostring(world_number) .. ' !',
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
	local banner_mode = self.banner_mode
	self.banner_mode = nil
	if self.banner_post_action == 'castle_emerge' then
		self.banner_post_action = nil
		self.events:emit('player.world_emerge')
		return '/world_transition'
	end
	self.banner_post_action = nil
	self.events:emit('world_banner_done')
	if immediate_room_banner_modes[banner_mode] then
		return '/room'
	end
	return '/room_switch_wait'
end

-- All states that switch to transition space + emit a named event + play the mask follow
-- the exact same three-line pattern. Extract it so every entering_state is a single call.
function director:enter_transition(event_name, payload)
	self:set_active_space('transition')
	self.events:emit(event_name, payload)
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
	self.banner_mode = nil
	self.banner_post_action = nil
	self.pending_shrine_text_lines = {}

	self:activate_spaces()
	self:bind_visual()
	self:ensure_daemon_cloud_pool()
end

-- BROADCAST EVENT CATALOGUE — authoritative list of events emitted by director.
--
--   'room'                  — director entered room state. Subsystems (shrine,
--                             lithograph, transition) subscribe and self-clear.
--   'transition'            — director entered transition sub-state. Optional
--                             { lines = { ... } } payload for banner text.
--   'transition.mask.play'  — cross-cutting: transition overlay plays its fade
--                             mask timeline. Emitted for ALL mode switches so
--                             the overlay does not need to know the mode name.
--   'seal_dissolution'      — starts seal dissolution. Player + projectiles
--                             subscribe to enter /freeze state; they unfreeze
--                             on 'seal_flash_done' (emitted mid-timeline at
--                             frame 32).
--   'seal_flash_done'       — flash phase done; objects may resume.
--   'seal_dissolution_done' — entire dissolution timeline finished.
--   'daemon_appearance'     — optional { after_death = true } payload.
--   'daemon_appearance_done'— daemon cloud timeline ended.
--   'shrine'                — { lines = { ... } } payload.
--   'lithograph'            — { lines = { ... } } payload.
--   'item'                  — item screen mode.
--   'halo'                  — halo teleport mode.
--   'title', 'story', 'ending', 'victory_dance', 'death' — modal modes.
--   'f1'                    — item screen opened (audio-only).
--
-- REQUEST/REPLY:
--   'player.death_resolve'         → castle → reply 'death_resolved'
--   'player.shrine_overlay_exit'   → player → reply 'shrine_exit_done'
--   'player.halo_trigger'          → player → reply 'halo_trigger_cancelled'
--   'player.world_emerge'          → player (begins emergence animation)
local function define_director_fsm()
	-- Shared timeline callbacks for both daemon appearance variants.
	-- Two FSM states (daemon_appearance / daemon_appearance_post_death) share
	-- the same cloud-spawning on_frame and completion on_end.  Defining them
	-- as local functions here avoids duplication without creating cross-state
	-- flags — the two states navigate from different decision points but run
	-- identical timeline behaviour.
	local function on_daemon_frame(self, _state, event)
		local frame_value = event.frame_value
		local intro_state = math.modf(frame_value / 2) + 97
		if (frame_value % 2) == 0 and intro_state > 96 and intro_state < 160 and (intro_state % 8) < 4 then
			self:spawn_daemon_cloud()
		end
	end
	local function on_daemon_end(self)
		self:despawn_daemon_clouds()
		self.events:emit('daemon_appearance_done')
		return '/room'
	end

	define_fsm('director', {
		-- daemon_timeline_id is shared between daemon_appearance and
		-- daemon_appearance_post_death, so it is registered here at FSM root
		-- (autoplay = false = registration only).  Each state configures behaviour
		-- via on_frame (cloud spawning) and on_end (completion + transition).
		timelines = {
			[daemon_timeline_id] = {
				def = {
					frames = timeline.range(126),
					playback_mode = 'once',
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
		-- ROOT ON HANDLERS — global mode-switch triggers.
		-- These fire regardless of which sub-state the director is in, which is
		-- exactly how mode transitions work: any game system can request a mode
		-- change at any time, and the director unconditionally obeys.
		on = {
			['world_transition_start'] = '/world_transition',
			['shrine_transition_start'] = '/shrine',
			['halo_transition_start'] = '/halo_teleport',
			['seal_dissolution_start'] = '/seal_dissolution',
			['title_screen_start'] = '/title_screen',
			['story_start'] = '/story',
			['ending_start'] = '/ending',
			['victory_dance_start'] = '/victory_dance',
			['death_start'] = '/death',
		},
		states = {
			-- ROOM — default mode. Player is moving around in a room.
			-- entering_state emits 'room' which acts as the universal "return
			-- to gameplay" signal: shrine clears its text, lithograph resets,
			-- transition overlay clears its banner, etc.
			room = {
				entering_state = function(self)
					self:despawn_daemon_clouds()
					self:set_active_space('main')
					self.events:emit('room')
				end,
				on = {
					['room_switched'] = '/room_switch_wait',
					-- LITHOGRAPH — room-local. Handled here (not on root) because
					-- lithographs are only reachable from the room state via
					-- a tile interaction in 'pietolon'.
					['lithograph_requested'] = function(self, _state, event)
						self:set_active_space('lithograph')
						-- Single broadcast with payload (lines). No separate 'lithograph.open'.
						self.events:emit('lithograph', { lines = event.lines })
						return '/lithograph'
					end,
					['banner_requested'] = '/banner_transition',
				},
				input_event_handlers = {
					['lb[jp] || rb[jp]'] = function(self)
						self.events:emit('f1')
						return '/item_screen'
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
				-- SHRINE — three-phase compound state (entering → overlay → exiting).
				-- The shrine transition begins in 'main' space (player walks in),
				-- switches to 'shrine' space for the overlay text, then back to
				-- 'main' for the exit animation before returning to room.
				shrine = {
					initial = 'entering',
					states = {
						entering = {
							entering_state = function(self)
								self.events:emit('shrine_transition_enter')
								self:set_active_space('main')
							end,
							on = {
								['shrine_overlay_requested'] = '/shrine/overlay',
							},
						},
						overlay = {
							-- Single 'shrine' broadcast carries text lines as payload.
							-- The shrine overlay reads event.lines in its own handler.
							entering_state = function(self)
								local lines = self.pending_shrine_text_lines
								self.pending_shrine_text_lines = {}
								self:set_active_space('shrine')
								self.events:emit('shrine', { lines = lines })
							end,
							input_event_handlers = {
								['down[jp]'] = '/shrine/exiting',
							},
						},
						exiting = {
							entering_state = function(self)
								self:set_active_space('main')
								self.events:emit('player.shrine_overlay_exit')
							end,
							on = {
								['shrine_exit_done'] = '/room',
							},
						},
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
					local banner_world_number = self.pending_banner_world_number
					self.banner_mode = banner_mode
					self.banner_post_action = self.pending_banner_post_action
					self.pending_banner_mode = nil
					self.pending_banner_world_number = 0
					self.pending_banner_post_action = nil
					self:enter_transition('transition', { lines = self:banner_lines(banner_mode, banner_world_number) })
					local timeline_id = banner_mode == 'world_banner' and banner_world_timeline_id or banner_castle_timeline_id
					self:play_timeline(timeline_id, { rewind = true, snap_to_start = true })
				end,
			},
			item_screen = {
				initial = 'opening',
				states = {
					opening = {
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
								on_end = '/item_screen/active',
							},
						},
						entering_state = director.begin_black_wait,
					},
					active = {
						entering_state = function(self)
							self:set_active_space('item')
							self.events:emit('item')
						end,
						input_event_handlers = {
							['start[jp]'] = '/item_screen/halo',
							['lb[jp] || rb[jp]'] = '/item_screen/closing',
						},
						on = {
							['banner_requested'] = '/banner_transition',
						},
					},
					halo = {
						entering_state = function(self)
							self.events:emit('player.halo_trigger')
						end,
						on = {
							['halo_trigger_cancelled'] = '/item_screen/active',
						},
					},
					closing = {
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
				},
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
			-- SEAL DISSOLUTION — runs a 95-frame timeline that:
				--   frames 0–31: screen flash phase (white overlay toggles).
				--     On frame 32: emits 'seal_flash_done' → player + projectiles
				--     unfreeze (they entered /freeze on 'seal_dissolution').
				--   frames 31–94: dissolve window (tagged d.seal.dissolve).
				--   frames 63–94: smoke window (tagged d.seal.smoke).
				--   on_end: emits 'seal_dissolution_done' → transitions to daemon_appearance.
				--
				-- On entering_state: emits 'seal_dissolution' which is both the
				-- mode broadcast for renderers and the freeze trigger for player +
				-- projectiles.  No separate 'seal_breaking' event.
				seal_dissolution = {
					timelines = {
						[seal_timeline_id] = {
							def = {
								frames = timeline.range(95),
								playback_mode = 'once',
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
						self.events:emit('seal_dissolution')
					end,
				},
			-- Timeline def is at FSM root (shared with daemon_appearance_post_death).
			-- Cloud spawning and completion are handled by timeline on_frame/on_end.
			daemon_appearance = {
				timelines = {
					[daemon_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
						on_frame = on_daemon_frame,
						on_end = on_daemon_end,
					},
				},
				entering_state = function(self)
					self:start_daemon_appearance(false)
				end,
			},
			-- Same as daemon_appearance but emits after_death=true in the payload.
			-- Navigated to from death_resolve when restart_daemon is true.
			daemon_appearance_post_death = {
				timelines = {
					[daemon_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = { rewind = true, snap_to_start = true },
						on_frame = on_daemon_frame,
						on_end = on_daemon_end,
					},
				},
				entering_state = function(self)
					self:start_daemon_appearance(true)
				end,
			},
			lithograph = {
				initial = 'opening',
				states = {
					opening = {
						timelines = {
							[lithograph_open_timeline_id] = {
								def = {
									frames = timeline.range(1),
									playback_mode = 'once',
								},
								autoplay = true,
								stop_on_exit = true,
								on_end = '/lithograph/viewing',
							},
						},
					},
					viewing = {
						input_event_handlers = {
							['b[jp] || x[jp]'] = '/lithograph/closing',
						},
					},
					closing = {
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
					},
				},
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
				-- REQUEST/REPLY pattern: emit 'player.death_resolve' → castle
				-- subscribes, evaluates game state, replies with 'death_resolved'
				-- carrying { restart_daemon = bool }.  Director WAITS in this FSM
				-- state — the state IS the waiting mechanism.  No polling needed.
				-- On reply: navigate to daemon_appearance_post_death or /room.
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
