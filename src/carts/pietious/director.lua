local constants = require('constants')
local world_instance = require('world').instance
local halo_teleport_timeline_id = 'director.halo.transition'
local banner_world_timeline_id = 'director.banner.world'
local banner_castle_timeline_id = 'director.banner.castle'
local room_switch_wait_timeline_id = 'director.wait.room_switch'
local item_screen_open_timeline_id = 'director.wait.item.open'
local item_screen_close_timeline_id = 'director.wait.item.close'
local lithograph_open_timeline_id = 'director.wait.lithograph.open'
local lithograph_close_timeline_id = 'director.wait.lithograph.close'

local director = {}
director.__index = director

function director:activate_spaces()
	add_space('main')
	add_space('transition')
	add_space('shrine')
	add_space('lithograph')
	add_space('item')
	add_space('ui')
end

function director:begin_black_wait()
	self.banner_text_lines = {}
	set_space('transition')
	object('ui'):set_space('transition')
	self.events:emit('transition')
	self.events:emit('transition.mask.play')
end

function director:banner_lines()
	if self.pending_banner_mode == 'world_banner' then
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

function director:spawn_daemon_cloud()
	inst('daemon_cloud', {
		pos = {
			x = constants.room.tile_origin_x + (math.random(constants.flow.daemon_cloud_spawn_x_min, constants.flow.daemon_cloud_spawn_x_max) * constants.room.tile_size),
			y = constants.room.tile_origin_y + (math.random(constants.flow.daemon_cloud_spawn_y_min, constants.flow.daemon_cloud_spawn_y_max) * constants.room.tile_size),
			z = 23,
		},
	})
end

function director:despawn_daemon_clouds()
	for cloud in world_instance:objects({ scope = 'all', reverse = true }) do
		if cloud.daemon_cloud_fx then
			world_instance:despawn(cloud)
		end
	end
end

function director:runcheck_seal_dissolution()
	self.seal_flash_on = self.demon_intro_state < 32 and (self.demon_intro_state % 4) >= 2
	if self.demon_intro_state == 32 then
		self.events:emit('seal_flash_done')
	end
	self.events:emit('seal.step', {
		intro_state = self.demon_intro_state,
	})
	if self.demon_intro_state < 95 then
		self.demon_intro_state = self.demon_intro_state + 1
		return
	end
	self.seal_flash_on = false
	self.events:emit('seal_dissolution_done')
end

function director:runcheck_daemon_appearance()
	if self.demon_intro_state > 96 and self.demon_intro_state < 215 and (self.demon_intro_state % 8) == 0 then
		self:spawn_daemon_cloud()
	end
	if self.demon_intro_state < 222 then
		self.demon_intro_state = self.demon_intro_state + 1
		return
	end
	self.events:emit('daemon_appearance_done')
end

function director:finish_banner_transition()
	self.banner_text_lines = {}
	if self.banner_post_action == 'castle_emerge' then
		self.banner_post_action = nil
		self.events:emit('player.world_emerge')
		return '/world_transition'
	end
	self.banner_post_action = nil
	self.events:emit('world_banner_done')
	return '/room_switch_wait'
end

function director:bind_events()
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
			self.lithograph_text_lines = { event.text_line }
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
	self.pending_shrine_text_lines = {}
	self.banner_text_lines = {}
	self.banner_post_action = nil
	self.lithograph_text_lines = {}
	self.demon_intro_state = 0
	self.seal_flash_on = false
	self:activate_spaces()
	self:bind_events()
