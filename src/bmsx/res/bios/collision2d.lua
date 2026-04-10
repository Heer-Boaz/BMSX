-- collision2d.lua
-- GEO overlap orchestration for direct pair queries + ECS overlap passes

local collision2d<const> = {}
local round_to_nearest<const> = require('round_to_nearest')

local geo_fix16_scale<const> = 65536
local geo_overlap_instance_bytes<const> = 20
local geo_overlap_pair_bytes<const> = 12
local geo_overlap_result_bytes<const> = 36
local geo_overlap_summary_bytes<const> = 16
local geo_overlap_candidate_param0<const> = sys_geo_overlap_mode_candidate_pairs | sys_geo_overlap_broadphase_none | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_overlap_full_pass_param0<const> = sys_geo_overlap_mode_full_pass | sys_geo_overlap_broadphase_local_bounds_aabb | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_batch_token = 0
local direct_query_contact<const> = {
	normal = { x = 0, y = 0 },
	depth = 0,
	point = { x = 0, y = 0 },
	piece_a = 0,
	piece_b = 0,
	feature_meta = 0,
}

local next_geo_batch_token<const> = function()
	geo_batch_token = geo_batch_token + 1
	if geo_batch_token >= 0x7fffffff then
		geo_batch_token = 1
	end
	return geo_batch_token
end

local stage_geo_overlap_instance<const> = function(collider, batch_token, instance_base)
	if collider._geo_overlap_stage_token == batch_token then
		return
	end
	local instance_addr<const> = instance_base + collider._geo_overlap_instance_index * geo_overlap_instance_bytes
	memwrite(
		instance_addr,
		collider._overlap_geo_shape_ref,
		round_to_nearest(collider._overlap_geo_tx * geo_fix16_scale),
		round_to_nearest(collider._overlap_geo_ty * geo_fix16_scale),
		collider.layer,
		collider.mask
	)
	collider._geo_overlap_stage_token = batch_token
end

local submit_geo_overlap_candidate_batch<const> = function(instance_base, pair_base, result_base, summary_base, instance_count, pair_count)
	memwrite(
		sys_geo_src0,
		instance_base,
		pair_base,
		0,
		result_base,
		summary_base,
		pair_count
	)
	memwrite(
		sys_geo_param0,
		geo_overlap_candidate_param0,
		pair_count,
		geo_overlap_instance_bytes,
		geo_overlap_pair_bytes,
		instance_count
	)
	memwrite(
		sys_geo_cmd,
		sys_geo_cmd_overlap2d_pass,
		sys_geo_ctrl_start
	)
	local current_status = mem[sys_geo_status]
	while (current_status & sys_geo_status_busy) ~= 0 do
		current_status = mem[sys_geo_status]
	end
	if (current_status & sys_geo_status_rejected) ~= 0 or (current_status & sys_geo_status_error) ~= 0 or (current_status & sys_geo_status_done) == 0 then
		error('[collision2d] GEO overlap batch failed (status=' .. tostring(current_status) .. ', fault=' .. tostring(mem[sys_geo_fault]) .. ')')
	end
end

local submit_geo_overlap_full_pass<const> = function(instance_base, result_base, summary_base, instance_count, result_capacity)
	memwrite(
		sys_geo_src0,
		instance_base,
		0,
		0,
		result_base,
		summary_base,
		instance_count
	)
	memwrite(
		sys_geo_param0,
		geo_overlap_full_pass_param0,
		result_capacity,
		geo_overlap_instance_bytes,
		0,
		0
	)
	memwrite(
		sys_geo_cmd,
		sys_geo_cmd_overlap2d_pass,
		sys_geo_ctrl_start
	)
	local current_status = mem[sys_geo_status]
	while (current_status & sys_geo_status_busy) ~= 0 do
		current_status = mem[sys_geo_status]
	end
	if (current_status & sys_geo_status_rejected) ~= 0 or (current_status & sys_geo_status_error) ~= 0 or (current_status & sys_geo_status_done) == 0 then
		error('[collision2d] GEO overlap full pass failed (status=' .. tostring(current_status) .. ', fault=' .. tostring(mem[sys_geo_fault]) .. ')')
	end
end

