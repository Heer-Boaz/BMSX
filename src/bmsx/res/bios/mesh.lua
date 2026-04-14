-- mesh.lua
-- simple mesh container for system rom

local mesh<const> = {}
mesh.__index = mesh

local vec_slice<const> = function(tbl, step)
	local len<const> = #tbl
	local out<const> = {}
	for i = 1, len, step do
		out[#out + 1] = { tbl[i], tbl[i + 1], tbl[i + 2] }
	end
	return out
end

function mesh.new(opts)
	local self<const> = setmetatable({}, mesh)
	opts = opts or {}
	self.name = (opts.meshname)
	self.positions = opts.positions or {}
	self.texcoords = opts.texcoords or {}
	self.texcoords1 = opts.texcoords1 or {}
	self.colors = opts.colors or {}
	self.normals = opts.normals
	self.tangents = opts.tangents
	self.indices = opts.indices
	self.color = opts.color or { r = 255, g = 255, b = 255, a = 1 }
	self.atlas_id = opts.atlasid or 255
	self.material = opts.material
	self.morphpositions = opts.morphpositions
	self.morphnormals = opts.morphnormals
	self.morphtangents = opts.morphtangents
	self.morphweights = opts.morphweights or {}
	self.jointindices = opts.jointindices
	self.jointweights = opts.jointweights
	self.bounding_center = { 0, 0, 0 }
	self.bounding_radius = 0
	self:update_bounds()
	return self
end

function mesh:vertex_count()
	return math.modf(#self.positions / 3)
end

function mesh:has_texcoords()
	return #self.texcoords >= self:vertex_count() * 2
end

function mesh:has_normals()
	return self.normals and #self.normals >= self:vertex_count() * 3
end

function mesh:update_bounds()
	if #self.positions < 3 then
		self.bounding_center = { 0, 0, 0 }
		self.bounding_radius = 0
		return
	end

	local minx, miny, minz = math.huge, math.huge, math.huge
	local maxx, maxy, maxz = -math.huge, -math.huge, -math.huge

	for i = 1, #self.positions, 3 do
		local x<const>, y<const>, z<const> = self.positions[i], self.positions[i + 1], self.positions[i + 2]
		if x < minx then minx = x end
		if y < miny then miny = y end
		if z < minz then minz = z end
		if x > maxx then maxx = x end
		if y > maxy then maxy = y end
		if z > maxz then maxz = z end
	end

	self.bounding_center = {
		(minx + maxx) * 0.5,
		(miny + maxy) * 0.5,
		(minz + maxz) * 0.5,
	}

	local max_dist_sq = 0
	for i = 1, #self.positions, 3 do
		local dx<const> = self.positions[i] - self.bounding_center[1]
		local dy<const> = self.positions[i + 1] - self.bounding_center[2]
		local dz<const> = self.positions[i + 2] - self.bounding_center[3]
		local d2<const> = dx * dx + dy * dy + dz * dz
		if d2 > max_dist_sq then
			max_dist_sq = d2
		end
	end
	self.bounding_radius = math.sqrt(max_dist_sq)
end

function mesh:vertices()
	return vec_slice(self.positions, 3)
end

return mesh
