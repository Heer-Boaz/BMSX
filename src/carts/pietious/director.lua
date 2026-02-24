local constants = require('constants')

local director = {}
director.__index = director

local function room_state_name(room_state)
	local world_number = room_state.world_number or 0
	if world_number ~= 0 then
		if room_state.has_active_seal then
			return 'seal'
		end
		if room_state.daemon_fight_active then
			return 'daemon_fight'
		end
		return 'world'
	end
	return 'castle'
end

function director:emit_state_changed(state_name)
	object('room').events:emit(state_name, {})
	self.events:emit('director.state_changed', {
		state = state_name,
		mode_state = self.mode_state,
		room_state = self.room_state,
		changed_axis = self.changed_axis,
		space = object('ui').space_id,
		transition_kind = self.active_transition_kind,
	})
end

function director:set_mode_state(mode_state)
	self.mode_state = mode_state
	if mode_state == 'room' then
		self.room_state = room_state_name(service('c').current_room)
	end
	self.changed_axis = 'mode'
	self:emit_state_changed(mode_state)
end

function director:set_room_state(room_state)
	if self.room_state == room_state then
		return
	end
	self.room_state = room_state
	self.changed_axis = 'room'
	self:emit_state_changed(room_state)
end

function director:next_room_state_transition(current_room_state)
	if self.mode_state ~= 'room' then
		return
	end
	local next_room_state = room_state_name(service('c').current_room)
	if next_room_state == current_room_state then
		return
	end
	return '../' .. next_room_state
end

function director:activate_spaces()
	add_space('main')
	add_space('transition')
	add_space('shrine')
	add_space('lithograph')
	add_space('item')
	add_space('ui')
end

function director:begin_black_wait(frames)
	self.overlay_mode = nil
	self.overlay_text_lines = {}
	self.transition_frames_left = frames
	set_space('transition')
	object('ui'):set_space('transition')
	self:set_mode_state('transition')
	self.events:emit('transition.mask.play', {})
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
	self.events:emit('banner_requested', {})
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
	self.events:emit('shrine_overlay_requested', {})
end

function director:sync_room_state_from_castle()
	local current_room = service('c').current_room
	self.current_room_number = current_room.room_number
	self.map_id = current_room.map_id
	self.map_x = current_room.map_x
	self.map_y = current_room.map_y
	self.last_room_switch = current_room.last_room_switch
end

function director:open_world_entrance(target)
	local opened = service('c'):begin_open_world_entrance(target)
	self:sync_room_state_from_castle()
	return opened
end

function director:switch_room(direction, player_top, player_bottom)
	local switch = service('c'):switch_room(direction, player_top, player_bottom)
	self:sync_room_state_from_castle()
	return switch
end

function director:enter_world(target)
	local switch = service('c'):enter_world(target)
	self:sync_room_state_from_castle()
	self:expect_room_switch_banner('world_banner', switch.world_number, nil)
	return switch
end

function director:leave_world_to_castle()
	local switch = service('c'):leave_world_to_castle()
	self:sync_room_state_from_castle()
	self:expect_room_switch_banner('castle_banner', 0, 'castle_emerge')
	return switch
end

function director:halo_teleport_to_room_1()
	local from_world = service('c').current_room.world_number ~= 0
	local switch = service('c'):halo_teleport_to_room_1()
	self:sync_room_state_from_castle()
	if from_world then
		self:expect_room_switch_banner('castle_banner', 0, nil)
	else
		self:clear_expected_room_switch_banner()
	end
	return switch
end

function director:perform_halo_teleport(player)
	self.events:emit('halo_transition_start', {})
	local switch = self:halo_teleport_to_room_1()
	player:apply_halo_teleport_arrival(switch, service('c').current_room)
	self.events:emit('halo_transition_done', {})
	return switch
end