end

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
					self.banner_text_lines = {}
					object('shrine').lines = {}
					object('lithograph').lines = {}
						self.demon_intro_state = 0
						self.seal_flash_on = false
						self:despawn_daemon_clouds()
							set_space('main')
							object('ui'):set_space('main')
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
						['lb[jp] || rb[jp]'] = {
							go = function(self)
								self.events:emit('f1')
								return '/item_screen_opening'
							end,
						},
					},
				},
					room_switch_wait = {
					timelines = {
						[room_switch_wait_timeline_id] = {
							create = function()
								return timeline.new({
									id = room_switch_wait_timeline_id,
									frames = timeline.range(constants.flow.room_switch_wait_frames),
									playback_mode = 'once',
								})
							end,
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
						},
					},
						entering_state = director.begin_black_wait,
					on = {
						['timeline.end.' .. room_switch_wait_timeline_id] = '/room',
					},
				},
				world_transition = {
				entering_state = function(self)
					set_space('main')
					object('ui'):set_space('main')
				end,
					on = {
						['world_transition_done'] = '/room_switch_wait',
						['banner_requested'] = '/banner_transition',
					},
				},
				shrine_transition_enter = {
					entering_state = function(self)
						self.events:emit('shrine_transition_enter')
						set_space('main')
						object('ui'):set_space('main')
					end,
				on = {
					['shrine_overlay_requested'] = '/shrine_overlay',
				},
			},
			banner_transition = {
				timelines = {
					[banner_world_timeline_id] = {
						create = function()
							return timeline.new({
								id = banner_world_timeline_id,
								frames = timeline.range(constants.flow.world_banner_frames),
								playback_mode = 'once',
							})
						end,
						autoplay = false,
						stop_on_exit = true,
					},
					[banner_castle_timeline_id] = {
						create = function()
							return timeline.new({
								id = banner_castle_timeline_id,
								frames = timeline.range(constants.flow.castle_banner_frames),
								playback_mode = 'once',
							})
						end,
						autoplay = false,
						stop_on_exit = true,
					},
				},
				tags = { 'd.bt' },
				entering_state = function(self)
					local banner_mode = self.pending_banner_mode
					self.banner_text_lines = self:banner_lines()
					self.banner_post_action = self.pending_banner_post_action
					self.pending_banner_mode = nil
					self.pending_banner_world_number = 0
					self.pending_banner_post_action = nil
					set_space('transition')
					object('ui'):set_space('transition')
					self.events:emit('transition')
					self.events:emit('transition.mask.play')
					local timeline_id = banner_mode == 'world_banner' and banner_world_timeline_id or banner_castle_timeline_id
					self:play_timeline(timeline_id, { rewind = true, snap_to_start = true })
				end,
				on = {
					['timeline.end.' .. banner_world_timeline_id] = {
						go = director.finish_banner_transition,
					},
					['timeline.end.' .. banner_castle_timeline_id] = {
						go = director.finish_banner_transition,
					},
				},
			},
			shrine_overlay = {
				entering_state = function(self)
					object('shrine').lines = self.pending_shrine_text_lines
					self.banner_text_lines = {}
					self.pending_shrine_text_lines = {}
						set_space('shrine')
						object('ui'):set_space('shrine')
						self.events:emit('shrine')
					end,
				input_event_handlers = {
					['down[jp]'] = '/shrine_transition_exit',
				},
			},
					shrine_transition_exit = {
						entering_state = function(self)
							self.banner_text_lines = {}
								object('shrine').lines = {}
								set_space('main')
								object('ui'):set_space('main')
								self.events:emit('player.shrine_overlay_exit')
							end,
						on = {
							['shrine_exit_done'] = '/room',
						},
					},
					item_screen_opening = {
					timelines = {
						[item_screen_open_timeline_id] = {
							create = function()
								return timeline.new({
									id = item_screen_open_timeline_id,
									frames = timeline.range(constants.flow.item_screen_wait_frames),
									playback_mode = 'once',
								})
							end,
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
						},
					},
						entering_state = director.begin_black_wait,
					on = {
						['timeline.end.' .. item_screen_open_timeline_id] = '/item_screen',
					},
				},
					item_screen = {
					entering_state = function(self)
							set_space('item')
							object('ui'):set_space('item')
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
							create = function()
								return timeline.new({
									id = item_screen_close_timeline_id,
									frames = timeline.range(constants.flow.item_screen_wait_frames),
									playback_mode = 'once',
								})
							end,
							autoplay = true,
							stop_on_exit = true,
							play_options = {
								rewind = true,
								snap_to_start = true,
							},
						},
					},
						entering_state = director.begin_black_wait,
					on = {
						['timeline.end.' .. item_screen_close_timeline_id] = '/room',
					},
				},
			halo_teleport = {
				timelines = {
					[halo_teleport_timeline_id] = {
						create = function()
							return timeline.new({
								id = halo_teleport_timeline_id,
								frames = timeline.range(1),
								playback_mode = 'once',
							})
						end,
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
				entering_state = function(self)
						set_space('transition')
						object('ui'):set_space('transition')
						self.events:emit('halo')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['timeline.end.' .. halo_teleport_timeline_id] = '/room_switch_wait',
				},
				},
							seal_dissolution = {
								entering_state = function(self)
									self.demon_intro_state = 1
									self.seal_flash_on = false
									self.events:emit('seal_breaking')
								self.events:emit('seal_dissolution')
							end,
						on = {
							['seal_dissolution_done'] = '/daemon_appearance',
						},
					run_checks = {
						{
							go = director.runcheck_seal_dissolution,
						},
					},
				},
							daemon_appearance = {
								entering_state = function(self)
									self.demon_intro_state = 97
									if self.daemon_appearance_after_death then
										self.daemon_appearance_after_death = false
										self.events:emit('daemon_appearance', { after_death = true })
									else
										self.events:emit('daemon_appearance')
									end
							end,
							on = {
								['daemon_appearance_done'] = {
									go = function(self)
										self:despawn_daemon_clouds()
										return '/room'
									end,
								},
							},
					run_checks = {
						{
							go = director.runcheck_daemon_appearance,
						},
					},
				},
						lithograph_screen_open = {
							timelines = {
								[lithograph_open_timeline_id] = {
									create = function()
										return timeline.new({
											id = lithograph_open_timeline_id,
											frames = timeline.range(1),
											playback_mode = 'once',
										})
									end,
									autoplay = true,
									stop_on_exit = true,
								},
							},
							entering_state = function(self)
									object('lithograph').lines = self.lithograph_text_lines
									set_space('lithograph')
									object('ui'):set_space('lithograph')
									self.events:emit('lithograph')
								end,
							on = {
								['timeline.end.' .. lithograph_open_timeline_id] = '/lithograph_screen',
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
									create = function()
										return timeline.new({
											id = lithograph_close_timeline_id,
											frames = timeline.range(1),
											playback_mode = 'once',
										})
									end,
									autoplay = true,
									stop_on_exit = true,
								},
							},
							entering_state = function(self)
								self.lithograph_text_lines = {}
								object('lithograph').lines = {}
							end,
							on = {
								['timeline.end.' .. lithograph_close_timeline_id] = '/room',
							},
						},
			title_screen = {
				entering_state = function(self)
						set_space('transition')
						object('ui'):set_space('transition')
						self.events:emit('title')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['title_screen_done'] = '/room',
				},
			},
			story = {
				entering_state = function(self)
						set_space('transition')
						object('ui'):set_space('transition')
						self.events:emit('story')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['story_done'] = '/room',
				},
			},
			ending = {
				entering_state = function(self)
						set_space('transition')
						object('ui'):set_space('transition')
						self.events:emit('ending')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['ending_done'] = '/room',
				},
			},
			victory_dance = {
				entering_state = function(self)
						set_space('transition')
						object('ui'):set_space('transition')
						self.events:emit('victory_dance')
						self.events:emit('transition.mask.play')
					end,
				on = {
					['victory_dance_done'] = '/room',
				},
			},
				death = {
					entering_state = function(self)
							set_space('transition')
							object('ui'):set_space('transition')
							self.events:emit('death')
							self.events:emit('transition.mask.play')
							end,
							on = {
								['death_done'] = '/death_resolve',
							},
						},
					death_resolve = {
						entering_state = function(self)
							local restart_daemon = service('c'):resolve_death()
							if restart_daemon then
								self.daemon_appearance_after_death = true
								return '/daemon_appearance'
							end
							service('c'):emit_room_enter()
							return '/room'
						end,
						},
				},
			})
		end

local function register_director_service_definition()
	define_service({
		def_id = 'director',
		class = director,
		fsms = { 'director' },
		auto_activate = true,
			defaults = {
				id = 'd',
				pending_banner_world_number = 0,
				next_room_switch_banner_world_number = 0,
				pending_shrine_text_lines = {},
				banner_text_lines = {},
			},
		})
	end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_service_definition = register_director_service_definition,
}
