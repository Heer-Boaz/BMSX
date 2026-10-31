-- Number model-to-camera transforms and frustum clipping precede GP0 rounding.
-- Numeric lanes retain their high-water storage; no vertex or face records are
-- allocated while collecting a frame. The camera has an infinite far plane.
local gp0<const> = require('cartlib/gx/gp0')

struct batch_position
	x: f32
	y: f32
	z: f32
end

local model_batch<const> = {}
model_batch.__index = model_batch

function model_batch.new()
	local self<const> = setmetatable({
		view_x = {}, view_y = {}, view_z = {}, outcodes = {}, projected = {},
		clip_ax = {}, clip_ay = {}, clip_az = {},
		clip_bx = {}, clip_by = {}, clip_bz = {}, clip_words = {},
		commands = {}, xy0 = {}, xy1 = {}, xy2 = {}, depths = {}, component_ids = {},
		order = {}, merge = {}, count = 0, sorted = false, projection_valid = false,
	}, model_batch)
	-- A triangle clipped by five planes has at most eight polygon vertices.
	for index = 1, 8 do
		self.clip_ax[index], self.clip_ay[index], self.clip_az[index] = 0, 0, 0
		self.clip_bx[index], self.clip_by[index], self.clip_bz[index] = 0, 0, 0
		self.clip_words[index] = 0
	end
	return self
end

function model_batch:begin(camera)
	local focal<const>, center_x<const>, center_y<const> = camera.focal_length, camera.center_x, camera.center_y
	local width<const>, height<const>, near<const> = camera.width, camera.height, camera.near
	if focal ~= self.focal or center_x ~= self.center_x or center_y ~= self.center_y
	or width ~= self.width or height ~= self.height or near ~= self.near then
		self.projection_valid = false
	end
	self.focal, self.center_x, self.center_y = focal, center_x, center_y
	self.width, self.height, self.near = width, height, near
	self.right_z, self.bottom_z = width - center_x, height - center_y
	self.count = 0
	self.sorted = false
end

local project<const> = function(batch, primitive, modelview)
	if batch.projection_valid and batch.asset == primitive.asset and batch.positions == primitive.positions
	and batch.position_scalar_count == primitive.position_scalar_count
	and batch.xx == modelview.xx and batch.xy == modelview.xy and batch.xz == modelview.xz
	and batch.yx == modelview.yx and batch.yy == modelview.yy and batch.yz == modelview.yz
	and batch.zx == modelview.zx and batch.zy == modelview.zy and batch.zz == modelview.zz
	and batch.ox == modelview.ox and batch.oy == modelview.oy and batch.oz == modelview.oz then
		return
	end
	local xx<const>, xy<const>, xz<const> = modelview.xx, modelview.xy, modelview.xz
	local yx<const>, yy<const>, yz<const> = modelview.yx, modelview.yy, modelview.yz
	local zx<const>, zy<const>, zz<const> = modelview.zx, modelview.zy, modelview.zz
	local ox<const>, oy<const>, oz<const> = modelview.ox, modelview.oy, modelview.oz
	local focal<const>, center_x<const>, center_y<const> = batch.focal, batch.center_x, batch.center_y
	local near<const>, right_z<const>, bottom_z<const> = batch.near, batch.right_z, batch.bottom_z
	local positions<const>: *batch_position = primitive.positions
	local view_x<const>, view_y<const>, view_z<const> = batch.view_x, batch.view_y, batch.view_z
	local outcodes<const>, projected<const> = batch.outcodes, batch.projected
	for index = 0, primitive.position_scalar_count // 3 - 1 do
		local vertex<const>: *batch_position = positions + index * sizeof(batch_position)
		local x<const>, y<const>, z<const> = vertex->x, vertex->y, vertex->z
		local vx<const> = xx*x + yx*y + zx*z + ox
		local vy<const> = xy*x + yy*y + zy*z + oy
		local vz<const> = xz*x + yz*y + zz*z + oz
		local lane<const> = index + 1
		view_x[lane], view_y[lane], view_z[lane] = vx, vy, vz
		local code = 0
		if vz < near then code = code | 1 end
		if focal*vx + center_x*vz < 0 then code = code | 2 end
		if right_z*vz - focal*vx < 0 then code = code | 4 end
		if focal*vy + center_y*vz < 0 then code = code | 8 end
		if bottom_z*vz - focal*vy < 0 then code = code | 16 end
		outcodes[lane] = code
		if code == 0 then
			local scale<const> = focal / vz
			projected[lane] = gp0.pair16(center_x + vx*scale, center_y + vy*scale)
		end
	end
	batch.asset = primitive.asset
	batch.positions, batch.position_scalar_count = primitive.positions, primitive.position_scalar_count
	batch.xx, batch.xy, batch.xz = xx, xy, xz
	batch.yx, batch.yy, batch.yz = yx, yy, yz
	batch.zx, batch.zy, batch.zz = zx, zy, zz
	batch.ox, batch.oy, batch.oz = ox, oy, oz
	batch.projection_valid = true
