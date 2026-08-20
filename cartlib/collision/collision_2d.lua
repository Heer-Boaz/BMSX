-- collision_2d.lua
-- GEO overlap orchestration for direct pair queries + same-step ECS overlap passes

local collision_2d<const> = {}
local select_sprite_shape_ref<const> = require('cartlib/collision/sprite_shape')
local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')

local geo_overlap_candidate_param0<const> = 0x00000001 | 0x00000000 | 0x00000000 | 0x00000000
local geo_overlap_full_pass_param0<const> = 0x00000002 | 0x00000004 | 0x00000000 | 0x00000000
local geo_overlap_scratch_base<const> = 0x08040000
local geo_overlap_scratch_end<const> = geo_overlap_scratch_base + 0x00080000
local geo_aabb_shape_bytes<const> = 0x00000020
local geo_compound_header_bytes<const> = 0x00000020
local geo_compound_piece_bytes<const> = 0x00000020
local geo_instance_bytes<const> = 0x00000014
local geo_pair_bytes<const> = 0x0000000c
local geo_result_bytes<const> = 0x00000024
local geo_summary_bytes<const> = 0x00000010
struct geo_overlap_aabb_shape
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
	bounds: f32[4]
end

struct geo_overlap_shape_descriptor
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
end

struct geo_overlap_bounds
	left: f32
	top: f32
	right: f32
	bottom: f32
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

local write_geo_bounds<const> = function(address, left, top, right, bottom)
	local bounds<const>: *geo_overlap_bounds = address
	bounds->left = left
	bounds->top = top
	bounds->right = right
	bounds->bottom = bottom
end

-- GEO scratch is a fixed machine resource. Measure variable compound records
-- before staging so writes and result records receive disjoint spans. The pass
-- remains allocation-free; its extra O(n) walk precedes GEO's O(n^2) pair pass.
local geo_shape_bytes<const> = function(collider)
	if collider.shape_ref ~= nil or collider.sprite ~= nil then
		return 0
	end
	local strip<const> = collider.tile_strip
	if strip ~= nil and strip.step_x ~= 0 and strip.step_y ~= 0 then
		return geo_compound_header_bytes
			+ (strip.last_tile - strip.first_tile + 1) * geo_compound_piece_bytes
	end
	return geo_aabb_shape_bytes
end

local measure_geo_shape_bytes<const> = function(colliders, collider_count)
	local byte_count = 0
	for index = 1, collider_count do
		byte_count = byte_count + geo_shape_bytes(colliders[index])
	end
	return byte_count
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
	return shape_addr + geo_aabb_shape_bytes
end

-- Tile-strip collision consumes the same retained endpoints as rendering.
-- Contiguous axis-aligned strips collapse to one AABB. Diagonal strips retain
-- one AABB per tile in a GEO compound so empty space between tiles never hits.
local stage_geo_tile_strip_shape<const> = function(collider, shape_addr)
	local strip<const> = collider.tile_strip
	local first_tile<const> = strip.first_tile
	local last_tile<const> = strip.last_tile
	local step_x<const> = strip.step_x
	local step_y<const> = strip.step_y
	local tile_left = 0
	local tile_top = 0
	local tile_right = strip.tile_width
	local tile_bottom = strip.tile_height
	local local_area<const> = collider.local_area
	if local_area ~= nil then
		tile_left = local_area.left
		tile_top = local_area.top
		tile_right = local_area.right
		tile_bottom = local_area.bottom
	end
	local tile_width<const> = tile_right - tile_left
	local tile_height<const> = tile_bottom - tile_top
	local origin_x<const> = strip.offset_x + strip.draw_offset_x
	local origin_y<const> = strip.offset_y + strip.draw_offset_y
	local first_x<const> = origin_x + first_tile * step_x + tile_left
	local first_y<const> = origin_y + first_tile * step_y + tile_top
	local last_x<const> = origin_x + last_tile * step_x + tile_left
	local last_y<const> = origin_y + last_tile * step_y + tile_top
	local left = first_x
	local top = first_y
	local right = last_x + tile_width
	local bottom = last_y + tile_height
	if last_x < first_x then
		left = last_x
		right = first_x + tile_width
	end
	if last_y < first_y then
		top = last_y
		bottom = first_y + tile_height
	end
	if step_x == 0 or step_y == 0 then
		local shape<const>: *geo_overlap_aabb_shape = shape_addr
		shape->kind = 0x00000001
		shape->data_count = 0x00000004
		shape->data_offset = 0x00000010
		shape->bounds_offset = 0x00000010
		shape->bounds[0] = left
		shape->bounds[1] = top
		shape->bounds[2] = right
		shape->bounds[3] = bottom
		return shape_addr + geo_aabb_shape_bytes
	end

	local tile_count<const> = last_tile - first_tile + 1
	local shape<const>: *geo_overlap_shape_descriptor = shape_addr
	shape->kind = 0x00000004
	shape->data_count = tile_count
	shape->data_offset = 0x00000020
	shape->bounds_offset = 0x00000010
	write_geo_bounds(shape_addr + 0x00000010, left, top, right, bottom)
	local piece_base<const> = shape_addr + geo_compound_header_bytes
	local piece_bounds_base<const> = piece_base + tile_count * 0x00000010
	local tile_x = first_x
	local tile_y = first_y
	for piece_index = 0, tile_count - 1 do
		local piece_addr<const> = piece_base + piece_index * 0x00000010
		local bounds_addr<const> = piece_bounds_base + piece_index * 0x00000010
		local piece<const>: *geo_overlap_shape_descriptor = piece_addr
		piece->kind = 0x00000001
		piece->data_count = 0x00000004
		piece->data_offset = bounds_addr - piece_addr
		piece->bounds_offset = bounds_addr - piece_addr
		write_geo_bounds(
			bounds_addr,
			tile_x,
			tile_y,
			tile_x + tile_width,
			tile_y + tile_height
		)
		tile_x = tile_x + step_x
		tile_y = tile_y + step_y
	end
	return piece_bounds_base + tile_count * 0x00000010
