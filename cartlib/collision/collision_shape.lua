local collision_shape<const> = {}

struct geo_collision_variant_header
	magic: word
	version: word
	original_offset: word
	fliph_offset: word
	flipv_offset: word
	fliphv_offset: word
	reserved0: word
	reserved1: word
end

struct geo_collision_shape_descriptor
	kind: word
	data_count: word
	data_offset: word
	bounds_offset: word
end

struct geo_collision_bounds
	left: f32
	top: f32
	right: f32
	bottom: f32
end

-- Packed collision assets retain four GEO-ready shape descriptors. Callers
-- resolve this header once when binding an asset; overlap submission consumes
-- the selected descriptor address directly.
function collision_shape.variant_addresses(asset_address)
	local variants<const>: *geo_collision_variant_header = asset_address
	return asset_address + variants->original_offset,
		asset_address + variants->fliph_offset,
		asset_address + variants->flipv_offset,
		asset_address + variants->fliphv_offset
end

function collision_shape.bounds(shape_address)
	local shape<const>: *geo_collision_shape_descriptor = shape_address
	local bounds<const>: *geo_collision_bounds = shape_address + shape->bounds_offset
	return bounds->left, bounds->top, bounds->right, bounds->bottom
end

return collision_shape
