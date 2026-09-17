-- Compare rendered gameplay at equal logical scroll steps. Host-frame numbers
-- also include cartridge loading, whose CPU cost changes with authored content.
local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local steps<const> = { 8, 30, 80 }

__bmsx_host_test = { pose = 1, settle = 0, checks = 0 }

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
end

function __bmsx_host_test.setup()
	registry:get('nemesis_s.director').state_machines:transition_to('/game_start')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	test.checks = test.checks + 1
	assert(test.checks < 2000, 'gameplay scanout scenario timed out')
	local stage<const> = registry:get('nemesis_s.stage')
	if world.active_space_id ~= 'main' or stage == nil then return false end
	if not test.started then
		registry:get('nemesis_s.player.1').body_collider:set_enabled(false)
		test.started = true
	end
	if test.pose > #steps then return true end
	if test.settle > 0 then
		test.settle = test.settle + 1
		if test.settle == 4 then
			return host.capture('gameplay-step-' .. tostring(steps[test.pose]))
		end
		if test.settle == 5 then
			test.pose = test.pose + 1
			test.settle = 0
			world:set_gameplay_clock_running(true)
		end
		return false
	end
	if stage.tile_steps >= steps[test.pose] then
		assert(stage.tile_steps == steps[test.pose], 'missed requested stage step')
		world:set_gameplay_clock_running(false)
		test.settle = 1
	end
	return false
end
