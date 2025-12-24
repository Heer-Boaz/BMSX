-- mesh.lua
-- Simple mesh container for system ROM

local Mesh = {}
Mesh.__index = Mesh

local function vec_slice(tbl, step)
	local len = #tbl
	local out = {}
	for i = 1, len, step do
		out[#out + 1] = { tbl[i], tbl[i + 1], tbl[i + 2] }
	end
	return out
end

function Mesh.new(opts)
	local self = setmetatable({}, Mesh)
	opts = opts or {}
	self.name = opts.meshname or ""
	self.positions = opts.positions or {}
	self.texcoords = opts.texcoords or {}
	self.texcoords1 = opts.texcoords1 or {}
	self.colors = opts.colors or {}
	self.normals = opts.normals
	self.tangents = opts.tangents
	self.indices = opts.indices
	self.color = opts.color or { r = 255, g = 255, b = 255, a = 1 }
	self.atlas_id = opts.atlasId or 255
	self.material = opts.material
	self.morphPositions = opts.morphPositions
	self.morphNormals = opts.morphNormals
	self.morphTangents = opts.morphTangents
	self.morphWeights = opts.morphWeights or {}
	self.jointIndices = opts.jointIndices
	self.jointWeights = opts.jointWeights
	self.bounding_center = { 0, 0, 0 }
	self.bounding_radius = 0
	self:update_bounds()
	return self
end

function Mesh:vertex_count()
	return math.floor(#self.positions / 3)
end

function Mesh:has_texcoords()
	return #self.texcoords >= self:vertex_count() * 2
end

function Mesh:has_normals()
	return self.normals and #self.normals >= self:vertex_count() * 3
end

function Mesh:update_bounds()
	if #self.positions < 3 then
		self.bounding_center = { 0, 0, 0 }
		self.bounding_radius = 0
		return
	end

	local minX, minY, minZ = math.huge, math.huge, math.huge
	local maxX, maxY, maxZ = -math.huge, -math.huge, -math.huge

	for i = 1, #self.positions, 3 do
		local x, y, z = self.positions[i], self.positions[i + 1], self.positions[i + 2]
		if x < minX then minX = x end
		if y < minY then minY = y end
		if z < minZ then minZ = z end
		if x > maxX then maxX = x end
		if y > maxY then maxY = y end
		if z > maxZ then maxZ = z end
	end

	self.bounding_center = {
		(minX + maxX) * 0.5,
		(minY + maxY) * 0.5,
		(minZ + maxZ) * 0.5,
	}

	local max_dist_sq = 0
	for i = 1, #self.positions, 3 do
		local dx = self.positions[i] - self.bounding_center[1]
		local dy = self.positions[i + 1] - self.bounding_center[2]
		local dz = self.positions[i + 2] - self.bounding_center[3]
		local d2 = dx * dx + dy * dy + dz * dz
		if d2 > max_dist_sq then
			max_dist_sq = d2
		end
	end
	self.bounding_radius = math.sqrt(max_dist_sq)
end

function Mesh:vertices()
	return vec_slice(self.positions, 3)
end

return Mesh
