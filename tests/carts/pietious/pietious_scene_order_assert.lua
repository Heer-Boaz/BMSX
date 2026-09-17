local registry<const> = require('cartlib/registry')
local scenes<const> = require('cartlib/world/scene_library')

__bmsx_host_test = {}
function __bmsx_host_test.ready() return registry:get('d') ~= nil end
function __bmsx_host_test.setup()
	local definition<const> = scenes.definition('pietious.gameplay')
	-- Studio Up/Down changes authored order, not the role of either member.
	scenes.register('pietious.gameplay', { objects = { definition.objects[2], definition.objects[1] } })
	local old_player<const> = registry:get('pietolon')
	new_game()
	local player<const> = registry:get('pietolon')
	local hud<const> = registry:get('ui')
	assert(player ~= old_player and player.definition_id == 'player' and hud.definition_id == 'ui',
		'reordering a scene changed the role of its player or HUD')
	assert(hud.player == player and player.status.spawn_x == player.x and player.status.spawn_y == player.y,
		'reordering a scene broke construction bindings or its authored spawn anchor')
end
function __bmsx_host_test.update() return true end
