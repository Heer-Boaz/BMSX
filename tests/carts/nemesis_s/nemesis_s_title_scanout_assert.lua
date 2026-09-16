-- The same poses run against the pre-migration and scene-based cartridges.
-- Only existing FSM/timeline commands are used; no visual implementation is
-- replaced. Paused timelines make each captured frame an exact comparison.
local registry<const> = require('cartlib/registry')
local poses<const> = {
	{ state = '/idle', timeline = 'idle', frame = 0 },
	{ state = '/idle', timeline = 'idle', frame = 8 },
	{ state = '/idle', timeline = 'idle', frame = 12 },
	{ state = '/idle', timeline = 'idle', frame = 0, two_players = true },
	{ state = '/startup/confirmation', timeline = 'confirmation', frame = 0 },
	{ state = '/startup/confirmation', timeline = 'confirmation', frame = 4 },
	{ state = '/startup/hangar_blackout' },
	{ state = '/startup/flight/lift', timeline = 'lift', frame = 4 },
	{ state = '/startup/flight/lift', timeline = 'lift', frame = 49 },
	{ state = '/startup/flight/ignition', timeline = 'ignition', frame = 0 },
	{ state = '/startup/flight/burst_ramp', timeline = 'burst_ramp', frame = 8 },
	{ state = '/startup/flight/burst_hold' },
	{ state = '/startup/flight/burst_cooldown', timeline = 'burst_cooldown', frame = 8 },
	{ state = '/startup/blackout' },
}

__bmsx_host_test = { pose = 0, ticks = 0 }

function __bmsx_host_test.ready()
	return registry:get('nemesis_s.director') ~= nil
end

function __bmsx_host_test.setup()
	registry:get('nemesis_s.director').state_machines:transition_to('/title')
end

function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	if test.ticks == 0 then
		test.pose = test.pose + 1
		if test.pose > #poses then
			return true
		end
		local pose<const> = poses[test.pose]
		local title<const> = registry:get('nemesis_s.title_screen')
		title.state_machines:transition_to(pose.state)
		if pose.two_players then
			title:toggle_player_count()
		end
		if pose.timeline then
			title.timelines:seek('nemesis_s.title_screen.' .. pose.timeline, pose.frame)
		end
		-- Keep the normal World render path live, freezing only authored time.
		title.timelines:set_enabled(false)
	end
	test.ticks = test.ticks + 1
	if test.ticks == 4 then
		test.ticks = 0
		return host.capture('title-pose-' .. tostring(test.pose))
	end
	return false
end
