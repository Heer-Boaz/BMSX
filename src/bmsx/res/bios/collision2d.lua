-- collision2d.lua
-- GEO overlap orchestration for direct pair queries + ECS overlap passes

local collision2d<const> = {}

local geo_overlap_instance_bytes<const> = 20
local geo_overlap_pair_bytes<const> = 12
local geo_overlap_result_bytes<const> = 36
local geo_overlap_summary_bytes<const> = 16
local geo_overlap_candidate_param0<const> = sys_geo_overlap_mode_candidate_pairs | sys_geo_overlap_broadphase_none | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_overlap_full_pass_param0<const> = sys_geo_overlap_mode_full_pass | sys_geo_overlap_broadphase_local_bounds_aabb | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_irq_mask<const> = irq_geo_done | irq_geo_error
local geo_direct_query_scratch_bytes<const> = geo_overlap_instance_bytes * 2 + geo_overlap_pair_bytes + geo_overlap_result_bytes + geo_overlap_summary_bytes
local geo_direct_instance_base<const> = sys_geo_scratch_base
local geo_direct_pair_base<const> = geo_direct_instance_base + geo_overlap_instance_bytes * 2
local geo_direct_result_base<const> = geo_direct_pair_base + geo_overlap_pair_bytes
local geo_direct_summary_base<const> = geo_direct_result_base + geo_overlap_result_bytes
local geo_overlap_async_base<const> = geo_direct_summary_base + geo_overlap_summary_bytes
local geo_overlap_async_size<const> = sys_geo_scratch_size - geo_direct_query_scratch_bytes
local overlap_state_idle<const> = 0
local overlap_state_busy<const> = 1
local overlap_state_ready<const> = 2
local geo_batch_token = 0
local overlap_query_state
local overlap_query_discard_ready
local overlap_query_result_base
local overlap_query_summary_base
local overlap_query_collider_count = 0
local overlap_query_colliders<const> = {}
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

local unpack_geo_fault<const> = function()
	local fault<const> = mem[sys_geo_fault]
	local fault_u<const> = fault < 0 and (fault + 0x100000000) or fault
	local fault_code<const> = (fault_u >> 16) & 0xffff
	local fault_index<const> = fault_u & 0xffff
	return fault_u, fault_code, fault_index
end

local raise_geo_fault<const> = function(label)
	local fault_u<const>, fault_code<const>, fault_index<const> = unpack_geo_fault()
	error(string.format('GEO %s failed (fault=%08Xh hex=%08Xh code=%04Xh index=%08Xh)', label, fault_u, fault_u, fault_code, fault_index))
end

local ack_geo_irq_if_pending<const> = function()
	local flags<const> = mem[sys_irq_flags]
	local geo_flags<const> = flags & geo_irq_mask
	if geo_flags ~= 0 then
		mem[sys_irq_ack] = geo_flags
	end
end

local mark_overlap_query_idle<const> = function()
	overlap_query_state = overlap_state_idle
end

local mark_overlap_query_busy<const> = function()
	overlap_query_state = overlap_state_busy
end

local mark_overlap_query_ready<const> = function()
	overlap_query_state = overlap_state_ready
end

local clear_overlap_query_discard<const> = function()
	overlap_query_discard_ready = false
end

local mark_overlap_query_discard<const> = function()
	overlap_query_discard_ready = true
end

local clear_overlap_query_buffers<const> = function()
	overlap_query_result_base = 0
	overlap_query_summary_base = 0
end

local stage_geo_overlap_instance<const> = function(collider, batch_token, instance_base)
	if collider._geo_overlap_stage_token == batch_token then
		return
	end
	local instance_addr<const> = instance_base + collider._geo_overlap_instance_index * geo_overlap_instance_bytes
	mem[instance_addr + 0] = collider._overlap_geo_shape_ref
	memf32le[instance_addr + 4] = collider._overlap_geo_tx
	memf32le[instance_addr + 8] = collider._overlap_geo_ty
	mem[instance_addr + 12] = collider.layer
	mem[instance_addr + 16] = collider.mask
	collider._geo_overlap_stage_token = batch_token
end

