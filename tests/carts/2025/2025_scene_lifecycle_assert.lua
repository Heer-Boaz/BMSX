local registry<const> = require('cartlib/registry')
local world<const> = require('cartlib/world/world')
local scene_library<const> = require('cartlib/world/scene_library')
local combat_scene<const> = require('scenes/combat')
local dialogue_scene<const> = require('scenes/dialogue')

__bmsx_host_test = {}
function __bmsx_host_test.ready() return registry:get('p3.director') ~= nil end
function __bmsx_host_test.setup()
	local combat<const> = registry:get('p3.combat.director')
	local monster<const> = combat.monster
	combat:start_combat('combat_wekker', true)
	combat.state_machines:transition_to('/combat_round')
	assert(monster.x == monster.home_x - monster.sx / 2, 'combat ignores its authored anchor')
	combat:start_combat('combat_wekker', true)
	combat.state_machines:transition_to('/combat_round')
	assert(monster.x == monster.home_x - monster.sx / 2, 'combat reentry accumulates offsets')
	world:clear()
	assert(registry:get('p3.combat.monster') == nil, 'clear retains old scene members')
	local edited<const> = scene_library.instantiate(combat_scene.id, {
		monster = { pos = { x = 216, y = 68, z = 205 } },
	})
	assert(edited.monster ~= monster, 'scene admission reused a disposed object')
	assert(edited.monster.home_x == 216 and edited.monster.home_y == 68 and edited.monster.home_z == 205,
		'combat did not retain the authored instance placement')
	local dialogue<const> = scene_library.instantiate(dialogue_scene.id, {
		main = { pos = { x = 40, y = 104, z = 1000 } },
	})
	dialogue.main:set_text('Scene placement', { typed = false })
	assert(dialogue.main.dimensions.left == 40 and dialogue.main.dimensions.top == 104,
		'text layout discarded the scene transform')
	assert(dialogue.main.text_component.offset_y == 0, 'text placement applied twice')
	scene_library.dispose(edited)
	scene_library.dispose(dialogue)
	assert(registry:get('p3.combat.monster') == nil and registry:get('p3.text.main') == nil,
		'scene disposal did not release identities')
	local fresh<const> = scene_library.instantiate(combat_scene.id)
	assert(fresh.monster.home_x == 208 and fresh.monster.home_y == 60,
		'runtime bindings mutated the authored definition')
end
function __bmsx_host_test.update() return true end
