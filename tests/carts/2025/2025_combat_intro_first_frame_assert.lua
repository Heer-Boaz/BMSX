local registry<const> = require('cartlib/registry')
local director_id<const> = 'p3.director'
local combat_director_id<const> = 'p3.combat.director'
local monster_id<const> = 'p3.combat.monster'

__bmsx_host_test = {}
function __bmsx_host_test.ready()
	return registry:get(director_id) ~= nil and registry:get(combat_director_id) ~= nil and registry:get(monster_id) ~= nil
end
function __bmsx_host_test.setup()
	local director<const> = registry:get(director_id)
	local combat_director<const> = registry:get(combat_director_id)
	director.node_id = 'combat_wekker'
	director.state_machines:transition_to('p3.director.fsm:/combat_wait')
	combat_director:start_combat('combat_wekker', true)
	local monster<const> = registry:get(monster_id)
	__bmsx_host_test.admission_visible = monster.visible
	__bmsx_host_test.admission_scale_x = monster.sprite_component.scale_x
end
function __bmsx_host_test.update()
	local test<const> = __bmsx_host_test
	local monster<const> = registry:get(monster_id)
	assert(not test.admission_visible,
		'combat intro published monster before frame zero; scale=' .. tostring(test.admission_scale_x))
	assert(not monster.visible, 'combat intro first update published monster; scale=' .. tostring(monster.sprite_component.scale_x))
	return true
end
