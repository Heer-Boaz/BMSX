local actioneffects<const> = require('cartlib/actioneffects')
local clock<const> = require('cartlib/clock')
require('constants')

local player_actioneffects<const> = {}

player_actioneffects.effect_ids = {
	fire_salvo = 'fire_salvo',
}

actioneffects.register_effect(player_actioneffects.effect_ids.fire_salvo, {
	period_ms = player_fire_repeat_updates * clock.update_milliseconds(),
	handler = function(owner)
		owner:fire_weapon_salvo()
	end,
})

return player_actioneffects
