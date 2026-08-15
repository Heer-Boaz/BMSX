-- collision_2d.lua
-- GEO overlap orchestration for direct pair queries + same-step ECS overlap passes

local collision_2d<const> = {}
local select_sprite_shape_ref<const> = require('cartlib/collision/sprite_shape')

local irq_geo_error<const> = 0x0010

local geo_overlap_candidate_param0<const> = 0x00000001 | 0x00000000 | 0x00000000 | 0x00000000
local geo_overlap_full_pass_param0<const> = 0x00000002 | 0x00000004 | 0x00000000 | 0x00000000
local geo_direct_query_scratch_bytes<const> = 0x00000020 * 2 + 0x00000014 * 2 + 0x0000000c + 0x00000024 + 0x00000010
local geo_direct_shape_base<const> = 0x08040000
local geo_direct_instance_base<const> = geo_direct_shape_base + 0x00000020 * 2
local geo_direct_pair_base<const> = geo_direct_instance_base + 0x00000014 * 2
local geo_direct_result_base<const> = geo_direct_pair_base + 0x0000000c
local geo_direct_summary_base<const> = geo_direct_result_base + 0x00000024
local geo_overlap_batch_base<const> = geo_direct_summary_base + 0x00000010
local geo_overlap_batch_size<const> = 0x00080000 - geo_direct_query_scratch_bytes
struct geo_overlap_aabb_shape
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
	bounds: f32[4]
end

struct geo_overlap_instance
	shape: word
	tx: f32
	ty: f32
	layer: word
	mask: word
end

struct geo_overlap_pair
	instance_a: word
	instance_b: word
	meta: word
end

struct geo_overlap_result
	nx: f32
	ny: f32
	depth: f32
	px: f32
	py: f32
	piece_a: word
	piece_b: word
	feature_meta: word
	pair_meta: word
end

struct geo_overlap_summary
	result_count: word
	exact_pair_count: word
	broadphase_pair_count: word
	flags: word
end

struct geo_src_registers
	instance_base: word
	pair_base: word
	reserved: word
	result_base: word
	summary_base: word
	count: word
end

struct geo_param_registers
	param0: word
	param1: word
	stride0: word
	stride1: word
	stride2: word
end

bss geo_completion_irq_flags: word
local geo_fault_register<const>: *word = 0x08000060
local geo_cmd_register<const>: *word = 0x0800003c
local direct_query_contact<const> = {
	normal = { x = 0, y = 0 },
	depth = 0,
	point = { x = 0, y = 0 },
	piece_a = 0,
	piece_b = 0,
	feature_meta = 0,
}

local unpack_geo_fault<const> = function()
	local fault<const> = *geo_fault_register
	local fault_u<const> = fault < 0 and (fault + 0x100000000) or fault
	local fault_code<const> = (fault_u >> 0x00000010) & 0x0000ffff
	local fault_index<const> = fault_u & 0x0000ffff
	return fault_u, fault_code, fault_index
end

local raise_geo_fault<const> = function(label)
	local fault_u<const>, fault_code<const>, fault_index<const> = unpack_geo_fault()
	error(string.format('GEO %s failed (fault=%08Xh hex=%08Xh code=%04Xh index=%08Xh)', label, fault_u, fault_u, fault_code, fault_index))
end

local stage_geo_aabb_shape<const> = function(collider, parent, shape_addr)
	local shape<const>: *geo_overlap_aabb_shape = shape_addr
	shape->kind = 0x00000001
	shape->data_count = 0x00000004
	shape->data_offset = 0x00000010
	shape->bounds_offset = 0x00000010
	local local_area<const> = collider.local_area
	if local_area then
		shape->bounds[0] = local_area.left
		shape->bounds[1] = local_area.top
		shape->bounds[2] = local_area.right
		shape->bounds[3] = local_area.bottom
	else
		shape->bounds[0] = 0
		shape->bounds[1] = 0
		shape->bounds[2] = parent.sx
		shape->bounds[3] = parent.sy
	end
	return shape_addr
end

local stage_geo_overlap_instance<const> = function(collider, instance_addr, aabb_shape_addr)
	local parent<const> = collider.parent
	local sprite<const> = collider.sprite
	local shape_ref
	local tx
	local ty
	if sprite then
		shape_ref = select_sprite_shape_ref(collider, sprite)
		tx = parent.x + sprite.offset_x
		ty = parent.y + sprite.offset_y
	else
		shape_ref = stage_geo_aabb_shape(collider, parent, aabb_shape_addr)
		tx = parent.x + collider.shape_offset_x
		ty = parent.y + collider.shape_offset_y
	end
	local instance<const>: *geo_overlap_instance = instance_addr
	instance->shape = shape_ref
	instance->tx = tx
	instance->ty = ty
	instance->layer = collider.layer
	instance->mask = collider.mask
end