function collision2d.collect_overlaps(colliders, collider_count, pairs)
	local batch_token<const> = next_geo_batch_token()
	local instance_base<const> = sys_geo_scratch_base

	for i = 1, collider_count do
		local collider<const> = colliders[i]
		collider:get_world_area()
		if collider._overlap_geo_shape_ref == nil then
			error('[collision2d] GEO overlap requires baked collision bin data: ' .. tostring(collider.id))
		end
		collider._geo_overlap_instance_token = batch_token
		collider._geo_overlap_instance_index = i - 1
		stage_geo_overlap_instance(collider, batch_token, instance_base)
	end

	local max_pair_count<const> = math.floor((collider_count * (collider_count - 1)) / 2)
	local scratch_for_results<const> = sys_geo_scratch_size - collider_count * geo_overlap_instance_bytes - geo_overlap_summary_bytes
	if scratch_for_results < geo_overlap_result_bytes then
		error('[collision2d] GEO overlap scratch overflow (instances=' .. tostring(collider_count) .. ')')
	end
	local result_capacity<const> = math.min(max_pair_count, math.floor(scratch_for_results / geo_overlap_result_bytes))
	local result_base<const> = instance_base + collider_count * geo_overlap_instance_bytes
	local summary_base<const> = result_base + result_capacity * geo_overlap_result_bytes
	submit_geo_overlap_full_pass(instance_base, result_base, summary_base, collider_count, result_capacity)

	local result_count<const> = mem[summary_base + 0]
	for i = 0, result_count - 1 do
		local result_addr<const> = result_base + i * geo_overlap_result_bytes
		local pair_meta<const> = mem[result_addr + 32]
		local instance_a_index<const> = math.floor(pair_meta / 0x10000)
		local instance_b_index<const> = pair_meta % 0x10000
		if instance_a_index < 0 or instance_a_index >= collider_count or instance_b_index <= instance_a_index or instance_b_index >= collider_count then
			error('[collision2d] GEO overlap returned invalid pair meta ' .. tostring(pair_meta))
		end
		local pair<const> = pairs:get(i + 1)
		local a<const> = colliders[instance_a_index + 1]
		local b<const> = colliders[instance_b_index + 1]
		pair.a = a
		pair.b = b
		pair.hit = true
		pair.geo_pair_index = -1
		local contact = pair.contact
		local contact_other = pair.contact_other
		if contact == nil then
			contact = {
				normal = { x = 0, y = 0 },
				depth = 0,
				point = { x = 0, y = 0 },
				piece_a = 0,
				piece_b = 0,
				feature_meta = 0,
			}
			contact_other = {
				normal = { x = 0, y = 0 },
				depth = 0,
				point = { x = 0, y = 0 },
				piece_a = 0,
				piece_b = 0,
				feature_meta = 0,
			}
			pair.contact = contact
			pair.contact_other = contact_other
		end
		local normal_x<const> = fix16_to_f32(mem[result_addr + 0])
		local normal_y<const> = fix16_to_f32(mem[result_addr + 4])
		local depth<const> = fix16_to_f32(mem[result_addr + 8])
		local point_x<const> = fix16_to_f32(mem[result_addr + 12])
		local point_y<const> = fix16_to_f32(mem[result_addr + 16])
		local piece_a<const> = mem[result_addr + 20]
		local piece_b<const> = mem[result_addr + 24]
		local feature_meta<const> = mem[result_addr + 28]
		contact.normal.x = normal_x
		contact.normal.y = normal_y
		contact.depth = depth
		contact.point.x = point_x
		contact.point.y = point_y
		contact.piece_a = piece_a
		contact.piece_b = piece_b
		contact.feature_meta = feature_meta
		contact_other.normal.x = -normal_x
		contact_other.normal.y = -normal_y
		contact_other.depth = depth
		contact_other.point.x = point_x
		contact_other.point.y = point_y
		contact_other.piece_a = piece_b
		contact_other.piece_b = piece_a
		contact_other.feature_meta = feature_meta
	end
	return result_count
end

function collision2d.collides(a, b)
	if not a.hittable or not b.hittable then
		return nil
	end
	if a == b then
		error('[collision2d] self overlap query is invalid: ' .. tostring(a.id))
	end
	a:get_world_area()
	b:get_world_area()
	if a._overlap_geo_shape_ref == nil or b._overlap_geo_shape_ref == nil then
		error('[collision2d] GEO overlap requires baked collision bin data: ' .. tostring(a.id) .. ' / ' .. tostring(b.id))
	end
	local batch_token<const> = next_geo_batch_token()
	local instance_base<const> = sys_geo_scratch_base
	local pair_base<const> = instance_base + geo_overlap_instance_bytes * 2
	local result_base<const> = pair_base + geo_overlap_pair_bytes
	local summary_base<const> = result_base + geo_overlap_result_bytes
	a._geo_overlap_instance_token = batch_token
	a._geo_overlap_instance_index = 0
	b._geo_overlap_instance_token = batch_token
	b._geo_overlap_instance_index = 1
	stage_geo_overlap_instance(a, batch_token, instance_base)
	stage_geo_overlap_instance(b, batch_token, instance_base)
	memwrite(
		pair_base,
		0,
		1,
		1
	)
	submit_geo_overlap_candidate_batch(instance_base, pair_base, result_base, summary_base, 2, 1)
	a._overlap_cache_valid = false
	a._world_polys_cache_valid = false
	b._overlap_cache_valid = false
	b._world_polys_cache_valid = false
	if mem[summary_base + 0] == 0 then
		return nil
	end
	local contact<const> = direct_query_contact
	contact.normal.x = fix16_to_f32(mem[result_base + 0])
	contact.normal.y = fix16_to_f32(mem[result_base + 4])
	contact.depth = fix16_to_f32(mem[result_base + 8])
	contact.point.x = fix16_to_f32(mem[result_base + 12])
	contact.point.y = fix16_to_f32(mem[result_base + 16])
	contact.piece_a = mem[result_base + 20]
	contact.piece_b = mem[result_base + 24]
	contact.feature_meta = mem[result_base + 28]
	return contact
end

return collision2d
