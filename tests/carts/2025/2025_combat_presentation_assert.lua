local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')

return {
	kind = 'integration',
	tests = {
		combat_sample_ownership = function(t)
			t:wait_until('combat fixture', function() return registry:get('p3.combat.director') ~= nil end, 120)
			local director<const> = registry:get('p3.director')
			local combat<const> = registry:get('p3.combat.director')
			director.state_machines:transition_to('/combat_wait')
			combat:start_combat('combat_wekker', true)
			local monster<const> = combat.monster
			local spatial<const> = monster.spatial
			local attachment_x<const>, attachment_y<const> = monster.attachment_ox, monster.attachment_oy
			combat.state_machines:transition_to('/combat_hit')
			combat.timelines:seek(combat_hit_timeline_id, combat_hit_stop_frames + 1)
			assert(combat.slash_visual.monster == monster and combat.slash_visual.slash_active
				and combat.slash_visual.slash_thickness > 0, 'hit sampling lost its actual struck visual or slash geometry')
			assert(monster.presentation_xx > 1 and monster.presentation_yy ~= 1,
				'hit sampling discarded squash or depth composition')
			combat.state_machines:transition_to('/combat_dodge')
			combat.timelines:seek(combat_dodge_timeline_id, combat_dodge_anticipation_frames + 1)
			assert(monster.presentation_xx ~= 1 and monster.presentation_yy ~= 1, 'dodge discarded its affine sample')
			combat.state_machines:transition_to('/combat_exchange_hit')
			combat.timelines:seek(combat_exchange_hit_timeline_id, combat_exchange_anticipate_frames + combat_exchange_lunge_frames + 1)
			assert(combat.transition_visual.overlay.blend_color ~= 0 and combat.maya_a.presentation_xx ~= 1,
				'exchange did not publish its blend pass and reaction pose')
			combat.state_machines:transition_to('/combat_all_out')
			combat.timelines:seek(combat_all_out_timeline_id, 5)
			local dx<const>, dy<const> = require('combat').all_out_shake(5)
			assert(combat.all_out.presentation_ox == dx and combat.all_out.presentation_oy == dy,
				'all-out range sampling dropped the screen shake')
			combat.timelines:seek_to_end(combat_all_out_timeline_id)
			assert(combat.all_out.presentation_ox == 0 and combat.all_out.presentation_oy == 0,
				'all-out final sample accumulated displacement')
			assert(monster.spatial == spatial and spatial.ox == 0 and spatial.oy == 0
				and monster.attachment_ox == attachment_x and monster.attachment_oy == attachment_y,
				'presentation changed physical placement or authored attachment')
		end,
		slash_follows_actual_visual = function(t)
			t:wait_until('combat fixture', function() return registry:get('p3.combat.director') ~= nil end, 120)
			local combat<const> = registry:get('p3.combat.director')
			registry:get('p3.director').state_machines:transition_to('/combat_wait')
			combat:start_combat('combat_wekker', true)
			combat.state_machines:transition_to('/combat_hit')
			combat.timelines:seek(combat_hit_timeline_id, combat_hit_stop_frames + 1)
			local monster<const> = combat.monster
			monster.spatial:set_local_affine(1, 0.25, 0.5, 1, 8, 12)
			world:set_gameplay_clock_running(false)
			t:wait_ticks(3)
			t:capture('spatial-squashed-monster-and-local-slash')
			assert(combat.slash_visual.monster.spatial == monster.spatial,
				'slash rebound a coordinate mirror instead of the actual struck visual')
		end,
	},
}
