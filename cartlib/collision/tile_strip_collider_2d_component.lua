local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local tile_strip_component<const> = require('cartlib/component/tile_strip_component')

local tile_strip_collider_2d_component<const> = {}
tile_strip_collider_2d_component.__index = tile_strip_collider_2d_component
setmetatable(tile_strip_collider_2d_component, { __index = collider_2d_component })

-- The collider consumes the retained tile range owned by the visual directly.
-- `local_area`, when authored, describes the colliding area within every
-- repeated tile. Axis-aligned strips become one GEO AABB; diagonal strips
-- become an exact compound of tile AABBs without retaining shadow coordinates.
function tile_strip_collider_2d_component.factory(definition)
	local create<const> = collider_2d_component.factory(definition)
	local tile_strip_id_local<const> = definition.tile_strip_id_local
	return function(opts)
		local self<const> = setmetatable(create(opts), tile_strip_collider_2d_component)
		self.tile_strip = opts.parent:get_component(tile_strip_component, tile_strip_id_local)
		return self
	end
end

return tile_strip_collider_2d_component
