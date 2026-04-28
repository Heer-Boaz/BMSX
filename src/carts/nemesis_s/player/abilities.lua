local action_effects<const> = require('bios/action_effects')

local player_abilities<const> = {}

player_abilities.effect_ids = {
	fire_salvo = 'fire_salvo',
}

action_effects.register_effect(player_abilities.effect_ids.fire_salvo, {
	id = player_abilities.effect_ids.fire_salvo,
	handler = function(context)
		context.owner:fire_weapon_salvo()
	end,
})

return player_abilities
