local actioneffects<const> = require('cartlib/actioneffects')
local clock<const> = require('cartlib/clock')
require('constants')

local player_actioneffects<const> = {}

local fire_salvo_effect_id<const> = 'fire_salvo'
player_actioneffects.effect_ids = {
	fire_salvo = fire_salvo_effect_id,
}

-- Effect timing is compiled after world cadence configuration. Static module
-- initialization cannot consume a cart clock whose quantum is not established
-- until the entry point configures the world.
function player_actioneffects.register()
	actioneffects.register_effect(fire_salvo_effect_id, {
		period_ms = player_fire_repeat_updates * clock.gameplay_delta_milliseconds(),
		handler = function(owner)
			owner:fire_weapon_salvo()
		end,
	})
end

return player_actioneffects