local wait_for_geo_completion<const> = function(label)
	while true do
		halt_until_irq
		local flags<const> = mem[sys_irq_flags]
		local geo_flags<const> = flags & geo_irq_mask
		if geo_flags ~= 0 then
			mem[sys_irq_ack] = geo_flags
			if (geo_flags & irq_geo_error) ~= 0 then
				raise_geo_fault(label)
			end
			return
		end
		if flags ~= 0 then
			irq(flags)
		end
	end
end

local clear_overlap_query_colliders<const> = function()
	while overlap_query_collider_count > 0 do
		overlap_query_colliders[overlap_query_collider_count] = nil
		overlap_query_collider_count = overlap_query_collider_count - 1
	end
end

local set_overlap_query_colliders<const> = function(colliders, collider_count)
	local previous_count<const> = overlap_query_collider_count
	for i = 1, collider_count do
		overlap_query_colliders[i] = colliders[i]
	end
	for i = collider_count + 1, previous_count do
		overlap_query_colliders[i] = nil
	end
	overlap_query_collider_count = collider_count
end

local ensure_pair_contacts<const> = function(pair)
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
	return contact, contact_other
end

local decode_overlap_results<const> = function(colliders, collider_count, result_base, summary_base, pairs)
	local result_count<const> = mem[summary_base + 0]
	for i = 0, result_count - 1 do
		local result_addr<const> = result_base + i * geo_overlap_result_bytes
		local pair_meta<const> = mem[result_addr + 32]
		local instance_a_index<const> = (pair_meta >> 16) & 0xffff
		local instance_b_index<const> = pair_meta & 0xffff
		if instance_a_index < 0 or instance_a_index >= collider_count or instance_b_index <= instance_a_index or instance_b_index >= collider_count then
			error('GEO overlap returned invalid pair meta ' .. tostring(pair_meta))
		end
		local pair<const> = pairs:get(i + 1)
		local a<const> = colliders[instance_a_index + 1]
		local b<const> = colliders[instance_b_index + 1]
		pair.a = a
		pair.b = b
		pair.hit = true
		pair.geo_pair_index = -1
		local contact<const>, contact_other<const> = ensure_pair_contacts(pair)
		local normal_x<const> = memf32le[result_addr + 0]
		local normal_y<const> = memf32le[result_addr + 4]
		local depth<const> = memf32le[result_addr + 8]
		local point_x<const> = memf32le[result_addr + 12]
		local point_y<const> = memf32le[result_addr + 16]
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

local refresh_overlap_query_state<const> = function()
	if overlap_query_state ~= overlap_state_busy then
		return overlap_query_state
	end
	local status<const> = mem[sys_geo_status]
	if (status & geo_status_busy) ~= 0 then
		return overlap_query_state
	end
	ack_geo_irq_if_pending()
	if (status & geo_status_rejected) ~= 0 or (status & geo_status_error) ~= 0 then
		mark_overlap_query_idle()
		clear_overlap_query_discard()
		raise_geo_fault('overlap full pass')
	end
	if (status & geo_status_done) ~= 0 then
		mark_overlap_query_ready()
		return overlap_query_state
	end
	error('GEO overlap async state lost')
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
	wait_for_geo_completion('overlap batch')
end

local submit_geo_overlap_full_pass_async<const> = function(instance_base, result_base, summary_base, instance_count, result_capacity)
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
	local status<const> = mem[sys_geo_status]
	if (status & geo_status_rejected) ~= 0 or (status & geo_status_error) ~= 0 then
		ack_geo_irq_if_pending()
		raise_geo_fault('overlap full pass')
	end
end

mark_overlap_query_idle()
clear_overlap_query_discard()
clear_overlap_query_buffers()

function collision2d.reset_overlap_pipeline()
	mark_overlap_query_idle()
	clear_overlap_query_discard()
	clear_overlap_query_buffers()
	clear_overlap_query_colliders()
end

function collision2d.invalidate_overlap_pass()
	mark_overlap_query_discard()
end

