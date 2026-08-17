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
--    the same two-step pattern: (a) switch to transition space, (b) emit ONE
--    mode broadcast (optionally with payload). The transition overlay listens
--    to those mode broadcasts directly and plays its fade mask from the same
--    canonical event, so entering_state callbacks are one-liners.
--
-- 3. NO DISGUISED METHOD CALLS.
--    Mode changes are announcements, never command events aimed at one object.
--    Timeline sample output is different: a sequence owns explicit output
--    bindings and writes them directly during evaluation. The seal sequence
--    therefore receives castle as a construction-time binding instead of
--    broadcasting one synthetic event for every sampled frame.
-- 4. SUBSTATES OVER SWITCH FIELDS.
--    State-shaping distinctions belong in the FSM, not in pending mode flags
--    or post-action switches.  World enter/leave, halo return from a world,
--    world banner, castle banner, and castle-emerge banner are modeled as
--    explicit state paths.  Only true payload data that must cross a state
--    boundary (for example shrine text lines or the world number shown on a
--    banner) is stored on self.
--
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local clock<const> = require('cartlib/clock')
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
require('constants')

local halo_teleport_timeline_id<const> = 'director.halo.transition'
local banner_world_timeline_id<const> = 'director.banner.world'
local banner_castle_timeline_id<const> = 'director.banner.castle'
local banner_pre_delay_timeline_id<const> = 'director.banner.prewait'
local banner_prewait_cue_event<const> = 'd.bp.c'
local banner_world_show_event<const> = 'd.bw.s'
local banner_castle_show_event<const> = 'd.bc.s'
local room_switch_passthrough_dirs<const> = {
	world_enter = true,
	halo = true,
	death = true,
}
local room_switch_wait_timeline_id<const> = 'director.wait.room_switch'
local death_curtain_timeline_id<const> = 'director.death.curtain'
local death_screen_timeline_id<const> = 'director.death.screen'
local title_start_wait_timeline_id<const> = 'director.wait.title_start'
local item_screen_open_timeline_id<const> = 'director.wait.item.open'
local item_screen_close_timeline_id<const> = 'director.wait.item.close'
local item_screen_halo_request_timeline_id<const> = 'director.item.halo.request'
local item_screen_halo_request_event<const> = 'd.ih.r'
local lithograph_open_timeline_id<const> = 'director.wait.lithograph.open'
local lithograph_close_timeline_id<const> = 'director.wait.lithograph.close'
local seal_timeline_id<const> = 'director.seal'
local daemon_timeline_id<const> = 'director.daemon'
local sequence_play_options<const> = {
	rewind = true,
	snap_to_start = false,
}
-- MoG T8003 stores eight fixed (x, y) pairs; the 65-VBlank countdown
-- addresses them as 1,2,3,4,5,6,7,0,1 at eight-VBlank intervals.
local daemon_cloud_positions<const> = {
	152, 96,
	144, 128,
	80, 96,
	64, 64,
	176, 64,
	96, 128,
	128, 96,
	112, 64,
	152, 96,
}

local director<const> = {}
director.__index = director

local draw_death_curtain<const> = function(component, draw)
	draw:rect(0, 0, component.parent.death_curtain_width, screen_height, 0xff000000)
end

function director:set_active_space(space_id)
	world:set_space(space_id)
	self:set_space(space_id)
	self.ui:set_space(space_id)
end

-- disable-next-line single_line_method_pattern -- named director state hook enters this transition from data-driven flow.
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

function director:queue_world_banner_transition(world_number)
	self.events:emit('world_banner_requested', { world_number = world_number })
end

function director:open_shrine(text_lines)
	self.events:emit('shrine_overlay_requested', { lines = text_lines })
end

function director:ensure_daemon_cloud_pool()
	local clouds<const> = self.daemon_clouds
	for i = 1, flow_daemon_cloud_count do
		if clouds[i] == nil then
			clouds[i] = world:spawn('daemon_cloud', {
				id = 'dc.' .. tostring(i),
				space_id = 'main',
				pos = { x = 0, y = 0, z = 23 },
			})
		end
		clouds[i]:stop_and_hide()
	end
end

function director:spawn_daemon_cloud(index)
	local position_index<const> = index * 2 - 1
	self.daemon_clouds[index]:play_once_at(
		daemon_cloud_positions[position_index],
		daemon_cloud_positions[position_index + 1]
	)
end

