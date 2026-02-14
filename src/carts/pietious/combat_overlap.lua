local combat_overlap = {}

local function areas_overlap(a, b)
	return a.right >= b.left and a.left <= b.right and a.bottom >= b.top and a.top <= b.bottom
end

function combat_overlap.classify_player_contact(event, target, player)
	if event.other_collider_local_id == 'sword' then
		return 'sword'
	end
	if event.other_collider_local_id == 'body' then
		if target ~= nil and player ~= nil and player.sword_collider.enabled then
			if areas_overlap(target.collider:get_world_area(), player.sword_collider:get_world_area()) then
				return 'body_with_sword'
			end
		end
		return 'body'
	end
	return nil
end

return combat_overlap
