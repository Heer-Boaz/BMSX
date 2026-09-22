local registry<const> = require('cartlib/registry')

local scenes<const> = require('cartlib/world/scene_library')

return {
	kind = 'integration',
	tests = {
		authored_order_preserves_roles = function(t)
			t:wait_until('game fixture', function() return registry:get('d') ~= nil end, 120)
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
		end,
	},
}
