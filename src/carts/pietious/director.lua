local constants = require('constants')

local director = {}
director.__index = director

local function room_state_name(room_state)
	if room_state.world_number ~= 0 then
		if room_state.has_active_seal then
			return 'seal'
		end
		return 'world'
	end
	return 'castle'
end

function director:emit_state_changed(state_name)
	self.events:emit('director.state_changed', {
		state = state_name,
		space = object('ui').space_id,
		transition_kind = self.active_transition_kind,
	})
end

function director:item_screen_toggle_pressed()
	local player_index = self.player_index
	return action_triggered('lb[jp]', player_index) or action_triggered('rb[jp]', player_index)
end

function director:lithograph_close_pressed()
	local player_index = self.player_index
	return action_triggered('b[jp]', player_index) or action_triggered('x[jp]', player_index)
end

function director:lithograph_close_held()
	local player_index = self.player_index
	return action_triggered('b[p]', player_index) or action_triggered('x[p]', player_index)
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
	object('ui'):set_space(get_space())
	self:emit_state_changed('transition')
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
	self:dispatch_state_event('banner_requested')
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
	local mode = self.next_room_switch_banner_mode
	if mode == nil then
		return false
	end
	self:queue_banner_transition(
		mode,
		self.next_room_switch_banner_world_number,
		self.next_room_switch_banner_post_action
	)
	self:clear_expected_room_switch_banner()
	return true
end

function director:open_shrine(text_lines)
	self.pending_shrine_text_lines = text_lines
	self:dispatch_state_event('shrine_overlay_requested')
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

