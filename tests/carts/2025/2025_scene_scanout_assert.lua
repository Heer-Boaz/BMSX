local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local poses<const> = {
	{ node = 'title' },
	{ node = 'klas' },
	{ node = 'vriendin_choice' },
	{ node = 'overgang_monday', timeline = 'overgang', frame = 0 },
	{ node = 'overgang_monday', timeline = 'overgang', frame = 12 },
	{ node = 'overgang_monday', timeline = 'overgang', frame = 24 },
	{ node = 'overgang_monday', timeline = 'overgang', frame = 36 },
	{ combat = '/combat_intro', timeline = 'combat_intro', frame = 0 },
	{ combat = '/combat_intro', timeline = 'combat_intro', frame = 12 },
	{ combat = '/combat_intro', timeline = 'combat_intro', frame = 30 },
	{ combat = '/combat_round' },
	{ combat = '/combat_all_out_prompt', timeline = 'combat_all_out_prompt', frame = 15 },
	{ combat = '/combat_results_setup' },
	{ combat = '/combat_results_setup', timeline = 'combat_results_fade_in', frame = 9 },
	{ combat = '/combat_results_setup', timeline = 'combat_results_fade_in', frame = 17 },
}
return {
	kind = 'integration',
	tests = {
		presentation_poses = function(t)
			t:wait_until('story director', function() return registry:get('p3.director') ~= nil end, 120)
			for index = 1, #poses do
				local pose<const> = poses[index]
				local director<const> = registry:get('p3.director')
				local combat<const> = registry:get('p3.combat.director')
				local owner = director
				if pose.node then
					director.session.node_id = pose.node
					director.state_machines:transition_to('/run_node')
					director.text_main:finish_typing()
				else
					director.state_machines:transition_to('/combat_wait')
					combat:start_combat('combat_wekker', true)
					combat.state_machines:transition_to(pose.combat)
					owner = combat
				end
				if pose.timeline then owner.timelines:seek(pose.timeline, pose.frame) end
				world:set_gameplay_clock_running(false)
				t:wait_ticks(3)
				t:capture('scene-pose-' .. tostring(index))
			end
		end,
	},
}