function director:despawn_daemon_clouds()
	local clouds<const> = self.daemon_clouds
	for i = 1, #clouds do
		clouds[i]:stop_and_hide()
	end
end

function director:finish_world_banner_transition()
	self.banner_world_number = 0
	self.events:emit('world_banner_done')
	return '/room'
end

function director:finish_castle_halo_banner_transition()
	self.banner_world_number = 0
	self.events:emit('halo_banner_done')
	return '/room'
end

function director:finish_death_restart()
	if self.castle:finish_death_restart() then
		return '/daemon_appearance'
	end
	return '/room'
end

function director:begin_world_transition()
	self:set_active_space('main')
	self.events:emit('world_transition')
end

function director:finish_castle_emerge_banner_transition()
	self.banner_world_number = 0
	self.events:emit('player.world_emerge')
	return '/world_transition/emerge'
end

-- All transition-overlay states share the same two-step pattern: switch to
-- transition space, then emit one mode broadcast. The overlay reacts to that
-- same event and plays its mask.
function director:enter_transition(event_name, payload)
	self:set_active_space('transition')
	self.events:emit(event_name, payload)
end

function director:start_daemon_appearance()
	self:set_active_space('main')
	self:ensure_daemon_cloud_pool()
	self.events:emit('daemon_appearance')
end

function director:enter_pause()
	world:set_gameplay_clock_running(false)
	self.player:begin_pause_presentation()
	self.events:emit('pause_entered')
end

function director:leave_pause()
	world:set_gameplay_clock_running(true)
	self.player:finish_pause_presentation()
	self.events:emit('pause_exited')
end

function director:ctor()
	self.daemon_clouds = {}
	self.death_curtain_width = 0
	self.banner_world_number = 0
	self.shrine_text_lines = {}

	local visual<const> = self:get_component(custom_visual_component)
	self.visual_component = visual
	self:ensure_daemon_cloud_pool()
end

