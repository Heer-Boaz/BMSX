local collision2d = require('collision2d')

local combat_overlap = {}

combat_overlap.contact_kind = {
	none = 'none',
	sword = 'sword',
	body = 'body',
	body_with_sword_overlap = 'body_with_sword_overlap',
}

local function masks_allow(a_layer, a_mask, b_layer, b_mask)
	return (a_mask & b_layer) ~= 0 and (b_mask & a_layer) ~= 0
end

local function has_enabled_sword_overlap(target, player)
	local target_collider = target.collider
	local sword_collider = player.sword_collider
	if not sword_collider.enabled then
		return false
	end
	if not masks_allow(target_collider.layer, target_collider.mask, sword_collider.layer, sword_collider.mask) then
		return false
	end
	return collision2d.collides(target_collider, sword_collider)
end

function combat_overlap.classify_player_contact(target, event, constants, player)
	if event.other_id ~= 'player.instance' then
		return combat_overlap.contact_kind.none
	end
	if not masks_allow(event.collider_layer, event.collider_mask, event.other_layer, event.other_mask) then
		return combat_overlap.contact_kind.none
	end
	local other_collider_local_id = event.other_collider_local_id
	if other_collider_local_id == 'sword' then
		return combat_overlap.contact_kind.sword
	end
	if other_collider_local_id ~= 'body' then
		return combat_overlap.contact_kind.none
	end
	if has_enabled_sword_overlap(target, player) then
		return combat_overlap.contact_kind.body_with_sword_overlap
	end
	return combat_overlap.contact_kind.body
end

function combat_overlap.has_sword_contact(contact_kind)
	return contact_kind == combat_overlap.contact_kind.sword
		or contact_kind == combat_overlap.contact_kind.body_with_sword_overlap
end

function combat_overlap.has_body_contact(contact_kind)
	return contact_kind == combat_overlap.contact_kind.body
		or contact_kind == combat_overlap.contact_kind.body_with_sword_overlap
end

return combat_overlap
