local SCREEN_WIDTH = 256
local SCREEN_HEIGHT = 212
local CORONA_SPEED = 55
local CORONA_FRAME_TICKS = 6
local CORONA_FRAMES = { 'corona1', 'corona2', 'corona3', 'corona2' }

local function corona_state(object)
	return object.lua_instance
end

local function out_of_bounds(x, y)
	return x < -32 or x > SCREEN_WIDTH + 32 or y < -32 or y > SCREEN_HEIGHT + 32
end

return {
	id = 'marlies2020_corona',
	states = {
		['#patrol'] = {
			tape_data = CORONA_FRAMES,
			ticks2advance_tape = CORONA_FRAME_TICKS,
			enable_tape_autotick = true,
			tape_playback_mode = 'loop',
			markers = {
				{ frame = 0, event = 'corona.behavior.choose_direction' },
				{ frame = 2, event = 'corona.behavior.choose_direction' },
			},
			entering_state = function(object, state)
				object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value or CORONA_FRAMES[1]
			end,
			tape_next = function(object, state)
				object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value
			end,
			on = {
				dispel = '../despawn',
				['player.win'] = '../despawn',
				['corona.behavior.choose_direction'] = {
					['do'] = function(_, state)
						state.target:tickTree('marlies2020_corona_bt')
						return nil
					end,
				},
			},
			tick = function(object)
				local context = corona_state(object)
				local delta = delta_seconds()
				object.x = object.x + context.move_x * CORONA_SPEED * delta
				object.y = object.y + context.move_y * CORONA_SPEED * delta
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
}
