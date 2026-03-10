local combat_damage = {}

function combat_damage.build_weapon_request(target, target_kind, event, weapon_kind)
	return {
		source_id = event.other_id,
		source_kind = weapon_kind,
		target_id = target.id,
		target_kind = target_kind,
		damage_kind = 'weapon',
		weapon_kind = weapon_kind,
		amount = 1,
		room_number = object('c').current_room_number,
	}
end

function combat_damage.build_applied_result(request, amount_applied, destroyed, reaction)
	return {
		ok = true,
		status = 'applied',
		reason = nil,
		source_id = request.source_id,
		source_kind = request.source_kind,
		target_id = request.target_id,
		target_kind = request.target_kind,
		damage_kind = request.damage_kind,
		weapon_kind = request.weapon_kind,
		amount_attempted = request.amount,
		amount_applied = amount_applied,
		destroyed = destroyed,
		reaction = reaction,
		room_number = request.room_number,
	}
end

function combat_damage.build_rejected_result(request, reason)
	return {
		ok = false,
		status = 'rejected',
		reason = reason,
		source_id = request.source_id,
		source_kind = request.source_kind,
		target_id = request.target_id,
		target_kind = request.target_kind,
		damage_kind = request.damage_kind,
		weapon_kind = request.weapon_kind,
		amount_attempted = request.amount,
		amount_applied = 0,
		destroyed = false,
		reaction = 'none',
		room_number = request.room_number,
	}
end

function combat_damage.resolve(target, request)
	local result = target:apply_damage(request)
	target.events:emit('damage.resolved', result)
	return result
end

return combat_damage