local wait_for_geo_completion<const> = function(label)
	repeat
		halt_until_irq
	until *geo_completion_irq_flags ~= 0
	local geo_flags<const> = *geo_completion_irq_flags
	*geo_completion_irq_flags = 0
	if (geo_flags & irq_geo_error) ~= 0 then
		raise_geo_fault(label)
	end
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
	local results<const>: *geo_overlap_result = result_base
	local summary<const>: *geo_overlap_summary = summary_base
	local result_count<const> = summary.result_count
	for i = 0, result_count - 1 do
		local pair_meta<const> = results[i].pair_meta
		local instance_a_index<const> = (pair_meta >> 0x00000010) & 0x0000ffff
		local instance_b_index<const> = pair_meta & 0x0000ffff
		local pair<const> = pairs:get(i + 1)
		local a<const> = colliders[instance_a_index + 1]
		local b<const> = colliders[instance_b_index + 1]
		pair.a = a
		pair.b = b
		local contact<const>, contact_other<const> = ensure_pair_contacts(pair)
		local normal_x<const> = results[i].nx
		local normal_y<const> = results[i].ny
		local depth<const> = results[i].depth
		local point_x<const> = results[i].px
		local point_y<const> = results[i].py
		local piece_a<const> = results[i].piece_a
		local piece_b<const> = results[i].piece_b
		local feature_meta<const> = results[i].feature_meta
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

local submit_geo_overlap_candidate_batch<const> = function(instance_base, pair_base, result_base, summary_base, instance_count, pair_count)
	local src<const>: *geo_src_registers = 0x08000024
	local param<const>: *geo_param_registers = 0x08000048
	src->instance_base = instance_base
	src->pair_base = pair_base
	src->reserved = 0
	src->result_base = result_base
	src->summary_base = summary_base
	src->count = pair_count
	param->param0 = geo_overlap_candidate_param0
	param->param1 = pair_count
	param->stride0 = 0x00000014
	param->stride1 = 0x0000000c
	param->stride2 = instance_count
	*geo_cmd_register = 0x00000022
	wait_for_geo_completion('overlap batch')
end

local submit_geo_overlap_full_pass<const> = function(instance_base, result_base, summary_base, instance_count, result_capacity)
	local src<const>: *geo_src_registers = 0x08000024
	local param<const>: *geo_param_registers = 0x08000048
	src->instance_base = instance_base
	src->pair_base = 0
	src->reserved = 0
	src->result_base = result_base
	src->summary_base = summary_base
	src->count = instance_count
	param->param0 = geo_overlap_full_pass_param0
	param->param1 = result_capacity
	param->stride0 = 0x00000014
	param->stride1 = 0
	param->stride2 = 0
	*geo_cmd_register = 0x00000022
end

function collision_2d.on_geo_irq(source)
	*geo_completion_irq_flags = *geo_completion_irq_flags | source
end

function collision_2d.collect_overlaps(colliders, collider_count, pairs)
	local shape_base<const> = geo_overlap_batch_base
	local instance_base<const> = shape_base + collider_count * 0x00000020
	for i = 1, collider_count do
		local collider<const> = colliders[i]
		local instance_index<const> = i - 1
		stage_geo_overlap_instance(
			collider,
			instance_base + instance_index * 0x00000014,
			shape_base + instance_index * 0x00000020
		)
	end
	local max_pair_count<const> = (collider_count * (collider_count - 1)) // 2
	local scratch_for_results<const> = geo_overlap_batch_size - collider_count * (0x00000020 + 0x00000014) - 0x00000010
	local scratch_result_capacity<const> = scratch_for_results // 0x00000024
	local result_capacity<const> = math.min(max_pair_count, scratch_result_capacity)
	local result_base<const> = instance_base + collider_count * 0x00000014
	local summary_base<const> = result_base + result_capacity * 0x00000024
	submit_geo_overlap_full_pass(instance_base, result_base, summary_base, collider_count, result_capacity)
	wait_for_geo_completion('overlap full pass')
	return decode_overlap_results(colliders, collider_count, result_base, summary_base, pairs)
end

function collision_2d.collides(a, b)
	stage_geo_overlap_instance(a, geo_direct_instance_base, geo_direct_shape_base)
	stage_geo_overlap_instance(b, geo_direct_instance_base + 0x00000014, geo_direct_shape_base + 0x00000020)
	local direct_pair<const>: *geo_overlap_pair = geo_direct_pair_base
	direct_pair->instance_a = 0
	direct_pair->instance_b = 1
	direct_pair->meta = 1
	submit_geo_overlap_candidate_batch(
		geo_direct_instance_base,
		geo_direct_pair_base,
		geo_direct_result_base,
		geo_direct_summary_base,
		2,
		1
	)
	local direct_summary<const>: *geo_overlap_summary = geo_direct_summary_base
	if direct_summary.result_count == 0 then
		return nil
	end
	local direct_result<const>: *geo_overlap_result = geo_direct_result_base
	local contact<const> = direct_query_contact
	contact.normal.x = direct_result.nx
	contact.normal.y = direct_result.ny
	contact.depth = direct_result.depth
	contact.point.x = direct_result.px
	contact.point.y = direct_result.py
	contact.piece_a = direct_result.piece_a
	contact.piece_b = direct_result.piece_b
	contact.feature_meta = direct_result.feature_meta
	return contact
end

return collision_2d