function director:halo_teleport_to_start_room()
	local from_world = service('c').current_room.world_number ~= 0
	local switch = service('c'):halo_teleport_to_start_room()
	self:sync_room_state_from_castle()
	if from_world then
		self:expect_room_switch_banner('castle_banner', 0, nil)
	else
		self:clear_expected_room_switch_banner()
	end
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
			self:dispatch_state_event('room_switch_start')
		end,
	})

	self.events:on({
		event = 'timeline.end.p.tl.sx',
		emitter = 'pietolon',
		subscriber = self,
		handler = function()
			self:dispatch_state_event('shrine_transition_done')
		end,
	})

	self.events:on({
		event = 'lithograph.request',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(event)
			self:dispatch_state_event('lithograph_request', {
				text_line = event.text_line,
			})
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
	self.current_room_number = 0
	self.map_id = 0
	self.map_x = 5
	self.map_y = 12
	self.last_room_switch = nil
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
			['daemon_appearance_start'] = '/daemon_appearance',
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
					self.active_transition_kind = nil
					self.overlay_mode = nil
					self.overlay_text_lines = {}
					object('shrine').lines = {}
					object('lithograph').lines = {}
					self.transition_frames_left = 0
						local castle_service = service('c')
						local current_room = castle_service.current_room
						set_space('main')
						object('ui'):set_space(get_space())
						castle_service:restore_active_enemies_after_shrine_transition()
						self:emit_state_changed(room_state_name(current_room))
				end,
				on = {
					['room_switch_start'] = '/room_switch_wait',
					['lithograph_request'] = {
						go = function(self, _state, event)
							self.lithograph_text_lines = { event.text_line }
							return '/lithograph_screen_open'
						end,
					},
				},
				tick = function(self)
					if self.pending_banner_mode ~= nil then
						return '/banner_transition'
					end
					if self:item_screen_toggle_pressed() then
						self.events:emit('evt.cue.f1', {})
						return '/item_screen_opening'
					end
				end,
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
							object('ui'):set_space(get_space())
						end,
				on = {
					['world_transition_done'] = '/room_switch_wait',
					['banner_requested'] = '/banner_transition',
				},
				tick = function(self)
					if self.pending_banner_mode ~= nil then
						return '/banner_transition'
					end
				end,
			},
					shrine_transition_enter = {
						entering_state = function(self)
							self.active_transition_kind = 'shrine'
							service('c'):hide_active_enemies_for_shrine_transition()
							set_space('main')
							object('ui'):set_space(get_space())
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
					object('ui'):set_space(get_space())
					self:emit_state_changed('transition')
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
					object('ui'):set_space(get_space())
					self:emit_state_changed('shrine')
				end,
				on = {
					['shrine_overlay_close_requested'] = '/shrine_transition_exit',
				},
				tick = function(self)
					if action_triggered('down[jp]', self.player_index) then
						self:dispatch_state_event('shrine_overlay_close_requested')
					end
				end,
			},
					shrine_transition_exit = {
						entering_state = function(self)
							self.active_transition_kind = 'shrine'
							self.overlay_mode = nil
							self.overlay_text_lines = {}
						object('shrine').lines = {}
						set_space('main')
						object('ui'):set_space(get_space())
						object('pietolon'):leave_shrine_overlay()
					end,
				on = {
					['shrine_transition_done'] = '/room_switch_wait',
				},
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
					object('ui'):set_space(get_space())
					self:emit_state_changed('item')
				end,
				tick = function(self)
					if self.pending_banner_mode ~= nil then
						return '/banner_transition'
					end
					if action_triggered('start[jp]', self.player_index) and object('pietolon').abilities:activate('halo') then
						return '/room'
					end
					if self:item_screen_toggle_pressed() then
						return '/item_screen_closing'
					end
				end,
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
						object('ui'):set_space(get_space())
					self:emit_state_changed('halo')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['halo_transition_done'] = '/room_switch_wait',
				},
			},
				seal_dissolution = {
					entering_state = function(self)
						self.active_transition_kind = 'seal_dissolution'
						self.overlay_mode = 'seal_dissolution'
						self.transition_frames_left = constants.flow.seal_flash_frames + constants.flow.seal_dissolve_frames
						set_space('transition')
						object('ui'):set_space(get_space())
						self:emit_state_changed('seal_dissolution')
						service('c'):begin_seal_dissolution()
					end,
					on = {
						['seal_dissolution_done'] = {
							go = function(self)
								service('c'):finish_seal_dissolution()
								return '/room'
							end,
						},
					},
					tick = function(self)
						self.transition_frames_left = self.transition_frames_left - 1
						if self.transition_frames_left > 0 then
							return
						end
						self:dispatch_state_event('seal_dissolution_done')
					end,
			},
				daemon_appearance = {
					entering_state = function(self)
						self.active_transition_kind = 'daemon_appearance'
						self.overlay_mode = 'daemon_appearance'
						self.transition_frames_left = constants.flow.daemon_appearance_frames
						set_space('transition')
						object('ui'):set_space(get_space())
						self:emit_state_changed('daemon_appearance')
					end,
					on = {
						['daemon_appearance_done'] = '/room',
					},
					tick = function(self)
						self.transition_frames_left = self.transition_frames_left - 1
						if self.transition_frames_left > 0 then
							return
						end
						self:dispatch_state_event('daemon_appearance_done')
					end,
			},
				lithograph_screen_open = {
					entering_state = function(self)
						self.active_transition_kind = 'lithograph'
						object('lithograph').lines = self.lithograph_text_lines
					set_space('lithograph')
					object('ui'):set_space(get_space())
					self:emit_state_changed('lithograph')
				end,
				tick = function(self)
					if self:lithograph_close_held() then
						return
					end
					return '/lithograph_screen'
				end,
			},
			lithograph_screen = {
				tick = function(self)
					if self:lithograph_close_pressed() then
						return '/lithograph_screen_close'
					end
				end,
				on = {
					['lithograph_screen_done'] = '/room',
				},
			},
			lithograph_screen_close = {
				tick = function(self)
					if self:lithograph_close_held() then
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
					object('ui'):set_space(get_space())
					self:emit_state_changed('title')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['title_screen_done'] = '/room',
				},
			},
			story = {
				entering_state = function(self)
					self.active_transition_kind = 'story'
					self.overlay_mode = 'story'
					set_space('transition')
					object('ui'):set_space(get_space())
					self:emit_state_changed('story')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['story_done'] = '/room',
				},
			},
			ending = {
				entering_state = function(self)
					self.active_transition_kind = 'ending'
					self.overlay_mode = 'ending'
					set_space('transition')
					object('ui'):set_space(get_space())
					self:emit_state_changed('ending')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['ending_done'] = '/room',
				},
			},
			victory_dance = {
				entering_state = function(self)
					self.active_transition_kind = 'victory_dance'
					self.overlay_mode = 'victory_dance'
					set_space('transition')
					object('ui'):set_space(get_space())
					self:emit_state_changed('victory_dance')
					self.events:emit('transition.mask.play', {})
				end,
				on = {
					['victory_dance_done'] = '/room',
				},
			},
				death = {
					entering_state = function(self)
						self.active_transition_kind = 'death'
						self.overlay_mode = 'death'
					set_space('transition')
					object('ui'):set_space(get_space())
					self:emit_state_changed('death')
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
