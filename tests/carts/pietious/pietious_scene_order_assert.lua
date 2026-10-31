local registry<const> = require('cartlib/registry')

local scenes<const> = require('cartlib/world/scene_library')

return {
	kind = 'integration',
	tests = {
		authored_order_preserves_roles = function(t)
			t:wait_until('game fixture', function() return registry:get('d') ~= nil end, 120)
			local definition<const> = scenes.definition('pietious.gameplay')
			-- Studio Up/Down changes authored order, not the role of either member.
			local player_member<const> = definition.members_by_id.player
			local hud_member<const> = definition.members_by_id.hud
			scenes.register('pietious.gameplay', { objects = {
				{ member_id = 'hud', definition_id = 'ui', options = hud_member.options },
				{ member_id = 'player', definition_id = 'player', options = player_member.options,
					spatial = { local_transform = player_member.local_transform } },
			} })
			local old_player<const> = registry:get('pietolon')
			new_game()
			local player<const> = registry:get('pietolon')
			local hud<const> = registry:get('ui')
			assert(player ~= old_player and player.definition_id == 'player' and hud.definition_id == 'ui',
			'reordering a scene changed the role of its player or HUD')
			local pose<const> = player.spatial:resolve_world()
			assert(hud.player == player and player.status.spawn_x == pose.wox and player.status.spawn_y == pose.woy,
			'reordering a scene broke construction bindings or its authored spawn anchor')
		end,
	},
}
