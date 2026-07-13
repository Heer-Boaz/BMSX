require('globals')
local story<const> = require('story')
local stagger<const> = require('stagger')
local world<const> = require('cartlib/world/index').instance

__bmsx_host_test = {}

local effective_depth<const> = function(visual)
	return visual.parent.z + visual.offset.z + visual.draw_offset.z
end

function __bmsx_host_test.ready()
	return oget(director_instance_id) ~= nil and oget(combat_director_instance_id) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = oget(director_instance_id)
	local combat_director<const> = oget(combat_director_instance_id)
	local monster<const> = oget(combat_monster_id)
	local maya_a<const> = oget(combat_maya_a_id)
	local maya_b<const> = oget(combat_maya_b_id)
	local all_out<const> = oget(combat_all_out_id)
	local slash<const> = combat_director.combat_hit_slash_rc
	world:sort_active_visuals()
	assert(effective_depth(monster.sprite_component) < effective_depth(maya_a.sprite_component))
	assert(effective_depth(maya_a.sprite_component) < effective_depth(slash))
	assert(monster.sprite_component._active_visual_index < maya_a.sprite_component._active_visual_index)
	assert(maya_a.sprite_component._active_visual_index < slash._active_visual_index)
	assert(effective_depth(slash) == combat_hit_slash_z)
	assert(combat_director.combat_hit_slash_rc.parent == combat_director)
	assert(effective_depth(all_out.sprite_component) == 800)
	assert(effective_depth(all_out.sprite_component) < effective_depth(director.transition_rc))
	assert(effective_depth(director.transition_rc) == director_visual_z)
	assert(maya_b.z == combat_maya_z)
	assert(oget(text_transition_id).z + oget(text_transition_id).text_component.offset.z == 901)
	assert(oget(text_results_id).z + oget(text_results_id).text_component.offset.z > director_visual_z)
	combat_director:reset_combat_parallax()
	combat_director:activate_combat_parallax_transform()
	assert(monster.sprite_component.draw_offset.y ~= 0 and monster.sprite_component.draw_scale.x ~= 1)
	assert(maya_a.sprite_component.draw_offset.y ~= 0 and maya_a.sprite_component.draw_scale.x ~= 1)
	combat_director:disable_combat_parallax()
	monster.visible = false
	maya_a.visible = false
	local main<const> = oget(text_main_id)
	main:clear_text()
	main.text_component.color = p3_white_color
	stagger.play(director, 'calm', {
		bg = oget(bg_id),
		bg_dim = false,
		text_main = main,
		text_lines = { 'STAGGER FADE' },
		text_typed = false,
	})
	return host.capture('stagger_0')
end

function __bmsx_host_test.update(frame)
	if frame <= 12 then
		return host.capture('stagger_' .. tostring(frame))
	end
	if frame == 13 then
		local combat_director<const> = oget(combat_director_instance_id)
		combat_director.node_id = 'combat_wekker'
		combat_director.combat_node_id = 'combat_wekker'
		combat_director.combat_monster_imgid = story.combat_wekker.monster_imgid
		combat_director.combat_points = 2
		combat_director.sc:switch_state(combat_director_fsm_id, '/combat_results_setup')
		local maya_b<const> = oget(combat_maya_b_id)
		assert(maya_b.visible and maya_b.z == combat_results_maya_z)
		world:sort_active_visuals()
		local director<const> = oget(director_instance_id)
		local results_text<const> = oget(text_results_id).text_component
		assert(director.transition_rc._active_visual_index < maya_b.sprite_component._active_visual_index)
		assert(maya_b.sprite_component._active_visual_index < results_text._active_visual_index)
		assert(effective_depth(director.transition_rc) < effective_depth(maya_b.sprite_component))
		assert(effective_depth(maya_b.sprite_component) < effective_depth(results_text))
		return host.capture('results_0')
	end
	if frame < 48 then
		return host.capture('results_' .. tostring(frame - 13))
	end
	return true
end
