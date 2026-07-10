require('globals')
local story<const> = require('story')
local stagger<const> = require('stagger')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return oget(director_instance_id) ~= nil and oget(combat_director_instance_id) ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = oget(director_instance_id)
	local main<const> = oget(text_main_id)
	main:clear_text()
	main.text_color = p3_white_color
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
		oget(director_instance_id).combat_results_maya_visible = false
		return host.capture('results_0')
	end
	if frame < 48 then
		return host.capture('results_' .. tostring(frame - 13))
	end
	return true
end
