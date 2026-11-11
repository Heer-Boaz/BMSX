local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

local fixture<const> = {}

function fixture.start_game(t, player_count)
	t:wait_until('director construction', function()
		return registry:get('nemesis_s.director') ~= nil
	end, 120)
	local director<const> = registry:get('nemesis_s.director')
	if player_count ~= nil then director.player_count = player_count end
	local game_start = false
	director.events:on({
		event = 'game_start',
		once = true,
		handler = function() game_start = true end,
	})
	director.state_machines:transition_to('/game_start')
	t:wait_until('game-start composition', function() return game_start end, 120)
	director.state_machines:transition_to('/gameplay')
	t:wait_until('gameplay composition', function()
		return world.active_space_id == 'main' and director.stage ~= nil and director.players[1] ~= nil
	end, 120)
	local stage<const> = director.stage
	local running<const> = stage.state_machines:bind_state_path('/running')
	t:wait_until('stage boot completed', function()
		return stage.state_machines:matches_state(running)
	end, 120)
	return director, stage, director.players[1]
end

return fixture
