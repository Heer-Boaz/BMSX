require('constants')

local combat_overlap<const> = {}

function combat_overlap.classify_player_contact(event)
	if event.other_collider_local_id == 'sword' then
		return 'sword'
	end
	if event.other_collider_local_id == 'body' then
		return 'body'
	end
	if event.other_layer == collision_projectile_layer then
		return 'projectile'
	end
	return nil
end

-- A sword strike is an authored attack activation, not an overlap-begin edge.
-- Retaining the last accepted activation on each target makes a continuous
-- contact hit once per strike and also prevents leave/re-enter motion from
-- hitting the same target twice during one strike.
function combat_overlap.admit_weapon_contact(target, event)
	local contact_kind<const> = combat_overlap.classify_player_contact(event)
	if contact_kind == 'projectile' then
		if event.phase == 'begin' then
			return contact_kind
		end
		return nil
	end
	if contact_kind ~= 'sword' then
		return nil
	end
	local strike_id<const> = target.player.sword_strike_id
	if target.last_sword_strike_id == strike_id then
		return nil
	end
	target.last_sword_strike_id = strike_id
	return contact_kind
end

return combat_overlap
