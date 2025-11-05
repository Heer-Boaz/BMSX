-- consolidated fsms, behavior trees, and component presets for marlies 2020.

do
	local screen_width = 256
	local screen_height = 212
	local corona_speed = 55
	local corona_frame_ticks = 6
	local corona_frames = { 'corona1', 'corona2', 'corona3', 'corona2' }

	local function out_of_bounds(x, y)
		return x < -32 or x > screen_width + 32 or y < -32 or y > screen_height + 32
	end

	register_fsm({
		id = 'marlies2020_corona',
		states = {
			['#patrol'] = {
				tape_data = corona_frames,
				ticks2advance_tape = corona_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				markers = {
					{ frame = 0, event = 'corona.behavior.choose_direction' },
					{ frame = 2, event = 'corona.behavior.choose_direction' },
				},
				entering_state = function(object, state)
					object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value or corona_frames[1]
				end,
				tape_next = function(object, state)
					object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value
				end,
				on = {
					dispel = '../despawn',
					['player.win'] = '../despawn',
					['corona.behavior.choose_direction'] = {
						['do'] = function(_, state)
							state.target:ticktree('marlies2020_corona_bt')
							return nil
						end,
					},
				},
				tick = function(object)
					local context = object
					local delta = delta_seconds()
					object.x = object.x + context.move_x * corona_speed * delta
					object.y = object.y + context.move_y * corona_speed * delta
					if out_of_bounds(object.x, object.y) then
						return '../despawn'
					end
					return nil
				end,
			},
			despawn = {
				entering_state = function(object)
					despawn(object.id)
				end,
				tick = function()
					return '../despawn'
				end,
			},
		},
	})
end

do
	local fire_frame_ticks = 2
	local fire_frames = { 'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10' }

	register_fsm({
		id = 'marlies2020_fire',
		states = {
			['#active'] = {
				tape_data = fire_frames,
				ticks2advance_tape = fire_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				entering_state = function(object, state)
					object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value or fire_frames[1]
				end,
				tape_next = function(object, state)
					object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value
				end,
				tick = function(object)
					local delta = delta_seconds()
					local context = object
					context.life = context.life - delta
					if context.life <= 0 then
						error('test')
						return '../expired'
					end
					object.x = object.x + context.vx * delta
					object.y = object.y + context.vy * delta
					return nil
				end,
			},
			expired = {
				entering_state = function(object)
					despawn(object.id)
				end,
				tick = function()
					return '../expired'
				end,
			},
		},
	})
end

