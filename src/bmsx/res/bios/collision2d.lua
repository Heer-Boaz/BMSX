-- collision2d.lua
-- 2D collision helpers + broadphase index
--
-- DESIGN PRINCIPLES — collision detection
--
-- 1. DO NOT WRITE CUSTOM COLLISION LOOPS IN CART CODE.
--    The overlap2dsystem (ecs_systems.lua) runs every frame and automatically
--    detects all overlapping collider pairs using a broadphase grid + exact
--    shape test.  It emits 'overlap.begin', 'overlap.stay', and 'overlap.end'
--    events directly on the owner objects' event ports.  Subscribe to those
--    events in bind() instead of iterating objects yourself.
--
--    WRONG — manual collision loop in update():
--      function enemy:update()
--          for obj in world_instance:objects({ scope = 'active' }) do
--              if collision2d.collides(self.collider, obj.collider) then
--                  self:take_damage()
--              end
--          end
--      end
--    RIGHT — reactive subscription in bind():
--      function enemy:bind()
--          self.events:on({ event = 'overlap.begin', subscriber = self,
--              handler = function(e)
--                  if e.other_collider_local_id == 'bullet' then
--                      self:take_damage() end end })
--      end
--
-- 2. WHEN TO CALL collision2d DIRECTLY.
--    Use collision2d.collides() or collision2d.query_aabb() only for cases
--    that genuinely fall outside the per-frame ECS pipeline:
--      a) One-shot hit-scan / ray queries that happen at an arbitrary moment
--         (e.g. 'is there anything at this point right now?').
--      b) Custom broadphase queries in a specialised ECS system you are
--         writing (not in an ordinary object's update()).
--    In all other cases, rely on overlap2dsystem events.
--
-- 3. COLLISION SHAPE PRIORITY (per collider, highest wins).
--    circle (set_local_circle)  > polys (set_local_poly)  > AABB (default).
--    The AABB is computed automatically from parent.sx / parent.sy when no
--    explicit shape is set.  Sprite objects populate polys automatically from
--    the image's imgmeta.hitpolygons (baked at pack-time by the rombuilder).
--    See the @cx / @cc filename suffix notes in sprite.lua.

local collision2d = {}
local clear_map = require('clear_map')
local world_instance = require('world').instance
local active_scope = { scope = 'active' }

local eps = 1e-8
local eps_parallel = 1e-12

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

local function clear_array(array)
	for i = #array, 1, -1 do
		array[i] = nil
	end
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

local function orient2d(ax, ay, bx, by, cx, cy)
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
end

local function point_on_segment(ax, ay, bx, by, cx, cy)
	local min_x = ax < bx and ax or bx
	local max_x = ax > bx and ax or bx
	local min_y = ay < by and ay or by
	local max_y = ay > by and ay or by
	return cx >= min_x and cx <= max_x and cy >= min_y and cy <= max_y
end

local function project_poly_axis(poly, ax, ay)
	local min_proj = math.huge
	local max_proj = -math.huge
	for i = 1, #poly, 2 do
		local proj = (poly[i] * ax) + (poly[i + 1] * ay)
		if proj < min_proj then
			min_proj = proj
		end
		if proj > max_proj then
			max_proj = proj
		end
	end
	return min_proj, max_proj
end

local function test_circle_poly_axis(poly, circle, ax, ay, best_axis_x, best_axis_y, best_overlap)
	local pmin, pmax = project_poly_axis(poly, ax, ay)
	local cproj = (circle.x * ax) + (circle.y * ay)
	local cmin = cproj - circle.r
	local cmax = cproj + circle.r
	local sep = math.max(pmin - cmax, cmin - pmax)
	if sep > 0 then
		return false, best_axis_x, best_axis_y, best_overlap
	end
	local overlap = -sep
	if overlap < best_overlap then
		return true, ax, ay, overlap
	end
	return true, best_axis_x, best_axis_y, best_overlap
end

local function test_poly_pair_axis(poly_a, poly_b, ax, ay, best_axis_x, best_axis_y, best_overlap)
	local min_a, max_a = project_poly_axis(poly_a, ax, ay)
	local min_b, max_b = project_poly_axis(poly_b, ax, ay)
	local sep = math.max(min_a - max_b, min_b - max_a)
	if sep > 0 then
		return false, best_axis_x, best_axis_y, best_overlap
	end
	local overlap = -sep
	if overlap < best_overlap then
		return true, ax, ay, overlap
	end
	return true, best_axis_x, best_axis_y, best_overlap
end

local function test_poly_pair_axes(poly, poly_a, poly_b, best_axis_x, best_axis_y, best_overlap)
	for i = 1, #poly, 2 do
		local ni = (i + 2 > #poly) and 1 or (i + 2)
		local nx = -(poly[ni + 1] - poly[i + 1])
		local ny = poly[ni] - poly[i]
		local edge_len = math.sqrt((nx * nx) + (ny * ny))
		if edge_len > eps then
			local ok
			ok, best_axis_x, best_axis_y, best_overlap = test_poly_pair_axis(
				poly_a,
				poly_b,
				nx / edge_len,
				ny / edge_len,
				best_axis_x,
				best_axis_y,
				best_overlap
			)
			if not ok then
				return false, best_axis_x, best_axis_y, best_overlap
			end
		end
	end
	return true, best_axis_x, best_axis_y, best_overlap
end

local function single_polygons_intersect(poly1, poly2)
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
			local o1 = orient2d(ax, ay, bx, by, cx, cy)
			local o2 = orient2d(ax, ay, bx, by, dx, dy)
			local o3 = orient2d(cx, cy, dx, dy, ax, ay)
			local o4 = orient2d(cx, cy, dx, dy, bx, by)
			if (o1 * o2 < 0) and (o3 * o4 < 0) then
				return true
			end
			if o1 == 0 and point_on_segment(ax, ay, bx, by, cx, cy) then
				return true
			end
			if o2 == 0 and point_on_segment(ax, ay, bx, by, dx, dy) then
				return true
			end
			if o3 == 0 and point_on_segment(cx, cy, dx, dy, ax, ay) then
				return true
			end
			if o4 == 0 and point_on_segment(cx, cy, dx, dy, bx, by) then
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

local function contact_aabb_aabb(a, b)
	local center_ax = (a.left + a.right) / 2
	local center_ay = (a.top + a.bottom) / 2
	local center_bx = (b.left + b.right) / 2
	local center_by = (b.top + b.bottom) / 2
	local dx = center_ax - center_bx
	local dy = center_ay - center_by
	local half_w = ((a.right - a.left) + (b.right - b.left)) / 2
	local half_h = ((a.bottom - a.top) + (b.bottom - b.top)) / 2
	local overlap_x = half_w - math.abs(dx)
	local overlap_y = half_h - math.abs(dy)
	if overlap_x <= 0 or overlap_y <= 0 then
		return nil
	end
	local point = {
		x = (math.max(a.left, b.left) + math.min(a.right, b.right)) / 2,
		y = (math.max(a.top, b.top) + math.min(a.bottom, b.bottom)) / 2,
	}
	if overlap_x < overlap_y then
		return {
			normal = { x = dx < 0 and -1 or 1, y = 0 },
			depth = overlap_x,
			point = point,
		}
	end
	return {
		normal = { x = 0, y = dy < 0 and -1 or 1 },
		depth = overlap_y,
		point = point,
	}
end

local function contact_circle_poly(circle, polys)
	local best_axis_x = nil
	local best_axis_y = nil
	local best_overlap = math.huge

	for i = 1, #polys do
		local poly = polys[i]
		for j = 1, #poly, 2 do
			local ni = (j + 2 > #poly) and 1 or (j + 2)
			local nx = -(poly[ni + 1] - poly[j + 1])
			local ny = poly[ni] - poly[j]
			local edge_len = math.sqrt((nx * nx) + (ny * ny))
			if edge_len > eps then
				local ok
				ok, best_axis_x, best_axis_y, best_overlap = test_circle_poly_axis(
					poly,
					circle,
					nx / edge_len,
					ny / edge_len,
					best_axis_x,
					best_axis_y,
					best_overlap
				)
				if not ok then
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
			local ok
			ok, best_axis_x, best_axis_y, best_overlap = test_circle_poly_axis(
				poly,
				circle,
				ax / axis_len,
				ay / axis_len,
				best_axis_x,
				best_axis_y,
				best_overlap
			)
			if not ok then
				return nil
			end
		end
	end

	if best_axis_x == nil then
		return nil
	end
	return {
		normal = { x = best_axis_x, y = best_axis_y },
		depth = best_overlap,
	}
end

local function contact_poly_pair(poly_a, poly_b)
	local best_axis_x = nil
	local best_axis_y = nil
	local best_overlap = math.huge

	local ok
	ok, best_axis_x, best_axis_y, best_overlap = test_poly_pair_axes(poly_a, poly_a, poly_b, best_axis_x, best_axis_y, best_overlap)
	if not ok then
		return nil
	end
	ok, best_axis_x, best_axis_y, best_overlap = test_poly_pair_axes(poly_b, poly_a, poly_b, best_axis_x, best_axis_y, best_overlap)
	if not ok then
		return nil
	end
	if best_axis_x == nil then
		return nil
	end
	return {
		normal = { x = best_axis_x, y = best_axis_y },
		depth = best_overlap,
	}
end

local function contact_poly_poly(polys_a, polys_b)
	local best = nil
	for i = 1, #polys_a do
		local poly_a = polys_a[i]
		for j = 1, #polys_b do
			local poly_b = polys_b[j]
			local contact = contact_poly_pair(poly_a, poly_b)
			if contact ~= nil and (best == nil or contact.depth < best.depth) then
				best = contact
			end
		end
	end
	return best
end

-- collision2d.collides(a, b): exact shape test between two collider2dcomponents.
-- Performs broadphase AABB check first, then exact shape intersection.
-- Respects `enabled`, `hittable`, layer/mask filters.
-- Prefer overlap2dsystem events over calling this directly — see DESIGN
-- PRINCIPLES rule 1 at the top of this file.
function collision2d.collides(a, b)
	if not a.enabled or not b.enabled then
		return false
	end
	if not a.hittable or not b.hittable then
		return false
	end
	local area_a = a:get_world_area()
	local area_b = b:get_world_area()
	if not detect_aabb_areas(area_a, area_b) then
		return false
	end
	local kind_a = a:get_shape_kind()
	local kind_b = b:get_shape_kind()
	if kind_a == 'aabb' and kind_b == 'aabb' then
		return true
	end
	if kind_a == 'circle' and kind_b == 'circle' then
		return circle_circle_overlap(a:get_world_circle(), b:get_world_circle())
	end
	if kind_a == 'circle' and kind_b == 'poly' then
		return circle_poly_overlap(a:get_world_circle(), b:get_world_polys())
	end
	if kind_a == 'poly' and kind_b == 'circle' then
		return circle_poly_overlap(b:get_world_circle(), a:get_world_polys())
	end
	if kind_a == 'circle' and kind_b == 'aabb' then
		return circle_poly_overlap(a:get_world_circle(), b:get_world_area_polys())
	end
	if kind_a == 'aabb' and kind_b == 'circle' then
		return circle_poly_overlap(b:get_world_circle(), a:get_world_area_polys())
	end
	if kind_a == 'poly' and kind_b == 'poly' then
		return polygons_intersect(a:get_world_polys(), b:get_world_polys())
	end
	if kind_a == 'poly' and kind_b == 'aabb' then
		return polygons_intersect(a:get_world_polys(), b:get_world_area_polys())
	end
	return polygons_intersect(a:get_world_area_polys(), b:get_world_polys())
end

-- collision2d.get_contact2d(a, b)
--   Returns contact data { normal={x,y}, depth, point={x,y} } when a and b
--   overlap, or nil when they do not.
--   Called automatically by overlap2dsystem when building 'overlap.begin' and
--   'overlap.stay' event payloads; only call directly for one-shot queries or
--   inside custom ECS systems that need contact normals.
function collision2d.get_contact2d(a, b)
	local area_a = a:get_world_area()
	local area_b = b:get_world_area()
	if not detect_aabb_areas(area_a, area_b) then
		return nil
	end
	local kind_a = a:get_shape_kind()
	local kind_b = b:get_shape_kind()
	if kind_a == 'aabb' and kind_b == 'aabb' then
		return contact_aabb_aabb(area_a, area_b)
	end
	if kind_a == 'circle' and kind_b == 'circle' then
		return contact_circle_circle(a:get_world_circle(), b:get_world_circle())
	end
	if kind_a == 'circle' and kind_b == 'poly' then
		return contact_circle_poly(a:get_world_circle(), b:get_world_polys())
	end
	if kind_a == 'circle' and kind_b == 'aabb' then
		return contact_circle_poly(a:get_world_circle(), b:get_world_area_polys())
	end
	if kind_a == 'poly' and kind_b == 'circle' then
		local contact = contact_circle_poly(b:get_world_circle(), a:get_world_polys())
		if contact ~= nil and contact.normal ~= nil then
			contact.normal.x = -contact.normal.x
			contact.normal.y = -contact.normal.y
		end
		return contact
	end
	if kind_a == 'aabb' and kind_b == 'circle' then
		local contact = contact_circle_poly(b:get_world_circle(), a:get_world_area_polys())
		if contact ~= nil and contact.normal ~= nil then
			contact.normal.x = -contact.normal.x
			contact.normal.y = -contact.normal.y
		end
		return contact
	end
	if kind_a == 'poly' and kind_b == 'poly' then
		return contact_poly_poly(a:get_world_polys(), b:get_world_polys())
	end
	if kind_a == 'poly' and kind_b == 'aabb' then
		return contact_poly_poly(a:get_world_polys(), b:get_world_area_polys())
	end
	return contact_poly_poly(a:get_world_area_polys(), b:get_world_polys())
end

local broadphase_index = {}
broadphase_index.__index = broadphase_index

function broadphase_index.new(cell_size)
	local self = setmetatable({}, broadphase_index)
	self.cell_size = cell_size or 64
	self.cells = {}
	self.row_pool = {}
	self.set_pool = {}
	return self
end

function broadphase_index:cell_coords_for_area(area)
	local cs = self.cell_size
	return math.floor(area.left / cs), math.floor(area.top / cs), math.floor(area.right / cs), math.floor(area.bottom / cs)
end

function broadphase_index:clear()
	for _, row in pairs(self.cells) do
		for _, set in pairs(row) do
			clear_map(set)
			self.set_pool[#self.set_pool + 1] = set
		end
		clear_map(row)
		self.row_pool[#self.row_pool + 1] = row
	end
	clear_map(self.cells)
end

function broadphase_index:add_or_update(collider)
	local area = collider:get_world_area()
	local cx0, cy0, cx1, cy1 = self:cell_coords_for_area(area)
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local row = self.cells[cx]
			if row == nil then
				row = self.row_pool[#self.row_pool]
				if row == nil then
					row = {}
				else
					self.row_pool[#self.row_pool] = nil
				end
				self.cells[cx] = row
			end
			local set = row[cy]
			if set == nil then
				set = self.set_pool[#self.set_pool]
				if set == nil then
					set = {}
				else
					self.set_pool[#self.set_pool] = nil
				end
				row[cy] = set
			end
			set[collider] = true
		end
	end
end

function broadphase_index:query_aabb(area, out, seen)
	out = out or {}
	seen = seen or {}
	clear_array(out)
	clear_map(seen)
	local out_count = 0
	local cx0, cy0, cx1, cy1 = self:cell_coords_for_area(area)
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local row = self.cells[cx]
			local set
			if row ~= nil then
				set = row[cy]
			end
			if set ~= nil then
				for collider in pairs(set) do
					if not seen[collider] then
						seen[collider] = true
						if detect_aabb_areas(collider:get_world_area(), area) then
							out_count = out_count + 1
							out[out_count] = collider
						end
					end
				end
			end
		end
	end
	return out
end

function collision2d.new_index(cell_size)
	return broadphase_index.new(cell_size or 64)
end

collision2d.world_index = collision2d.new_index(64)

function collision2d.rebuild_index(cell_size)
	local index = collision2d.world_index
	if cell_size ~= nil then
		index.cell_size = cell_size
	end
	index:clear()
	for _, collider in world_instance:objects_with_components('collider2dcomponent', active_scope) do
		if collider.enabled then
			index:add_or_update(collider)
		end
	end
end

-- collision2d.query_aabb(area): returns all colliders in the broadphase grid
-- that overlap the given AABB `area` table { left, top, right, bottom }.
-- Results are broadphase candidates only — always follow up with
-- collision2d.collides() for exact filtering.
-- The broadphase index is rebuilt each frame by overlap2dsystem; calling this
-- outside of an ECS system update may yield stale results for that frame.
function collision2d.query_aabb(area, out, seen)
	return collision2d.world_index:query_aabb(area, out, seen)
end

collision2d.detect_aabb_areas = detect_aabb_areas
collision2d.area_to_poly = area_to_poly
collision2d.polygons_intersect = polygons_intersect

return collision2d
