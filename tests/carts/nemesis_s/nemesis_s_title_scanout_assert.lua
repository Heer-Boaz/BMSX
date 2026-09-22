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

return {
	kind = 'integration',
	tests = {
		title_poses = function(t)
			t:wait_until('title director', function() return registry:get('nemesis_s.director') ~= nil end, 120)
			registry:get('nemesis_s.director').state_machines:transition_to('/title')
			local title<const> = registry:get('nemesis_s.title_screen')
			for index, pose in ipairs(poses) do
				title.state_machines:transition_to(pose.state)
				if pose.two_players then title:toggle_player_count() end
				if pose.timeline then title.timelines:seek('nemesis_s.title_screen.' .. pose.timeline, pose.frame) end
				title.timelines:set_enabled(false)
				t:wait_ticks(3)
				t:capture('title-pose-' .. tostring(index))
			end
		end,
	},
}
