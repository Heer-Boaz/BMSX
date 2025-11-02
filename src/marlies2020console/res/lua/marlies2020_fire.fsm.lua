local FIRE_FRAME_TICKS = 2
local FIRE_FRAMES = { 'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10' }

return {
	id = 'marlies2020_fire',
	states = {
		['#active'] = {
			tape_data = FIRE_FRAMES,
			ticks2advance_tape = FIRE_FRAME_TICKS,
			enable_tape_autotick = true,
			tape_playback_mode = 'loop',
			entering_state = function(object, state)
				state:reset()
				state.tapehead_position = 0
				object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value
			end,
			tape_next = function(object, state)
				object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value
			end,
			tick = function(object)
				local delta = delta_seconds()
				local fire_state = object:getcomponentbyid('fire_state').vars
				fire_state.life = fire_state.life - delta
				if fire_state.life <= 0 then
					return '../expired'
				end
				object.x = object.x + fire_state.vx * delta
				object.y = object.y + fire_state.vy * delta
				return nil
			end,
		},
		expired = {
			entering_state = function(object)
				remove_fire(object.id)
			end,
			tick = function()
				return '../expired'
			end,
		},
	},
}