end

local queue_face<const> = function(batch, primitive, component_id, reflected, s0, s1, s2, depth)
	local area<const> = gp0.triangle_area(s0, s1, s2)
	if area == 0 then return end
	if not primitive.double_sided and ((area < 0) == reflected) then return end
	local index<const> = batch.count + 1
	batch.commands[index] = primitive.command_word
	batch.xy0[index], batch.xy1[index], batch.xy2[index] = s0, s1, s2
	batch.depths[index] = depth
	batch.component_ids[index] = component_id
	batch.order[index] = index
	batch.count = index
	batch.sorted = false
end

local queue_triangle<const> = function(batch, primitive, component_id, reflected, a, b, c)
	local codes<const> = batch.outcodes
	local ca<const>, cb<const>, cc<const> = codes[a], codes[b], codes[c]
	local mask<const> = ca | cb | cc
	local vz<const> = batch.view_z
	if mask == 0 then
		local projected<const> = batch.projected
		queue_face(batch, primitive, component_id, reflected,
			projected[a], projected[b], projected[c], vz[a] + vz[b] + vz[c])
		return
	end
	if (ca & cb & cc) ~= 0 then return end
	local vx<const>, vy<const> = batch.view_x, batch.view_y
	local sx, sy, sz = batch.clip_ax, batch.clip_ay, batch.clip_az
	local dx, dy, dz = batch.clip_bx, batch.clip_by, batch.clip_bz
	sx[1], sy[1], sz[1] = vx[a], vy[a], vz[a]
	sx[2], sy[2], sz[2] = vx[b], vy[b], vz[b]
	sx[3], sy[3], sz[3] = vx[c], vy[c], vz[c]
	local count = 3
	for plane = 0, 4 do
		if (mask & (1 << plane)) ~= 0 then
			local px, py, pz, constant = 0, 0, 0, 0
			if plane == 0 then pz, constant = 1, -batch.near
			elseif plane == 1 then px, pz = batch.focal, batch.center_x
			elseif plane == 2 then px, pz = -batch.focal, batch.right_z
			elseif plane == 3 then py, pz = batch.focal, batch.center_y
			else py, pz = -batch.focal, batch.bottom_z end
			local output_count = 0
			local ax, ay, az = sx[1], sy[1], sz[1]
			local da = px*ax + py*ay + pz*az + constant
			for index = 2, count + 1 do
				local next_index = index
				if index > count then next_index = 1 end
				local bx<const>, by<const>, bz<const> = sx[next_index], sy[next_index], sz[next_index]
				local db<const> = px*bx + py*by + pz*bz + constant
				local a_inside<const> = da >= 0
				if a_inside then
					output_count = output_count + 1
					dx[output_count], dy[output_count], dz[output_count] = ax, ay, az
				end
				-- An on-plane endpoint is already emitted as an inside vertex;
				-- only a strict crossing creates a new intersection.
				if (da < 0 and db > 0) or (da > 0 and db < 0) then
					local t<const> = da / (da - db)
					output_count = output_count + 1
					dx[output_count] = ax + (bx-ax)*t
					dy[output_count] = ay + (by-ay)*t
					if plane == 0 then dz[output_count] = batch.near
					else dz[output_count] = az + (bz-az)*t end
				end
				ax, ay, az, da = bx, by, bz, db
			end
			if output_count < 3 then return end
			count = output_count
			sx, dx = dx, sx
			sy, dy = dy, sy
			sz, dz = dz, sz
		end
	end
	local words<const> = batch.clip_words
	local focal<const>, center_x<const>, center_y<const> = batch.focal, batch.center_x, batch.center_y
	for index = 1, count do
		local scale<const> = focal / sz[index]
		words[index] = gp0.pair16(center_x + sx[index]*scale, center_y + sy[index]*scale)
	end
	for index = 2, count - 1 do
		queue_face(batch, primitive, component_id, reflected,
			words[1], words[index], words[index + 1], sz[1] + sz[index] + sz[index + 1])
	end
