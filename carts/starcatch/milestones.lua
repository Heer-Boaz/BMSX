local progression<const> = require('cartlib/progression')

return progression.compile_program({
	rules = {
		{ id = 'dash', on = 'starcatch.enemy_destroyed',
			when_event = { equals = { score = 3 } },
			set = {{ key = 'dash_unlocked', value = true }},
			apply = {{ op = 'unlock_dash' }}, apply_once = true },
		{ id = 'twin', on = 'starcatch.enemy_destroyed',
			when_event = { equals = { score = 6 } },
			set = {{ key = 'twin_cannon', value = true }},
			apply = {{ op = 'unlock_twin' }}, apply_once = true },
		{ id = 'complete', on = 'starcatch.enemy_destroyed',
			when_event = { equals = { score = 12 } },
			set = {{ key = 'complete', value = true }},
			apply = {{ op = 'complete' }}, apply_once = true },
	},
	filters = {},
	handlers = {
		unlock_dash = function(game) game.dash_unlocked = true end,
		unlock_twin = function(game) game.twin_cannon = true end,
		complete = function(game) game.pending_scene = 'won' end,
	},
})
