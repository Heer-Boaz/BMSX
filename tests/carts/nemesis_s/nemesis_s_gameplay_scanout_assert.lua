local fixture<const> = require('tests/carts/nemesis_s/fixture')
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local steps<const> = { 8, 30, 80 }

return {
	kind = 'integration',
	tests = {
		gameplay_poses = function(t)
			local _director<const>, stage<const>, player<const> = fixture.start_game(t)
			player.body_collider:set_enabled(false)
			for _, step in ipairs(steps) do
				t:wait_until('stage step ' .. tostring(step), function() return stage.tile_steps >= step end, 2000)
				assert(stage.tile_steps == step, 'missed requested stage step')
				world:set_gameplay_clock_running(false)
				t:wait_ticks(3)
				t:capture('gameplay-step-' .. tostring(step))
				world:set_gameplay_clock_running(true)
			end
		end,
	},
}
