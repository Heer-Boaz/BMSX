local COLUMN_X = { 36, 48, 80, 160, 200 }
local START_COLUMN = 2
local SCREEN_HEIGHT = 212
local PLAYER_MOVE_SPEED = 96
local PLAYER_SWITCH_SPEED = 140
local PLAYER_FRAME_TICKS = 4

local PLAYER_FRAMES_DOWN = { 'p1', 'p2', 'p3', 'p2' }
local PLAYER_FRAMES_UP = { 'p4', 'p5', 'p6', 'p5' }
local PLAYER_FRAMES_SWITCH = { 'p7' }
local PLAYER_FRAMES_HURT = { 'p8', 'p9' }
local PLAYER_FRAMES_WIN = { 'p10' }

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
			tape_data = PLAYER_FRAMES_DOWN,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			on = common_events(),
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'down'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(owner, state)
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tick = function(owner)
				local vars = owner.vars
				local horizontal = vars.horizontal_direction
				if horizontal == 'left' then
					return '../switch_left'
				elseif horizontal == 'right' then
					return '../switch_right'
				end

				local vertical = vars.vertical_intent
				if vertical == 'up' then
					return '../walk_up'
				end
				if vertical == 'down' then
					local delta = delta_seconds()
					local next_y = owner.y + PLAYER_MOVE_SPEED * delta
					if can_move_y(vars.column, next_y, true) then
						owner.y = math.min(SCREEN_HEIGHT - 32, next_y)
					end
				end
				return nil
			end,
		},
		walk_up = {
			tape_data = PLAYER_FRAMES_UP,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			on = common_events(),
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'up'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(owner, state)
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tick = function(owner)
				local vars = owner.vars
				local horizontal = vars.horizontal_direction
				if horizontal == 'left' then
					return '../switch_left'
				elseif horizontal == 'right' then
					return '../switch_right'
				end

				local vertical = vars.vertical_intent
				if vertical == 'down' then
					return '../walk_down'
				end
				if vertical == 'up' then
					local delta = delta_seconds()
					local next_y = owner.y - PLAYER_MOVE_SPEED * delta
					if can_move_y(vars.column, next_y, false) then
						owner.y = math.max(4, next_y)
					end
				end
				return nil
			end,
		},
		switch_left = {
			tape_data = PLAYER_FRAMES_SWITCH,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			on = common_events(),
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'left'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(owner, state)
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tick = function(owner)
				local vars = owner.vars
				local target = vars.switch_target
				if not target then
					vars.horizontal_direction = nil
					return '../walk_down'
				end
				local delta = delta_seconds()
				local target_x = COLUMN_X[target]
				owner.x = owner.x - PLAYER_SWITCH_SPEED * delta
				if owner.x <= target_x then
					owner.x = target_x
					vars.column = target
					vars.horizontal_direction = nil
					vars.switch_target = nil
					vars.direction = 'down'
					return '../walk_down'
				end
				return nil
			end,
		},
		switch_right = {
			tape_data = PLAYER_FRAMES_SWITCH,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			on = common_events(),
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'right'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(owner, state)
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tick = function(owner)
				local vars = owner.vars
				local target = vars.switch_target
				if not target then
					vars.horizontal_direction = nil
					return '../walk_down'
				end
				local delta = delta_seconds()
				local target_x = COLUMN_X[target]
				owner.x = owner.x + PLAYER_SWITCH_SPEED * delta
				if owner.x >= target_x then
					owner.x = target_x
					vars.column = target
					vars.horizontal_direction = nil
					vars.switch_target = nil
					vars.direction = 'down'
					return '../walk_down'
				end
				return nil
			end,
		},
		hurt = {
			tape_data = PLAYER_FRAMES_HURT,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			on = victory_event(),
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'down'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(owner, state)
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
			end,
			tick = function(owner)
				local vars = owner.vars
				local remaining = vars.hurt_remaining
				if not remaining then
					return '../walk_down'
				end
				local updated = remaining - delta_seconds()
				if updated <= 0 then
					vars.hurt_remaining = nil
					return '../walk_down'
				end
				vars.hurt_remaining = updated
				return nil
			end,
		},
		win = {
			tape_data = PLAYER_FRAMES_WIN,
			ticks2advance_tape = PLAYER_FRAME_TICKS,
			enable_tape_autotick = true,
			entering_state = function(owner, state)
				state:reset()
				state.tapehead_position = 0
				owner.vars.direction = 'down'
				owner:getcomponentbyid('player_sprite').imgid = state.current_tape_value
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