end

local stage_geo_overlap_instance<const> = function(collider, instance_addr, aabb_shape_addr)
	local parent<const> = collider.parent
	local sprite<const> = collider.sprite
	local shape_ref = collider.shape_ref
	local tx
	local ty
	if shape_ref ~= nil then
		tx = parent.x + collider.shape_offset_x
		ty = parent.y + collider.shape_offset_y
	elseif sprite then
		shape_ref = select_sprite_shape_ref(collider, sprite)
		tx = parent.x + sprite.offset_x
		ty = parent.y + sprite.offset_y
	elseif collider.tile_strip then
		shape_ref = aabb_shape_addr
		aabb_shape_addr = stage_geo_tile_strip_shape(collider, aabb_shape_addr)
		tx = parent.x
		ty = parent.y
	else
		shape_ref = aabb_shape_addr
		aabb_shape_addr = stage_geo_aabb_shape(collider, parent, aabb_shape_addr)
		tx = parent.x + collider.shape_offset_x
		ty = parent.y + collider.shape_offset_y
	end
	local instance<const>: *geo_overlap_instance = instance_addr
	instance->shape = shape_ref
	instance->tx = tx
	instance->ty = ty
	instance->layer = collider.layer
	instance->mask = collider.mask
	return aabb_shape_addr
end

local wait_for_geo_completion<const> = function(label)
	repeat
		halt_until_irq
	until *geo_completion_irq_flags ~= 0
	local geo_flags<const> = *geo_completion_irq_flags
	*geo_completion_irq_flags = 0
	if (geo_flags & irq_source.geo_error) ~= 0 then
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

local on_geo_irq<const> = function(source)
	*geo_completion_irq_flags = *geo_completion_irq_flags | source
end

local function init_geo_irq<init>()
	irq.register(irq_source.geo_done, on_geo_irq)
	irq.register(irq_source.geo_error, on_geo_irq)
end
init_geo_irq()

function collision_2d.collect_overlaps(colliders, collider_count, pairs)
	local instance_base<const> = geo_overlap_scratch_base
	local shape_base<const> = instance_base + collider_count * geo_instance_bytes
	local shape_end<const> = shape_base + measure_geo_shape_bytes(colliders, collider_count)
	if shape_end + geo_summary_bytes > geo_overlap_scratch_end then
		error('GEO overlap scratch capacity exceeded')
	end
	local shape_cursor = shape_base
	for i = 1, collider_count do
		local collider<const> = colliders[i]
		local instance_index<const> = i - 1
		shape_cursor = stage_geo_overlap_instance(
			collider,
			instance_base + instance_index * geo_instance_bytes,
			shape_cursor
		)
	end
	local max_pair_count<const> = (collider_count * (collider_count - 1)) // 2
	local scratch_for_results<const> = geo_overlap_scratch_end - shape_end - geo_summary_bytes
	local scratch_result_capacity<const> = scratch_for_results // geo_result_bytes
	local result_capacity = max_pair_count
	if scratch_result_capacity < result_capacity then
		result_capacity = scratch_result_capacity
	end
	local result_base<const> = shape_end
	local summary_base<const> = result_base + result_capacity * geo_result_bytes
	submit_geo_overlap_full_pass(instance_base, result_base, summary_base, collider_count, result_capacity)
	wait_for_geo_completion('overlap full pass')
	return decode_overlap_results(colliders, collider_count, result_base, summary_base, pairs)
end

function collision_2d.collides(a, b)
	local instance_base<const> = geo_overlap_scratch_base
	local shape_base<const> = instance_base + geo_instance_bytes * 2
	local shape_end<const> = shape_base + geo_shape_bytes(a) + geo_shape_bytes(b)
	if shape_end + geo_pair_bytes + geo_result_bytes + geo_summary_bytes > geo_overlap_scratch_end then
		error('GEO direct-overlap scratch capacity exceeded')
	end
	local shape_cursor = shape_base
	shape_cursor = stage_geo_overlap_instance(a, instance_base, shape_cursor)
	shape_cursor = stage_geo_overlap_instance(b, instance_base + geo_instance_bytes, shape_cursor)
	local pair_base<const> = shape_end
	local result_base<const> = pair_base + geo_pair_bytes
	local summary_base<const> = result_base + geo_result_bytes
	local direct_pair<const>: *geo_overlap_pair = pair_base
	direct_pair->instance_a = 0
	direct_pair->instance_b = 1
	direct_pair->meta = 1
	submit_geo_overlap_candidate_batch(
		instance_base,
		pair_base,
		result_base,
		summary_base,
		2,
		1
	)
	local direct_summary<const>: *geo_overlap_summary = summary_base
	if direct_summary.result_count == 0 then
		return nil
	end
	local direct_result<const>: *geo_overlap_result = result_base
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
