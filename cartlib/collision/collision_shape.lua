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

return collision_shape