function collision2d.submit_overlap_pass(colliders, collider_count)
	local state<const> = refresh_overlap_query_state()
	if state ~= overlap_state_idle or collider_count <= 1 then
		return false
	end
	local batch_token<const> = next_geo_batch_token()
	local instance_base<const> = geo_overlap_async_base
	for i = 1, collider_count do
		local collider<const> = colliders[i]
		collider:get_world_area()
		if collider._overlap_geo_shape_ref == nil then
			error('GEO overlap requires baked collision bin data: ' .. tostring(collider.id))
		end
		collider._geo_overlap_instance_token = batch_token
		collider._geo_overlap_instance_index = i - 1
		stage_geo_overlap_instance(collider, batch_token, instance_base)
	end
	local max_pair_count<const> = (collider_count * (collider_count - 1)) // 2
	local scratch_for_results<const> = geo_overlap_async_size - collider_count * geo_overlap_instance_bytes - geo_overlap_summary_bytes
	if scratch_for_results < geo_overlap_result_bytes then
		error('GEO overlap scratch overflow (instances=' .. tostring(collider_count) .. ')')
	end
	local scratch_result_capacity<const> = scratch_for_results // geo_overlap_result_bytes
	local result_capacity<const> = math.min(max_pair_count, scratch_result_capacity)
	local result_base<const> = instance_base + collider_count * geo_overlap_instance_bytes
	local summary_base<const> = result_base + result_capacity * geo_overlap_result_bytes
	set_overlap_query_colliders(colliders, collider_count)
	overlap_query_result_base = result_base
	overlap_query_summary_base = summary_base
	submit_geo_overlap_full_pass_async(instance_base, result_base, summary_base, collider_count, result_capacity)
	mark_overlap_query_busy()
	clear_overlap_query_discard()
	return true
end

function collision2d.consume_overlap_pass(pairs)
	local state<const> = refresh_overlap_query_state()
	if state ~= overlap_state_ready then
		return nil
	end
	mark_overlap_query_idle()
	if overlap_query_discard_ready then
		clear_overlap_query_discard()
		return 0
	end
	return decode_overlap_results(overlap_query_colliders, overlap_query_collider_count, overlap_query_result_base, overlap_query_summary_base, pairs)
end

function collision2d.collides(a, b)
	if not a.hittable or not b.hittable then
		return nil
	end
	if a == b then
		error('self overlap query is invalid: ' .. tostring(a.id))
	end
	a:get_world_area()
	b:get_world_area()
	if a._overlap_geo_shape_ref == nil or b._overlap_geo_shape_ref == nil then
		error('GEO overlap requires baked collision bin data: ' .. tostring(a.id) .. ' / ' .. tostring(b.id))
	end
	local overlap_state<const> = refresh_overlap_query_state()
	if overlap_state == overlap_state_busy then
		wait_for_geo_completion('overlap full pass')
		mark_overlap_query_ready()
	end
	local batch_token<const> = next_geo_batch_token()
	a._geo_overlap_instance_token = batch_token
	a._geo_overlap_instance_index = 0
	b._geo_overlap_instance_token = batch_token
	b._geo_overlap_instance_index = 1
	stage_geo_overlap_instance(a, batch_token, geo_direct_instance_base)
	stage_geo_overlap_instance(b, batch_token, geo_direct_instance_base)
	memwrite(
		geo_direct_pair_base,
		0,
		1,
		1
	)
	submit_geo_overlap_candidate_batch(
		geo_direct_instance_base,
		geo_direct_pair_base,
		geo_direct_result_base,
		geo_direct_summary_base,
		2,
		1
	)
	a._overlap_cache_valid = false
	a._world_polys_cache_valid = false
	b._overlap_cache_valid = false
	b._world_polys_cache_valid = false
	if mem[geo_direct_summary_base + 0] == 0 then
		return nil
	end
	local contact<const> = direct_query_contact
	contact.normal.x = memf32le[geo_direct_result_base + 0]
	contact.normal.y = memf32le[geo_direct_result_base + 4]
	contact.depth = memf32le[geo_direct_result_base + 8]
	contact.point.x = memf32le[geo_direct_result_base + 12]
	contact.point.y = memf32le[geo_direct_result_base + 16]
	contact.piece_a = mem[geo_direct_result_base + 20]
	contact.piece_b = mem[geo_direct_result_base + 24]
	contact.feature_meta = mem[geo_direct_result_base + 28]
	return contact
end

return collision2d
