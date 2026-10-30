local shape_geometry<const> = require('cartlib/collision/shape_geometry')
local collision_shape<const> = {}
local bindings<const> = {}

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

-- A packed source owns one immutable binding, shared by image and explicit
-- asset consumers. Capacity covers every reflected descriptor before use.
function collision_shape.bind(asset_address)
	local retained<const> = bindings[asset_address]
	if retained ~= nil then return retained end
	local original<const>, fliph<const>, flipv<const>, fliphv<const> = collision_shape.variant_addresses(asset_address)
	local maximum = shape_geometry.measure(original)
	local bytes = shape_geometry.measure(fliph)
	if bytes > maximum then maximum = bytes end
	bytes = shape_geometry.measure(flipv)
	if bytes > maximum then maximum = bytes end
	bytes = shape_geometry.measure(fliphv)
	if bytes > maximum then maximum = bytes end
	local binding<const> = { original = original, fliph = fliph, flipv = flipv,
		fliphv = fliphv, bytes = maximum }
	bindings[asset_address] = binding
	return binding
end

return collision_shape
