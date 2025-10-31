local SCREEN_WIDTH = 256
local SCREEN_HEIGHT = 212
local CORONA_SPEED = 55
local CORONA_FRAME_TICKS = 6
local CORONA_FRAMES = { 'corona1', 'corona2', 'corona3', 'corona2' }

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
			entering_state = function(object, state)
				state:reset()
				state.tapehead_position = 0
				object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(object, state)
				object:getcomponentbyid('corona_sprite').imgid = state.current_tape_value
			end,
			on = {
				dispel = '../despawn',
				['player.win'] = '../despawn',
			},
			tick = function(object)
				object:tickTree('marlies2020_corona_bt')
				local move = object.vars.move
				local delta = delta_seconds()
				object.x = object.x + move.x * CORONA_SPEED * delta
				object.y = object.y + move.y * CORONA_SPEED * delta
				if out_of_bounds(object.x, object.y) then
					return '../despawn'
				end
				return nil
			end,
		},
		despawn = {
			entering_state = function(object)
				remove_corona(object.id)
			end,
			tick = function()
				return '../despawn'
			end,
		},
	},
}
