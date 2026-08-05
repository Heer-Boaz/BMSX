local actioneffects<const> = require('cartlib/actioneffects')

local player_abilities<const> = {}

player_abilities.effect_ids = {
	fire_salvo = 'fire_salvo',
}

actioneffects.register_effect(player_abilities.effect_ids.fire_salvo, {
	handler = function(owner)
		owner:fire_weapon_salvo()
	end,
})

return player_abilities
