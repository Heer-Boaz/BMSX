-- collision2d.lua
-- 2D collision helpers + broadphase index

local collision2d = {}
local world_instance = require("world").instance

local eps = 1e-8
local eps_parallel = 1e-12

local function new_area(left, top, right, bottom)
	return {
		left = left,
		top = top,
		right = right,
		bottom = bottom,
	}
end

local function detect_aabb_areas(a, b)
	return not (a.left > b.right or a.right < b.left or a.bottom < b.top or a.top > b.bottom)
end

local function area_to_poly(area)
	return {
		area.left, area.top,
		area.right, area.top,
		area.right, area.bottom,
		area.left, area.bottom,
	}
end

local function get_world_area(collider)
	return collider:get_world_area()
end

local function get_world_polys(collider)
	return collider:get_world_polys()
end

local function get_world_circle(collider)
	return collider:get_world_circle()
end

local function get_shape(collider)
	local world_circle = get_world_circle(collider)
	if world_circle ~= nil then
		return { kind = "circle", c = world_circle }
	end
	local world_polys = get_world_polys(collider)
	if world_polys ~= nil and #world_polys > 0 then
		return { kind = "poly", polys = world_polys }
	end
	return { kind = "poly", polys = { area_to_poly(get_world_area(collider)) } }
end

local function point_in_poly(px, py, poly)
	local inside = false
	local j = #poly - 1
	for i = 1, #poly, 2 do
		local xi = poly[i]
		local yi = poly[i + 1]
		local xj = poly[j]
		local yj = poly[j + 1]
		if ((yi > py) ~= (yj > py)) and (px < ((xj - xi) * (py - yi) / (((yj - yi) ~= 0 and (yj - yi) or eps_parallel)) + xi)) then
			inside = not inside
		end
		j = i
	end
	return inside
end

