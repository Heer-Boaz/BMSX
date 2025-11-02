local FIRE_FRAME_TICKS = 2
local FIRE_FRAMES = { 'vuur1', 'vuur2', 'vuur3', 'vuur4', 'vuur5', 'vuur6', 'vuur7', 'vuur8', 'vuur9', 'vuur10' }

local function fire_state(object)
	return object.lua_instance
end

return {
	id = 'marlies2020_fire',
	states = {
		['#active'] = {
			tape_data = FIRE_FRAMES,
			ticks2advance_tape = FIRE_FRAME_TICKS,
			enable_tape_autotick = true,
			tape_playback_mode = 'loop',
			entering_state = function(object, state)
				object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value or FIRE_FRAMES[1]
			end,
			tape_next = function(object, state)
				object:getcomponentbyid('fire_sprite').imgid = state.current_tape_value
			end,
			tick = function(object)
				local delta = delta_seconds()
				local context = fire_state(object)
				context.life = context.life - delta
				if context.life <= 0 then
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
}
