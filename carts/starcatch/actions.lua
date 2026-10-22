local actioneffects<const> = require('cartlib/actioneffects')

local actions<const> = {}
actions.effect_ids = { 'starcatch.fire', 'starcatch.dash', 'starcatch.hurt' }
actions.input = {
	eval = 'all',
	bindings = {
		{ name = 'fire', on = { hold = 'touch[p] || a[p]' },
			go = { hold = { ['effect.trigger'] = 'starcatch.fire' } } },
		{ name = 'dash', on = { press = 'lb[jp] || b[jp]' },
			go = { press = { ['effect.trigger'] = 'starcatch.dash' } } },
	},
}

function actions.register()
	actioneffects.register_effect('starcatch.fire', {
		cooldown_ms = 125,
		handler = function(ship) ship.game:fire_player(ship) end,
		event = 'starcatch.fired',
	})
	actioneffects.register_effect('starcatch.dash', {
		cooldown_ms = 800,
		can_trigger = function(ship) return ship.game.dash_unlocked end,
		handler = function(ship)
			ship.game.dashes = ship.game.dashes + 1
			ship.timelines:play('dash')
		end,
		event = 'starcatch.dashed',
	})
	actioneffects.register_effect('starcatch.hurt', {
		cooldown_ms = 900,
		can_trigger = function(ship) return ship.dash_shield == 0 end,
		handler = function(ship) ship.game:damage_player(ship) end,
		event = 'starcatch.hurt',
	})
end

return actions