local function single_polygons_intersect(poly1, poly2)
	local function orient(ax, ay, bx, by, cx, cy)
		return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
	end
	local function on_segment(ax, ay, bx, by, cx, cy)
		return cx >= math.min(ax, bx) and cx <= math.max(ax, bx) and cy >= math.min(ay, by) and cy <= math.max(ay, by)
	end

	for i = 1, #poly1, 2 do
		local ax = poly1[i]
		local ay = poly1[i + 1]
		local ni = (i + 2 > #poly1) and 1 or (i + 2)
		local bx = poly1[ni]
		local by = poly1[ni + 1]
		for j = 1, #poly2, 2 do
			local cx = poly2[j]
			local cy = poly2[j + 1]
			local nj = (j + 2 > #poly2) and 1 or (j + 2)
			local dx = poly2[nj]
			local dy = poly2[nj + 1]
			local o1 = orient(ax, ay, bx, by, cx, cy)
			local o2 = orient(ax, ay, bx, by, dx, dy)
			local o3 = orient(cx, cy, dx, dy, ax, ay)
			local o4 = orient(cx, cy, dx, dy, bx, by)
			if (o1 * o2 < 0) and (o3 * o4 < 0) then
				return true
			end
			if o1 == 0 and on_segment(ax, ay, bx, by, cx, cy) then
				return true
			end
			if o2 == 0 and on_segment(ax, ay, bx, by, dx, dy) then
				return true
			end
			if o3 == 0 and on_segment(cx, cy, dx, dy, ax, ay) then
				return true
			end
			if o4 == 0 and on_segment(cx, cy, dx, dy, bx, by) then
				return true
			end
		end
	end

	if point_in_poly(poly1[1], poly1[2], poly2) then
		return true
	end
	if point_in_poly(poly2[1], poly2[2], poly1) then
		return true
	end
	return false
end

local function polygons_intersect(polys1, polys2)
	for i = 1, #polys1 do
		local p1 = polys1[i]
		for j = 1, #polys2 do
			local p2 = polys2[j]
			if single_polygons_intersect(p1, p2) then
				return true
			end
		end
	end
	return false
end

local function circle_circle_overlap(a, b)
	local dx = a.x - b.x
	local dy = a.y - b.y
	local rr = a.r + b.r
	return ((dx * dx) + (dy * dy)) <= (rr * rr)
end

local function circle_poly_overlap(circle, polys)
	for i = 1, #polys do
		local poly = polys[i]
		for j = 1, #poly, 2 do
			local ni = (j + 2 > #poly) and 1 or (j + 2)
			local ex = poly[ni] - poly[j]
			local ey = poly[ni + 1] - poly[j + 1]
			local nx = -ey
			local ny = ex
			local length = math.sqrt((nx * nx) + (ny * ny))
			if length > eps then
				local ax = nx / length
				local ay = ny / length
				local pmin = math.huge
				local pmax = -math.huge
				for k = 1, #poly, 2 do
					local proj = (poly[k] * ax) + (poly[k + 1] * ay)
					if proj < pmin then
						pmin = proj
					end
					if proj > pmax then
						pmax = proj
					end
				end
				local cproj = (circle.x * ax) + (circle.y * ay)
				local cmin = cproj - circle.r
				local cmax = cproj + circle.r
				local sep = math.max(pmin - cmax, cmin - pmax)
				if sep > 0 then
					return false
				end
			end
		end
		local vx = poly[1]
		local vy = poly[2]
		local best_d = ((vx - circle.x) * (vx - circle.x)) + ((vy - circle.y) * (vy - circle.y))
		for j = 3, #poly, 2 do
			local dx = poly[j] - circle.x
			local dy = poly[j + 1] - circle.y
			local d = (dx * dx) + (dy * dy)
			if d < best_d then
				best_d = d
				vx = poly[j]
				vy = poly[j + 1]
			end
		end
		local ax = vx - circle.x
		local ay = vy - circle.y
		local axis_len = math.sqrt((ax * ax) + (ay * ay))
		if axis_len > eps then
			local ux = ax / axis_len
			local uy = ay / axis_len
			local pmin = math.huge
			local pmax = -math.huge
			for k = 1, #poly, 2 do
				local proj = (poly[k] * ux) + (poly[k + 1] * uy)
				if proj < pmin then
					pmin = proj
				end
				if proj > pmax then
					pmax = proj
				end
			end
			local cproj = (circle.x * ux) + (circle.y * uy)
			local cmin = cproj - circle.r
			local cmax = cproj + circle.r
			local sep = math.max(pmin - cmax, cmin - pmax)
			if sep > 0 then
				return false
			end
		end
	end
	return true
end

local function shape_intersects(a, b)
	if a.kind == "circle" and b.kind == "circle" then
		return circle_circle_overlap(a.c, b.c)
	end
	if a.kind == "circle" and b.kind == "poly" then
		return circle_poly_overlap(a.c, b.polys)
	end
	if a.kind == "poly" and b.kind == "circle" then
		return circle_poly_overlap(b.c, a.polys)
	end
	if a.kind == "poly" and b.kind == "poly" then
		return polygons_intersect(a.polys, b.polys)
	end
	return false
end

local function contact_circle_circle(a, b)
	local dx = a.x - b.x
	local dy = a.y - b.y
	local dist = math.sqrt((dx * dx) + (dy * dy))
	local rr = a.r + b.r
	if dist >= rr then
		return nil
	end
	local depth = rr - dist
	local nx
	local ny
	if dist > eps then
		nx = dx / dist
		ny = dy / dist
	else
		nx = 1
		ny = 0
	end
	return {
		normal = { x = nx, y = ny },
		depth = depth,
		point = { x = b.x + (nx * b.r), y = b.y + (ny * b.r) },
	}
end

local function contact_circle_poly(circle, poly_shape)
	local best_axis = nil
	local best_overlap = math.huge

	local function test_axis(poly, ax, ay)
		local pmin = math.huge
		local pmax = -math.huge
		for i = 1, #poly, 2 do
			local proj = (poly[i] * ax) + (poly[i + 1] * ay)
			if proj < pmin then
				pmin = proj
			end
			if proj > pmax then
				pmax = proj
			end
		end
		local cproj = (circle.x * ax) + (circle.y * ay)
		local cmin = cproj - circle.r
		local cmax = cproj + circle.r
		local sep = math.max(pmin - cmax, cmin - pmax)
		if sep > 0 then
			return false
		end
		local overlap = -sep
		if overlap < best_overlap then
			best_overlap = overlap
			best_axis = { x = ax, y = ay }
		end
		return true
	end

	for i = 1, #poly_shape.polys do
		local poly = poly_shape.polys[i]
		for j = 1, #poly, 2 do
			local ni = (j + 2 > #poly) and 1 or (j + 2)
			local nx = -(poly[ni + 1] - poly[j + 1])
			local ny = poly[ni] - poly[j]
			local edge_len = math.sqrt((nx * nx) + (ny * ny))
			if edge_len > eps then
				if not test_axis(poly, nx / edge_len, ny / edge_len) then
					return nil
				end
			end
		end

		local vx = poly[1]
		local vy = poly[2]
		local best_d = ((vx - circle.x) * (vx - circle.x)) + ((vy - circle.y) * (vy - circle.y))
		for j = 3, #poly, 2 do
			local dx = poly[j] - circle.x
			local dy = poly[j + 1] - circle.y
			local d = (dx * dx) + (dy * dy)
			if d < best_d then
				best_d = d
				vx = poly[j]
				vy = poly[j + 1]
			end
		end
		local ax = vx - circle.x
		local ay = vy - circle.y
		local axis_len = math.sqrt((ax * ax) + (ay * ay))
		if axis_len > eps then
			if not test_axis(poly, ax / axis_len, ay / axis_len) then
				return nil
			end
		end
	end

	if best_axis == nil then
		return nil
	end
	return {
		normal = best_axis,
		depth = best_overlap,
	}
end

local function contact_poly_poly(a_shape, b_shape)
	local function contact_pair(poly_a, poly_b)
		local best_axis = nil
		local best_overlap = math.huge

		local function test_axes_from(poly)
			for i = 1, #poly, 2 do
				local ni = (i + 2 > #poly) and 1 or (i + 2)
				local nx = -(poly[ni + 1] - poly[i + 1])
				local ny = poly[ni] - poly[i]
				local edge_len = math.sqrt((nx * nx) + (ny * ny))
				if edge_len > eps then
					local ax = nx / edge_len
					local ay = ny / edge_len
					local min_a = math.huge
					local max_a = -math.huge
					for k = 1, #poly_a, 2 do
						local proj = (poly_a[k] * ax) + (poly_a[k + 1] * ay)
						if proj < min_a then
							min_a = proj
						end
						if proj > max_a then
							max_a = proj
						end
					end
					local min_b = math.huge
					local max_b = -math.huge
					for k = 1, #poly_b, 2 do
						local proj = (poly_b[k] * ax) + (poly_b[k + 1] * ay)
						if proj < min_b then
							min_b = proj
						end
						if proj > max_b then
							max_b = proj
						end
					end
					local sep = math.max(min_a - max_b, min_b - max_a)
					if sep > 0 then
						return false
					end
					local overlap = -sep
					if overlap < best_overlap then
						best_overlap = overlap
						best_axis = { x = ax, y = ay }
					end
				end
			end
			return true
		end

		if not test_axes_from(poly_a) then
			return nil
		end
		if not test_axes_from(poly_b) then
			return nil
		end
		if best_axis == nil then
			return nil
		end
		return {
			normal = best_axis,
			depth = best_overlap,
		}
	end

	local best = nil
	for i = 1, #a_shape.polys do
		local poly_a = a_shape.polys[i]
		for j = 1, #b_shape.polys do
			local poly_b = b_shape.polys[j]
			local contact = contact_pair(poly_a, poly_b)
			if contact ~= nil and (best == nil or contact.depth < best.depth) then
				best = contact
			end
		end
	end
	return best
end

function collision2d.collides(a, b)
	if not a.enabled or not b.enabled then
		return false
	end
	if not a.hittable or not b.hittable then
		return false
	end
	local area_a = get_world_area(a)
	local area_b = get_world_area(b)
	if not detect_aabb_areas(area_a, area_b) then
		return false
	end
	local shape_a = get_shape(a)
	local shape_b = get_shape(b)
	return shape_intersects(shape_a, shape_b)
end

function collision2d.get_contact2d(a, b)
	local area_a = get_world_area(a)
	local area_b = get_world_area(b)
	if not detect_aabb_areas(area_a, area_b) then
		return nil
	end
	local shape_a = get_shape(a)
	local shape_b = get_shape(b)
	if shape_a.kind == "circle" and shape_b.kind == "circle" then
		return contact_circle_circle(shape_a.c, shape_b.c)
	end
	if shape_a.kind == "circle" and shape_b.kind == "poly" then
		return contact_circle_poly(shape_a.c, shape_b)
	end
	if shape_a.kind == "poly" and shape_b.kind == "circle" then
		local contact = contact_circle_poly(shape_b.c, shape_a)
		if contact ~= nil and contact.normal ~= nil then
			contact.normal = { x = -contact.normal.x, y = -contact.normal.y }
		end
		return contact
	end
	return contact_poly_poly(shape_a, shape_b)
end

local broadphase_index = {}
broadphase_index.__index = broadphase_index

function broadphase_index.new(cell_size)
	local self = setmetatable({}, broadphase_index)
	self.cell_size = cell_size or 64
	self.cells = {}
	self.collider_keys = setmetatable({}, { __mode = "k" })
	return self
end

function broadphase_index:key(cx, cy)
	return tostring(cx) .. "," .. tostring(cy)
end

function broadphase_index:cell_coords_for_area(area)
	local cs = self.cell_size
	return {
		cx0 = math.floor(area.left / cs),
		cy0 = math.floor(area.top / cs),
		cx1 = math.floor(area.right / cs),
		cy1 = math.floor(area.bottom / cs),
	}
end

function broadphase_index:clear()
	self.cells = {}
	self.collider_keys = setmetatable({}, { __mode = "k" })
end

function broadphase_index:add_or_update(collider)
	local prev_keys = self.collider_keys[collider]
	if prev_keys ~= nil then
		for i = 1, #prev_keys do
			local key = prev_keys[i]
			local set = self.cells[key]
			if set ~= nil then
				set[collider] = nil
				if next(set) == nil then
					self.cells[key] = nil
				end
			end
		end
	end

	local area = collider:get_world_area()
	local cell_coords = self:cell_coords_for_area(area)
	local keys = {}
	for cy = cell_coords.cy0, cell_coords.cy1 do
		for cx = cell_coords.cx0, cell_coords.cx1 do
			local key = self:key(cx, cy)
			local set = self.cells[key]
			if set == nil then
				set = {}
				self.cells[key] = set
			end
			set[collider] = true
			keys[#keys + 1] = key
		end
	end
	self.collider_keys[collider] = keys
end

function broadphase_index:query_aabb(area)
	local cell_coords = self:cell_coords_for_area(area)
	local out = {}
	local seen = {}
	for cy = cell_coords.cy0, cell_coords.cy1 do
		for cx = cell_coords.cx0, cell_coords.cx1 do
			local set = self.cells[self:key(cx, cy)]
			if set ~= nil then
				for collider in pairs(set) do
					if not seen[collider] then
						seen[collider] = true
						if detect_aabb_areas(collider:get_world_area(), area) then
							out[#out + 1] = collider
						end
					end
				end
			end
		end
	end
	return out
end

local world_index = nil

function collision2d.ensure_index(cell_size)
	if world_index ~= nil then
		return world_index
	end
	world_index = broadphase_index.new(cell_size or 64)
	return world_index
end

function collision2d.rebuild_index(cell_size)
	local index = collision2d.ensure_index(cell_size)
	index:clear()
	for obj in world_instance:objects({ scope = "active" }) do
		local colliders = obj:get_components("collider2dcomponent")
		for i = 1, #colliders do
			local collider = colliders[i]
			if collider.enabled then
				index:add_or_update(collider)
			end
		end
	end
end

function collision2d.query_aabb(area)
	local index = collision2d.ensure_index()
	return index:query_aabb(area)
end

collision2d.detect_aabb_areas = detect_aabb_areas
collision2d.area_to_poly = area_to_poly
collision2d.polygons_intersect = polygons_intersect

return collision2d
