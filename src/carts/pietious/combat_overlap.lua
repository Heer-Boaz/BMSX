local constants<const> = require('constants')

local combat_overlap<const> = {}

function combat_overlap.classify_player_contact(event)
	if event.other_collider_local_id == 'sword' then
		return 'sword'
	end
	if event.other_collider_local_id == 'body' then
		return 'body'
	end
	if event.other_layer == constants.collision.projectile_layer then
		return 'projectile'
	end
	return nil
end

return combat_overlap