function director:bind_events()
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self:sync_room_state_from_castle()
			if self:queue_expected_room_switch_banner_if_any() then
				return
			end
			self.events:emit('room_switched', {})
		end,
	})

	self.events:on({
		event = 'lithograph.request',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(event)
			self.lithograph_text_lines = { event.text_line }
			self.events:emit('lithograph_requested', {})
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
	self.pending_shrine_text_lines = {}
	self.overlay_mode = nil
	self.overlay_text_lines = {}
	self.transition_frames_left = 0
	self.banner_post_action = nil
	self.active_transition_kind = nil
	self.lithograph_text_lines = {}
	self.demon_intro_state = 0
	self.seal_flash_on = false
	self.daemon_smoke_x = {}
	self.daemon_smoke_y = {}
	self.daemon_smoke_t = {}
	self.daemon_smoke_sprite = {}
	self.daemon_smoke_next = 1
	self.current_room_number = 0
	self.map_id = 0
	self.map_x = 5
	self.map_y = 12
	self.last_room_switch = nil
	self.mode_state = nil
	self.room_state = nil
	self.changed_axis = nil
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
					self:sync_room_state_from_castle()
					self.overlay_mode = nil
					self.overlay_text_lines = {}
					object('shrine').lines = {}
					object('lithograph').lines = {}
					self.transition_frames_left = 0
					self.demon_intro_state = 0
					self.seal_flash_on = false
					for i = 1, constants.flow.daemon_cloud_max do
						self.daemon_smoke_t[i] = 0
						self.daemon_smoke_sprite[i] = nil
					end
					local castle_service = service('c')
					set_space('main')
					object('ui'):set_space('main')
						castle_service:restore_active_enemies_after_shrine_transition()
						self:set_mode_state('room')
						self.active_transition_kind = nil
					end,
					on = {
						['room_switched'] = '/room_switch_wait',
						['lithograph_requested'] = '/lithograph_screen_open',
						['banner_requested'] = '/banner_transition',
					},
					input_event_handlers = {
						['lb[jp] || rb[jp]'] = {
							go = function(self)
								self.events:emit('evt.cue.f1', {})
								return '/item_screen_opening'
							end,
						},
					},
				},
			room_state = {
				is_concurrent = true,
				initial = 'unknown',
				states = {
					unknown = {
						run_checks = {
							{
								go = function(self)
									return self:next_room_state_transition('unknown')
								end,
							},
						},
					},
					castle = {
						entering_state = function(self)
							self:set_room_state('castle')
						end,
						run_checks = {
							{
								go = function(self)
									return self:next_room_state_transition('castle')
								end,
							},
						},
					},
					world = {
						entering_state = function(self)
							self:set_room_state('world')
						end,
						run_checks = {
							{
								go = function(self)
									return self:next_room_state_transition('world')
								end,
							},
						},
					},
					seal = {
						entering_state = function(self)
							self:set_room_state('seal')
						end,
						run_checks = {
							{
								go = function(self)
									return self:next_room_state_transition('seal')
								end,
							},
						},
					},
					daemon_fight = {
						entering_state = function(self)
							self:set_room_state('daemon_fight')
						end,
						run_checks = {
							{
								go = function(self)
									return self:next_room_state_transition('daemon_fight')
								end,
							},
						},
					},
				},
			},
			room_switch_wait = {
				entering_state = function(self)
					self.active_transition_kind = 'room_switch'
					self:begin_black_wait(constants.flow.room_switch_wait_frames)
				end,
				tick = function(self)
					self.transition_frames_left = self.transition_frames_left - 1
					if self.transition_frames_left > 0 then
						return
					end
					return '/room'
				end,
			},
				world_transition = {
				entering_state = function(self)
					self.active_transition_kind = 'world'
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
					self.active_transition_kind = 'shrine'
					service('c'):hide_active_enemies_for_shrine_transition()
					set_space('main')
					object('ui'):set_space('main')
				end,
				on = {
					['shrine_overlay_requested'] = '/shrine_overlay',
				},
			},
			banner_transition = {
				entering_state = function(self)
					self.overlay_mode = self.pending_banner_mode
					self.overlay_text_lines = self:banner_lines()
					self.banner_post_action = self.pending_banner_post_action
					if self.overlay_mode == 'world_banner' then
						self.transition_frames_left = constants.flow.world_banner_frames
					else
						self.transition_frames_left = constants.flow.castle_banner_frames
					end
					self.pending_banner_mode = nil
					self.pending_banner_world_number = 0
					self.pending_banner_post_action = nil
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('transition')
					self.events:emit('transition.mask.play', {})
				end,
				tick = function(self)
					self.transition_frames_left = self.transition_frames_left - 1
					if self.transition_frames_left > 0 then
						return
					end
					self.overlay_mode = nil
					self.overlay_text_lines = {}
					if self.banner_post_action == 'castle_emerge' then
						self.banner_post_action = nil
						object('pietolon'):begin_world_emerge_from_door()
						return '/world_transition'
					end
					self.banner_post_action = nil
					return '/room_switch_wait'
				end,
			},
			shrine_overlay = {
				entering_state = function(self)
					self.overlay_mode = 'shrine'
					object('shrine').lines = self.pending_shrine_text_lines
					self.overlay_text_lines = {}
					self.pending_shrine_text_lines = {}
					set_space('shrine')
					object('ui'):set_space('shrine')
					self:set_mode_state('shrine')
				end,
				input_event_handlers = {
					['down[jp]'] = '/shrine_transition_exit',
				},
			},
				shrine_transition_exit = {
					entering_state = function(self)
						self.active_transition_kind = 'shrine'
						self.overlay_mode = nil
						self.overlay_text_lines = {}
						object('shrine').lines = {}
						self.transition_frames_left = constants.flow.room_switch_wait_frames
						set_space('main')
						object('ui'):set_space('main')
						object('pietolon'):leave_shrine_overlay()
					end,
					on = {
						['shrine_exit_done'] = '/room',
					},
					tick = function(self)
						self.transition_frames_left = self.transition_frames_left - 1
						if self.transition_frames_left > 0 then
							return
						end
						return '/room'
					end,
				},
			item_screen_opening = {
				entering_state = function(self)
					self.active_transition_kind = 'item_open'
					self:begin_black_wait(constants.flow.item_screen_wait_frames)
				end,
				tick = function(self)
					self.transition_frames_left = self.transition_frames_left - 1
					if self.transition_frames_left > 0 then
						return
					end
					return '/item_screen'
				end,
			},
				item_screen = {
				entering_state = function(self)
					self.active_transition_kind = 'item'
					set_space('item')
					object('ui'):set_space('item')
					self:set_mode_state('item')
				end,
					input_event_handlers = {
						['start[jp]'] = {
							go = function(_self)
								object('pietolon').abilities:activate('halo')
							end,
						},
						['lb[jp] || rb[jp]'] = {
							go = '/item_screen_closing',
						},
					},
						on = {
							['banner_requested'] = '/banner_transition',
						},
					},
			item_screen_closing = {
				entering_state = function(self)
					self.active_transition_kind = 'item_close'
					self:begin_black_wait(constants.flow.item_screen_wait_frames)
				end,
				tick = function(self)
					self.transition_frames_left = self.transition_frames_left - 1
					if self.transition_frames_left > 0 then
						return
					end
					return '/room'
				end,
			},
			halo_teleport = {
				entering_state = function(self)
					self.active_transition_kind = 'halo'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('halo')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['halo_transition_done'] = '/room_switch_wait',
				},
			},
			seal_dissolution = {
				entering_state = function(self)
					self.active_transition_kind = 'sealfx'
					self.overlay_mode = 'sealfx'
					self.transition_frames_left = 0
					self.demon_intro_state = 1
					self.seal_flash_on = false
					object('pietolon').seal_projectiles_frozen = true
					object('pietolon').events:emit('seal_breaking', {})
					set_space('main')
					object('ui'):set_space('main')
					object('transition'):set_space('main')
					self:set_mode_state('seal_dissolution')
					service('c'):begin_seal_dissolution()
				end,
				on = {
					['seal_dissolution_done'] = {
						go = function(self)
							object('pietolon').seal_projectiles_frozen = false
							object('pietolon').events:emit('seal_broken', {})
							service('c'):finish_seal_dissolution()
							return '/daemon_appearance'
						end,
					},
				},
				tick = function(self)
					self.seal_flash_on = self.demon_intro_state < 32 and (self.demon_intro_state % 4) >= 2
					service('c'):set_seal_dissolve_intro_state(self.demon_intro_state)
					if self.demon_intro_state < 95 then
						self.demon_intro_state = self.demon_intro_state + 1
						return
					end
					self.seal_flash_on = false
					self.events:emit('seal_dissolution_done', {})
				end,
			},
			daemon_appearance = {
				entering_state = function(self)
					self.active_transition_kind = 'daemonfx'
					self.overlay_mode = 'daemonfx'
					self.transition_frames_left = 0
					self.demon_intro_state = 97
					for i = 1, constants.flow.daemon_cloud_max do
						self.daemon_smoke_x[i] = 0
						self.daemon_smoke_y[i] = 0
						self.daemon_smoke_t[i] = 0
						self.daemon_smoke_sprite[i] = nil
					end
					self.daemon_smoke_next = 1
					set_space('main')
					object('ui'):set_space('main')
					object('transition'):set_space('main')
					self:set_mode_state('daemon_appearance')
				end,
				on = {
					['daemon_appearance_done'] = {
						go = function(self)
							object('transition'):set_space('transition')
							service('c'):activate_current_room_daemon_fight()
							return '/room'
						end,
					},
				},
				tick = function(self)
					if self.demon_intro_state > 96 and self.demon_intro_state < 160 and (self.demon_intro_state % 8) < 4 then
						self.daemon_smoke_t[self.daemon_smoke_next] = 1
						self.daemon_smoke_x[self.daemon_smoke_next] = constants.room.tile_origin_x + (math.random(4, 26) * constants.room.tile_size)
						self.daemon_smoke_y[self.daemon_smoke_next] = constants.room.tile_origin_y + (math.random(4, 11) * constants.room.tile_size)
						self.daemon_smoke_sprite[self.daemon_smoke_next] = 'daemon_smoke_small'
						self.daemon_smoke_next = self.daemon_smoke_next + 1
						if self.daemon_smoke_next > constants.flow.daemon_cloud_max then
							self.daemon_smoke_next = 1
						end
					end

					for i = 1, constants.flow.daemon_cloud_max do
						if self.daemon_smoke_t[i] > 0 then
							self.daemon_smoke_t[i] = self.daemon_smoke_t[i] + 1
							if self.daemon_smoke_t[i] >= constants.flow.daemon_cloud_lifetime_frames then
								self.daemon_smoke_t[i] = 0
								self.daemon_smoke_sprite[i] = nil
							elseif (math.modf(self.daemon_smoke_t[i] / 8) % 2) == 0 then
								self.daemon_smoke_sprite[i] = 'daemon_smoke_small'
							else
								self.daemon_smoke_sprite[i] = 'daemon_smoke_large'
							end
						end
					end

					if self.demon_intro_state < 159 then
						self.demon_intro_state = self.demon_intro_state + 1
						return
					end
					self.events:emit('daemon_appearance_done', {})
				end,
			},
			lithograph_screen_open = {
				entering_state = function(self)
					self.active_transition_kind = 'lithograph'
					object('lithograph').lines = self.lithograph_text_lines
					set_space('lithograph')
					object('ui'):set_space('lithograph')
					self:set_mode_state('lithograph')
				end,
				process_input = function(self)
					if action_triggered('b[p] || x[p]', self.player_index) then
						return
					end
					return '/lithograph_screen'
				end,
			},
			lithograph_screen = {
				input_event_handlers = {
					['b[jp] || x[jp]'] = '/lithograph_screen_close',
				},
			},
			lithograph_screen_close = {
				process_input = function(self)
					if action_triggered('b[p] || x[p]', self.player_index) then
						return
					end
					self.lithograph_text_lines = {}
					object('lithograph').lines = {}
					return '/room'
				end,
			},
			title_screen = {
				entering_state = function(self)
					self.active_transition_kind = 'title'
					self.overlay_mode = 'title'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('title')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['title_screen_done'] = '/room',
				},
			},
			story = {
				entering_state = function(self)
					self.active_transition_kind = 'str'
					self.overlay_mode = 'str'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('story')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['story_done'] = '/room',
				},
			},
			ending = {
				entering_state = function(self)
					self.active_transition_kind = 'end'
					self.overlay_mode = 'end'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('ending')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['ending_done'] = '/room',
				},
			},
			victory_dance = {
				entering_state = function(self)
					self.active_transition_kind = 'vd'
					self.overlay_mode = 'vd'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('victory_dance')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['victory_dance_done'] = '/room',
				},
			},
			death = {
				entering_state = function(self)
					self.active_transition_kind = 'ko'
					self.overlay_mode = 'ko'
					set_space('transition')
					object('ui'):set_space('transition')
					self:set_mode_state('death')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['death_done'] = '/room',
				},
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
			space_id = 'ui',
			player_index = 1,
			current_room_number = 0,
			map_id = 0,
			map_x = 5,
			map_y = 12,
			last_room_switch = nil,
			mode_state = nil,
			room_state = nil,
			changed_axis = nil,
			pending_banner_world_number = 0,
			next_room_switch_banner_world_number = 0,
			pending_shrine_text_lines = {},
			overlay_mode = nil,
			overlay_text_lines = {},
			transition_frames_left = 0,
			tick_enabled = true,
		},
	})
end

return {
	director = director,
	define_director_fsm = define_director_fsm,
	register_director_service_definition = register_director_service_definition,
}