end

function model_batch.indexed8(batch, primitive, modelview, component_id, reflected)
	project(batch, primitive, modelview)
	local indices<const>: *u8 = primitive.indices
	for index = 0, primitive.index_count - 1, 3 do
		queue_triangle(batch, primitive, component_id, reflected,
			indices[index] + 1, indices[index + 1] + 1, indices[index + 2] + 1)
	end
end

function model_batch.indexed16(batch, primitive, modelview, component_id, reflected)
	project(batch, primitive, modelview)
	local indices<const>: *u16 = primitive.indices
	for index = 0, primitive.index_count - 1, 3 do
		queue_triangle(batch, primitive, component_id, reflected,
			indices[index] + 1, indices[index + 1] + 1, indices[index + 2] + 1)
	end
end

function model_batch.indexed32(batch, primitive, modelview, component_id, reflected)
	project(batch, primitive, modelview)
	local indices<const>: *u32 = primitive.indices
	for index = 0, primitive.index_count - 1, 3 do
		queue_triangle(batch, primitive, component_id, reflected,
			indices[index] + 1, indices[index + 1] + 1, indices[index + 2] + 1)
	end
end

function model_batch.triangles(batch, primitive, modelview, component_id, reflected)
	project(batch, primitive, modelview)
	for index = 1, primitive.position_scalar_count // 3, 3 do
		queue_triangle(batch, primitive, component_id, reflected, index, index + 1, index + 2)
	end
end

function model_batch:submit(draw)
	local count<const> = self.count
	local sorted_order = self.sorted_order
	if not self.sorted then
		local source, destination = self.order, self.merge
		local depths<const>, components<const> = self.depths, self.component_ids
		local width = 1
		while width < count do
			for first = 1, count, width * 2 do
				local middle = first + width
				if middle > count + 1 then middle = count + 1 end
				local last = first + width * 2
				if last > count + 1 then last = count + 1 end
				local left, right = first, middle
				for output = first, last - 1 do
					local take_left = right == last
					if left < middle and right < last then
						local a<const>, b<const> = source[left], source[right]
						local za<const>, zb<const> = depths[a], depths[b]
						local ia<const>, ib<const> = components[a], components[b]
						take_left = za > zb or (za == zb and (ia < ib or (ia == ib and a < b)))
					end
					if take_left then destination[output], left = source[left], left + 1
					else destination[output], right = source[right], right + 1 end
				end
			end
			source, destination = destination, source
			width = width * 2
		end
		sorted_order = source
		self.sorted_order = sorted_order
		self.sorted = true
	end
	draw:triangle_words_batch(self.commands, self.xy0, self.xy1, self.xy2, sorted_order, count)
end

return model_batch