-- BROADCAST EVENT CATALOGUE — authoritative list of events emitted by director.
--
--   'room'                  — director entered room state. Subsystems (shrine,
--                             lithograph, transition) subscribe and self-clear.
--   'transition'            — director entered transition sub-state. Optional
--                             { lines = { ... } } payload for banner text.
--   'seal_dissolution'      — starts the gameplay-suspended flash/dissolve state.
--   'seal_dissolution_done' — entire dissolution timeline finished.
--   'daemon_appearance'     — begins the fixed daemon-cloud sequence.
--   'daemon_appearance_done'— daemon cloud timeline ended.
--   'title_wait'            — post-title MSX startup hold: gameplay space
--                             still hidden, HUD hidden, gameplay frozen.
--   'title_wait_done'       — startup hold ended; temporary freezes may resume.
--   'shrine'                — { lines = { ... } } payload.
--   'lithograph'            — { lines = { ... } } payload.
--   'lithograph_exit_done'  — room-state payload for restoring room music.
--   'item'                  — item screen mode.
--   'halo'                  — halo teleport mode.
--   'death_screen'          — retained game-over text shown after the curtain.
--   'title', 'story', 'ending', 'victory_dance' — modal modes.
--   'f1'                    — item screen opened (audio-only).
--   'pause_entered'         — room gameplay paused; AEM retains music transport.
--   'pause_exited'          — pause ended; AEM resumes retained music transport.
--
-- REQUEST/REPLY:
--   'player.shrine_overlay_exit'   → player → reply 'shrine_exit_done'
--   'player.halo_trigger'          → player → reply 'halo_trigger_cancelled'
--   'player.world_emerge'          → player (begins emergence animation)
local define_director_fsm<const> = function()
	local apply_daemon_frame<const> = function(self, frame_value)
		if frame_value <= flow_daemon_cloud_last_spawn_frame
		and (frame_value % flow_daemon_cloud_spawn_interval_frames) == 0 then
			self:spawn_daemon_cloud((frame_value // flow_daemon_cloud_spawn_interval_frames) + 1)
		end
	end
	local apply_seal_frame<const> = function(self, frame_value)
		if frame_value < flow_seal_flash_frames then
			if (frame_value & 1) == 0 then
				self:add_tag('d.seal.flash')
			else
				self:remove_tag('d.seal.flash')
			end
		elseif frame_value == flow_seal_flash_frames then
			self:remove_tag('d.seal.flash')
		end
		self.castle:apply_seal_timeline_frame(frame_value)
	end
	local apply_death_curtain_frame<const> = function(self, frame_value)
		self.death_curtain_width = (frame_value + 1) * flow_death_curtain_columns_per_frame * room_tile_size
	end
	local on_daemon_finished<const> = function(self)
		self:despawn_daemon_clouds()
		self.events:emit('daemon_appearance_done')
		return '/room'
	end

	fsm_library.register('director', {
		clock_source = clock.frame,
		timelines = {
			[banner_pre_delay_timeline_id] = {
				def = {
					frames = timeline.range(flow_banner_prewait_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
					tracks = {
						{
							kind = 'event',
							keys = {
								{ frame = 0, event = banner_prewait_cue_event, direction = 'forward' },
							},
						},
					},
				},
				autoplay = false,
			},
			[banner_world_timeline_id] = {
				def = {
					frames = timeline.range(flow_world_banner_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
					tracks = {
						{
							kind = 'event',
							keys = {
								{ frame = 0, event = banner_world_show_event, direction = 'forward' },
							},
						},
					},
				},
				autoplay = false,
			},
			[banner_castle_timeline_id] = {
				def = {
					frames = timeline.range(flow_castle_banner_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
					tracks = {
						{
							kind = 'event',
							keys = {
								{ frame = 0, event = banner_castle_show_event, direction = 'forward' },
							},
						},
					},
				},
				autoplay = false,
			},
			[title_start_wait_timeline_id] = {
				def = {
					frames = timeline.range(flow_title_start_wait_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
				},
				autoplay = false,
			},
			[room_switch_wait_timeline_id] = {
				def = {
					frames = timeline.range(flow_room_switch_wait_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
				},
				autoplay = false,
			},
			[death_curtain_timeline_id] = {
				def = {
					frames = timeline.range(flow_death_curtain_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
					apply = apply_death_curtain_frame,
				},
				autoplay = false,
			},
			[death_screen_timeline_id] = {
				def = {
					frames = timeline.range(flow_death_screen_frames),
					playback_mode = 'once',
					clock_source = timeline_clock_source.frame,
				},
				autoplay = false,
			},
			[daemon_timeline_id] = {
				def = {
					frames = timeline.range(flow_daemon_appearance_frames),
					playback_mode = 'once',
					apply = apply_daemon_frame,
				},
				autoplay = false,
			},
		},
		initial = 'boot',
		-- Root handlers own game-flow requests that apply from every director state.
		on = {
			['enter_world_start'] = {
				emitter = 'pietolon',
				go = '/world_transition/enter',
			},
			['world_leave_transition_start'] = '/world_transition/leave',
			['enter_shrine_start'] = {
				emitter = 'pietolon',
				go = '/shrine',
			},
			['seal_dissolution_start'] = '/seal_dissolution',
			['story_start'] = '/story',
			['ending_start'] = '/ending',
			['victory_dance_start'] = '/victory_dance',
			['dying'] = {
				emitter = 'pietolon',
				go = '/death',
			},
			['room.switched'] = {
				emitter = 'pietolon',
				go = function(self, _state, event)
					self.events:emit('room_state.sync')
					if not room_switch_passthrough_dirs[event.dir] then
						return '/room_switch_wait'
					end
				end,
			},
		},
		states = {
			boot = {
				entering_state = function(self)
					if self.boot_mode == 'title_screen' then
						return '/title_screen'
					end
					return '/room'
				end,
			},
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
					-- LITHOGRAPH — room-local. Handled here (not on root) because
					-- lithographs are only reachable from the room state via
					-- a tile interaction in 'pietolon'.
					['lithograph.request'] = {
						emitter = 'pietolon',
						go = function(self, _state, event)
							self:set_active_space('lithograph')
							-- Single broadcast with payload (lines). No separate 'lithograph.open'.
							self.events:emit('lithograph', { lines = { event.text_line } })
							return '/lithograph'
						end,
					},
				},
				input_event_handlers = {
					{
						pattern = 'pause[jp]',
						go = '/pause',
					},
					{
						pattern = 'lb[jp] || rb[jp]',
						go = function(self)
							self.events:emit('f1')
							return '/item_screen'
						end,
					},
				},
			},
			pause = {
				entering_state = director.enter_pause,
				exiting_state = director.leave_pause,
				input_event_handlers = {
					{ pattern = 'pause[jp]', go = '/room' },
				},
			},
			room_switch_wait = {
				timelines = {
					[room_switch_wait_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_finished = '/room',
					},
				},
				entering_state = director.begin_black_wait,
			},
			-- World entry and exit retain one suspension lifetime across player
			-- motion, banner presentation, emergence, and the final visible wait.
			-- Child-to-child transitions therefore never resume gameplay between
			-- phases; leaving this compound state releases the clock once.
			world_transition = {
				entering_state = function()
					world:set_gameplay_clock_running(false)
				end,
				exiting_state = function()
					world:set_gameplay_clock_running(true)
				end,
				states = {
					enter = {
						entering_state = director.begin_world_transition,
						on = {
							['world_banner_requested'] = function(self, _state, event)
								self.banner_world_number = event.world_number
								return '/world_transition/world_prewait'
							end,
						},
					},
					leave = {
						entering_state = director.begin_world_transition,
						on = {
							['room.switched'] = '/world_transition/castle_emerge_showing',
						},
					},
					world_prewait = {
						timelines = {
							[banner_pre_delay_timeline_id] = {
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = '/world_transition/world_showing',
							},
						},
					},
					world_showing = {
						on = {
							[banner_world_show_event] = function(self)
								self:enter_transition('transition', self:banner_lines('world_banner', self.banner_world_number))
							end,
						},
						timelines = {
							[banner_world_timeline_id] = {
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = director.finish_world_banner_transition,
							},
						},
						tags = { 'd.bt' },
					},
					castle_emerge_showing = {
						on = {
							[banner_castle_show_event] = function(self)
								self:enter_transition('transition', self:banner_lines('castle_banner', 0))
							end,
						},
						timelines = {
							[banner_castle_timeline_id] = {
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = director.finish_castle_emerge_banner_transition,
							},
						},
						tags = { 'd.bt' },
					},
					emerge = {
						entering_state = function(self)
							self:set_active_space('main')
						end,
						on = {
							['world_emerge_done'] = {
								emitter = 'pietolon',
								go = '/world_transition/room_switch_wait_visible',
							},
						},
					},
					room_switch_wait_visible = {
						timelines = {
							[room_switch_wait_timeline_id] = {
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = '/room',
							},
						},
						entering_state = function(self)
							self:set_active_space('main')
						end,
					},
				},
			},
			-- SHRINE — three-phase compound state (entering → overlay → exiting).
			-- The shrine transition begins in 'main' space (player walks in),
			-- switches to 'shrine' space for the overlay text, then back to
			-- 'main' for the exit animation before returning to room.
			shrine = {
				entering_state = function()
					world:set_gameplay_clock_running(false)
				end,
				exiting_state = function()
					world:set_gameplay_clock_running(true)
				end,
				initial = 'entering',
				states = {
					entering = {
						entering_state = function(self)
							self:set_active_space('main')
						end,
						on = {
							['shrine_overlay_requested'] = function(self, _state, event)
								self.shrine_text_lines = event.lines
								return '/shrine/overlay'
							end,
						},
					},
					overlay = {
						-- Single 'shrine' broadcast carries text lines as payload.
						-- The shrine overlay reads event.lines in its own handler.
						entering_state = function(self)
							local lines<const> = self.shrine_text_lines
							self.shrine_text_lines = {}
							self:set_active_space('shrine')
							self.events:emit('shrine', { lines = lines })
						end,
						input_event_handlers = {
							{ pattern = 'down[jp]', go = '/shrine/exiting' },
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
			item_screen = {
				initial = 'opening',
				states = {
					opening = {
						timelines = {
							[item_screen_open_timeline_id] = {
								def = {
									frames = timeline.range(flow_item_screen_wait_frames),
									playback_mode = 'once',
								},
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = '/item_screen/active',
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
							{ pattern = 'start[jp]', go = '/item_screen/halo' },
							{ pattern = 'lb[jp] || rb[jp]', go = '/item_screen/closing' },
						},
						},
						halo = {
							timelines = {
								[item_screen_halo_request_timeline_id] = {
									def = {
										frames = timeline.range(2),
										playback_mode = 'once',
										tracks = {
											{
												kind = 'event',
												keys = {
													{ frame = 1, event = item_screen_halo_request_event, direction = 'forward' },
												},
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
							on = {
								[item_screen_halo_request_event] = function(self)
									self.events:emit('player.halo_trigger')
								end,
								['halo_resolved_in_castle'] = {
									emitter = 'pietolon',
									go = '/halo_teleport',
							},
							['halo_resolved_from_world'] = {
								emitter = 'pietolon',
								go = '/castle_halo_banner',
							},
							['halo_trigger_cancelled'] = '/item_screen/active',
						},
					},
					closing = {
						timelines = {
							[item_screen_close_timeline_id] = {
								def = {
									frames = timeline.range(flow_item_screen_wait_frames),
									playback_mode = 'once',
								},
								autoplay = true,
								stop_on_exit = true,
								play_options = {
									rewind = true,
									snap_to_start = true,
								},
								on_finished = '/room',
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
						on_finished = '/room_switch_wait',
					},
				},
					entering_state = function(self)
						self:enter_transition('halo')
					end,
			},
			castle_halo_banner = {
				on = {
					[banner_castle_show_event] = function(self)
						self:enter_transition('transition', self:banner_lines('castle_banner', 0))
					end,
				},
				timelines = {
					[banner_castle_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
						on_finished = director.finish_castle_halo_banner_transition,
					},
				},
				tags = { 'd.bt' },
			},
			-- MoG state F stops gameplay for the complete flash and dissolve. The
			-- authored seal sequence advances on frame time; this remains distinct
			-- from the game's actual pause state and its player presentation.
			seal_dissolution = {
				timelines = {
					[seal_timeline_id] = {
						def = {
							frames = timeline.range(flow_seal_dissolution_frames),
							playback_mode = 'once',
							clock_source = timeline_clock_source.frame,
							apply = apply_seal_frame,
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = sequence_play_options,
						on_finished = function(self)
							self:remove_tag('d.seal.flash')
							self.events:emit('seal_dissolution_done')
							return '/daemon_appearance'
						end,
					},
				},
				entering_state = function(self)
					self:set_active_space('main')
					self:remove_tag('d.seal.flash')
					world:set_gameplay_clock_running(false)
					self.events:emit('seal_dissolution')
				end,
				exiting_state = function()
					world:set_gameplay_clock_running(true)
				end,
			},
			daemon_appearance = {
				timelines = {
					[daemon_timeline_id] = {
						autoplay = true,
						stop_on_exit = true,
						play_options = sequence_play_options,
						on_finished = on_daemon_finished,
					},
				},
				entering_state = director.start_daemon_appearance,
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
									clock_source = timeline_clock_source.frame,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = '/lithograph/viewing',
							},
						},
					},
					viewing = {
						input_event_handlers = {
							{ pattern = 'b[jp] || x[jp]', go = '/lithograph/closing' },
						},
					},
					closing = {
						timelines = {
							[lithograph_close_timeline_id] = {
								def = {
									frames = timeline.range(1),
									playback_mode = 'once',
									clock_source = timeline_clock_source.frame,
								},
								autoplay = true,
								stop_on_exit = true,
								on_finished = function(self)
									self.events:emit(
										'lithograph_exit_done',
										self.castle:create_room_enter_payload(false)
									)
									return '/room'
								end,
							},
						},
					},
				},
			},
				title_screen = {
					entering_state = function(self)
						self:set_active_space('title')
						self.events:emit('title')
					end,
					on = {
						['title_screen_done'] = {
							emitter = 'title_screen',
							go = '/title_start_wait',
						},
					},
				},
				title_start_wait = {
					timelines = {
						[title_start_wait_timeline_id] = {
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
							on_finished = function(self)
								self.events:emit('title_wait_done')
								return '/room'
							end,
						},
					},
					entering_state = function(self)
						self:set_active_space('transition')
						self.events:emit('title_wait')
					end,
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
					on = { ['death_done'] = '/death_curtain' },
				},
				death_curtain = {
					timelines = {
						[death_curtain_timeline_id] = {
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
							on_finished = '/death_screen',
						},
					},
					entering_state = function(self)
						self.visual_component:set_draw_function(draw_death_curtain)
					end,
					exiting_state = function(self)
						self.visual_component:set_draw_function(nil)
					end,
				},
				death_screen = {
					timelines = {
						[death_screen_timeline_id] = {
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
							on_finished = director.finish_death_restart,
						},
					},
					entering_state = function(self)
						self:enter_transition('death_screen')
						self.castle:begin_death_restart()
					end,
				},
		},
	})
end

local register_director_definition<const> = function()
	prefab.define({
		def_id = 'director',
		class = director,
		components = {
			custom_visual_component.new,
			timeline_component.new,
			fsm_component.factory({ 'director' }),
		},
		defaults = {
			id = 'd',
			player_index = 1,
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_definition = register_director_definition,
}