do
	local column_x = { 36, 48, 80, 160, 200 }
	local start_column = 2
	local screen_height = 212
	local player_move_speed = 96
	local player_switch_speed = 140
	local player_frame_ticks = 4

	local player_frames_down = { 'p1', 'p2', 'p3', 'p2' }
	local player_frames_up = { 'p4', 'p5', 'p6', 'p5' }
	local player_frames_switch = { 'p7' }
	local player_frames_hurt = { 'p8', 'p9' }
	local player_frames_win = { 'p10' }

	local function common_events()
		return {
			['player.hurt'] = '../hurt',
			['player.win'] = '../win',
		}
	end

	local function victory_event()
		return {
			['player.win'] = '../win',
		}
	end

	local function can_move_y(column, new_y, going_down)
		if column == 1 then
			return true
		end
		if column < 4 then
			return true
		end
		if going_down then
			return new_y < 44 or new_y >= 80
		end
		return new_y > 104 or new_y <= 80
	end

	register_fsm({
		id = 'marlies2020_player',
		states = {
			['#walk_down'] = {
				tape_data = player_frames_down,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				on = common_events(),
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'down'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_down[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function(owner)
					local horizontal = owner.horizontal_direction
					if horizontal == 'left' then
						return '../switch_left'
					elseif horizontal == 'right' then
						return '../switch_right'
					end

					local vertical = owner.vertical_intent
					if vertical == 'up' then
						return '../walk_up'
					end
					if vertical == 'down' then
						local delta = delta_seconds()
						local next_y = owner.y + player_move_speed * delta
						if can_move_y(owner.column, next_y, true) then
							owner.y = math.min(screen_height - 32, next_y)
						end
					end
					return nil
				end,
			},
			walk_up = {
				tape_data = player_frames_up,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				on = common_events(),
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'up'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_up[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function(owner)
					local context = owner
					local horizontal = context.horizontal_direction
					if horizontal == 'left' then
						return '../switch_left'
					elseif horizontal == 'right' then
						return '../switch_right'
					end

					local vertical = context.vertical_intent
					if vertical == 'down' then
						return '../walk_down'
					end
					if vertical == 'up' then
						local delta = delta_seconds()
						local next_y = owner.y - player_move_speed * delta
						if can_move_y(context.column, next_y, false) then
							owner.y = math.max(4, next_y)
						end
					end
					return nil
				end,
			},
			switch_left = {
				tape_data = player_frames_switch,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				on = common_events(),
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'left'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_switch[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function(owner)
					local context = owner
					local target = context.switch_target
					if not target then
						context.horizontal_direction = nil
						return '../walk_down'
					end
					local delta = delta_seconds()
					local target_x = column_x[target]
					owner.x = owner.x - player_switch_speed * delta
					if owner.x <= target_x then
						owner.x = target_x
						context.column = target
						context.horizontal_direction = nil
						context.switch_target = nil
						context.direction = 'down'
						return '../walk_down'
					end
					return nil
				end,
			},
			switch_right = {
				tape_data = player_frames_switch,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				on = common_events(),
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'right'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_switch[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function(owner)
					local context = owner
					local target = context.switch_target
					if not target then
						context.horizontal_direction = nil
						return '../walk_down'
					end
					local delta = delta_seconds()
					local target_x = column_x[target]
					owner.x = owner.x + player_switch_speed * delta
					if owner.x >= target_x then
						owner.x = target_x
						context.column = target
						context.horizontal_direction = nil
						context.switch_target = nil
						context.direction = 'down'
						return '../walk_down'
					end
					return nil
				end,
			},
			hurt = {
				tape_data = player_frames_hurt,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				on = victory_event(),
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'down'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_hurt[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function(owner)
					local context = owner
					local remaining = context.hurt_remaining
					if not remaining then
						return '../walk_down'
					end
					local updated = remaining - delta_seconds()
					if updated <= 0 then
						context.hurt_remaining = nil
						return '../walk_down'
					end
					context.hurt_remaining = updated
					return nil
				end,
			},
			win = {
				tape_data = player_frames_win,
				ticks2advance_tape = player_frame_ticks,
				enable_tape_autotick = true,
				tape_playback_mode = 'loop',
				entering_state = function(owner, state)
					local context = owner
					context.direction = 'down'
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value or player_frames_win[1]
				end,
				tape_next = function(owner, state)
					owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
				end,
				tick = function()
					return nil
				end,
			},
		},
	})
end

do
	local directions = {
		{ x = -1, y = 0 },
		{ x = 1, y = 0 },
		{ x = 0, y = -1 },
		{ x = 0, y = 1 },
	}

		local function bootstrap(self, blackboard)
			if blackboard:get('ready') then
				return 'SUCCESS'
			end
			blackboard:set('ready', true)
			blackboard:set('index', 1)
			local context = self
			context.move_x = -1
			context.move_y = 0
			return 'SUCCESS'
		end

		local function choose_direction(self, blackboard)
			local choice = math.random(1, #directions)
			blackboard:set('index', choice)
			local selected = directions[choice]
			local context = self
			context.move_x = selected.x
			context.move_y = selected.y
			return 'SUCCESS'
		end

	register_behavior_tree({
		id = 'marlies2020_corona_bt',
		definition = {
			root = {
				type = 'Sequence',
				children = {
					{ type = 'Action', action = bootstrap },
					{ type = 'Action', action = choose_direction },
				},
			},
		},
	})
end

do
	register_component_preset({
		id = 'overlap_trigger',
		build = function(params)
			local id_local = params.id_local or 'overlap_trigger'
			local is_trigger = params.istrigger
			if is_trigger == nil then
				is_trigger = true
			end
			local generate_events = params.generateoverlapevents
			if generate_events == nil then
				generate_events = true
			end
			return {{
				class = 'Collider2DComponent',
				id_local = id_local,
				istrigger = is_trigger,
				generateoverlapevents = generate_events,
				spaceevents = params.spaceevents,
			}}
		end,
	})
end

return true
