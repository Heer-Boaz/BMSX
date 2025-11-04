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

return {
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
				-- print (owner)
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
}
