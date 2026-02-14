local constants = require('constants')

local combat_overlap = {}

function combat_overlap.classify_player_contact(event)
	if event.other_layer == constants.collision.projectile_layer and event.other_collider_local_id == 'sword' then
		return 'sword'
	end
	if event.other_layer == constants.collision.player_layer and event.other_collider_local_id == 'body' then
		return 'body'
	end
	return nil
end

return combat_overlap
