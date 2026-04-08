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

local collision2d<const> = {}
local clear_map<const> = require('clear_map')
local round_to_nearest<const> = require('round_to_nearest')
local world_instance<const> = require('world').instance
local active_scope<const> = { scope = 'active' }

local eps<const> = 1e-8
local eps_parallel<const> = 1e-12
local geo_fix16_scale<const> = 65536
local geo_sat_vertex_bytes<const> = 8
local geo_sat_desc_bytes<const> = 16
local geo_sat_pair_bytes<const> = 20
local geo_sat_result_bytes<const> = 20
local geo_batch_token = 0

local detect_aabb_areas<const> = function(a, b)
	return not (a.left > b.right or a.right < b.left or a.bottom < b.top or a.top > b.bottom)
end

local area_to_poly<const> = function(area)
	return {
		area.left, area.top,
		area.right, area.top,
		area.right, area.bottom,
		area.left, area.bottom,
	}
end

local clear_array<const> = function(array)
	for i = #array, 1, -1 do
		array[i] = nil
	end
end

local point_in_poly<const> = function(px, py, poly)
	local inside = false
	local j = #poly - 1
	for i = 1, #poly, 2 do
		local xi<const> = poly[i]
		local yi<const> = poly[i + 1]
		local xj<const> = poly[j]
		local yj<const> = poly[j + 1]
		if ((yi > py) ~= (yj > py)) and (px < ((xj - xi) * (py - yi) / (((yj - yi) ~= 0 and (yj - yi) or eps_parallel)) + xi)) then
			inside = not inside
		end
		j = i
	end
	return inside
end

local orient2d<const> = function(ax, ay, bx, by, cx, cy)
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
end

local point_on_segment<const> = function(ax, ay, bx, by, cx, cy)
	local min_x<const> = ax < bx and ax or bx
	local max_x<const> = ax > bx and ax or bx
	local min_y<const> = ay < by and ay or by
	local max_y<const> = ay > by and ay or by
	return cx >= min_x and cx <= max_x and cy >= min_y and cy <= max_y
end

local project_poly_axis<const> = function(poly, ax, ay)
	local min_proj = math.huge
	local max_proj = -math.huge
	for i = 1, #poly, 2 do
		local proj<const> = (poly[i] * ax) + (poly[i + 1] * ay)
		if proj < min_proj then
			min_proj = proj
		end
		if proj > max_proj then
			max_proj = proj
		end
	end
	return min_proj, max_proj
end

local test_circle_poly_axis<const> = function(poly, circle, ax, ay, best_axis_x, best_axis_y, best_overlap)
	local pmin<const>, pmax<const> = project_poly_axis(poly, ax, ay)
	local cproj<const> = (circle.x * ax) + (circle.y * ay)
	local cmin<const> = cproj - circle.r
	local cmax<const> = cproj + circle.r
	local sep<const> = math.max(pmin - cmax, cmin - pmax)
	if sep > 0 then
		return false, best_axis_x, best_axis_y, best_overlap
	end
	local overlap<const> = -sep
	if overlap < best_overlap then
		return true, ax, ay, overlap
	end
	return true, best_axis_x, best_axis_y, best_overlap
end

local test_poly_pair_axis<const> = function(poly_a, poly_b, ax, ay, best_axis_x, best_axis_y, best_overlap)
	local min_a<const>, max_a<const> = project_poly_axis(poly_a, ax, ay)
	local min_b<const>, max_b<const> = project_poly_axis(poly_b, ax, ay)
	local sep<const> = math.max(min_a - max_b, min_b - max_a)
	if sep > 0 then
		return false, best_axis_x, best_axis_y, best_overlap
	end
	local overlap<const> = -sep
	if overlap < best_overlap then
		return true, ax, ay, overlap
	end
	return true, best_axis_x, best_axis_y, best_overlap
end

local test_poly_pair_axes<const> = function(poly, poly_a, poly_b, best_axis_x, best_axis_y, best_overlap)
	for i = 1, #poly, 2 do
		local ni<const> = (i + 2 > #poly) and 1 or (i + 2)
		local nx<const> = -(poly[ni + 1] - poly[i + 1])
		local ny<const> = poly[ni] - poly[i]
		local edge_len<const> = math.sqrt((nx * nx) + (ny * ny))
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

local single_polygons_intersect<const> = function(poly1, poly2)
	for i = 1, #poly1, 2 do
		local ax<const> = poly1[i]
		local ay<const> = poly1[i + 1]
		local ni<const> = (i + 2 > #poly1) and 1 or (i + 2)
		local bx<const> = poly1[ni]
		local by<const> = poly1[ni + 1]
		for j = 1, #poly2, 2 do
			local cx<const> = poly2[j]
			local cy<const> = poly2[j + 1]
			local nj<const> = (j + 2 > #poly2) and 1 or (j + 2)
			local dx<const> = poly2[nj]
			local dy<const> = poly2[nj + 1]
			local o1<const> = orient2d(ax, ay, bx, by, cx, cy)
			local o2<const> = orient2d(ax, ay, bx, by, dx, dy)
			local o3<const> = orient2d(cx, cy, dx, dy, ax, ay)
			local o4<const> = orient2d(cx, cy, dx, dy, bx, by)
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

local polygons_intersect<const> = function(polys1, polys2)
	for i = 1, #polys1 do
		local p1<const> = polys1[i]
		for j = 1, #polys2 do
			local p2<const> = polys2[j]
			if single_polygons_intersect(p1, p2) then
				return true
			end
		end
	end
	return false
end

local circle_circle_overlap<const> = function(a, b)
	local dx<const> = a.x - b.x
	local dy<const> = a.y - b.y
	local rr<const> = a.r + b.r
	return ((dx * dx) + (dy * dy)) <= (rr * rr)
end

local circle_poly_overlap<const> = function(circle, polys)
	for i = 1, #polys do
		local poly<const> = polys[i]
		for j = 1, #poly, 2 do
			local ni<const> = (j + 2 > #poly) and 1 or (j + 2)
			local ex<const> = poly[ni] - poly[j]
			local ey<const> = poly[ni + 1] - poly[j + 1]
			local nx<const> = -ey
			local ny<const> = ex
			local length<const> = math.sqrt((nx * nx) + (ny * ny))
			if length > eps then
				local ax<const> = nx / length
				local ay<const> = ny / length
				local pmin = math.huge
				local pmax = -math.huge
				for k = 1, #poly, 2 do
					local proj<const> = (poly[k] * ax) + (poly[k + 1] * ay)
					if proj < pmin then
						pmin = proj
					end
					if proj > pmax then
						pmax = proj
					end
				end
				local cproj<const> = (circle.x * ax) + (circle.y * ay)
				local cmin<const> = cproj - circle.r
				local cmax<const> = cproj + circle.r
				local sep<const> = math.max(pmin - cmax, cmin - pmax)
				if sep > 0 then
					return false
				end
			end
		end
		local vx = poly[1]
		local vy = poly[2]
		local best_d = ((vx - circle.x) * (vx - circle.x)) + ((vy - circle.y) * (vy - circle.y))
		for j = 3, #poly, 2 do
			local dx<const> = poly[j] - circle.x
			local dy<const> = poly[j + 1] - circle.y
			local d<const> = (dx * dx) + (dy * dy)
			if d < best_d then
				best_d = d
				vx = poly[j]
				vy = poly[j + 1]
			end
		end
		local ax<const> = vx - circle.x
		local ay<const> = vy - circle.y
		local axis_len<const> = math.sqrt((ax * ax) + (ay * ay))
		if axis_len > eps then
			local ux<const> = ax / axis_len
			local uy<const> = ay / axis_len
			local pmin = math.huge
			local pmax = -math.huge
			for k = 1, #poly, 2 do
				local proj<const> = (poly[k] * ux) + (poly[k + 1] * uy)
				if proj < pmin then
					pmin = proj
				end
				if proj > pmax then
					pmax = proj
				end
			end
			local cproj<const> = (circle.x * ux) + (circle.y * uy)
			local cmin<const> = cproj - circle.r
			local cmax<const> = cproj + circle.r
			local sep<const> = math.max(pmin - cmax, cmin - pmax)
			if sep > 0 then
				return false
			end
		end
	end
	return true
end

local contact_circle_circle<const> = function(a, b)
	local dx<const> = a.x - b.x
	local dy<const> = a.y - b.y
	local dist<const> = math.sqrt((dx * dx) + (dy * dy))
	local rr<const> = a.r + b.r
	if dist >= rr then
		return nil
	end
	local depth<const> = rr - dist
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

local contact_aabb_aabb<const> = function(a, b)
	local center_ax<const> = (a.left + a.right) / 2
	local center_ay<const> = (a.top + a.bottom) / 2
	local center_bx<const> = (b.left + b.right) / 2
	local center_by<const> = (b.top + b.bottom) / 2
	local dx<const> = center_ax - center_bx
	local dy<const> = center_ay - center_by
	local half_w<const> = ((a.right - a.left) + (b.right - b.left)) / 2
	local half_h<const> = ((a.bottom - a.top) + (b.bottom - b.top)) / 2
	local overlap_x<const> = half_w - math.abs(dx)
	local overlap_y<const> = half_h - math.abs(dy)
	if overlap_x <= 0 or overlap_y <= 0 then
		return nil
	end
	local point<const> = {
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

local contact_circle_poly<const> = function(circle, polys)
	local best_axis_x = nil
	local best_axis_y = nil
	local best_overlap = math.huge

	for i = 1, #polys do
		local poly<const> = polys[i]
		for j = 1, #poly, 2 do
			local ni<const> = (j + 2 > #poly) and 1 or (j + 2)
			local nx<const> = -(poly[ni + 1] - poly[j + 1])
			local ny<const> = poly[ni] - poly[j]
			local edge_len<const> = math.sqrt((nx * nx) + (ny * ny))
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
			local dx<const> = poly[j] - circle.x
			local dy<const> = poly[j + 1] - circle.y
			local d<const> = (dx * dx) + (dy * dy)
			if d < best_d then
				best_d = d
				vx = poly[j]
				vy = poly[j + 1]
			end
		end
		local ax<const> = vx - circle.x
		local ay<const> = vy - circle.y
		local axis_len<const> = math.sqrt((ax * ax) + (ay * ay))
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

local contact_poly_pair<const> = function(poly_a, poly_b)
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

local contact_poly_poly<const> = function(polys_a, polys_b)
	local best = nil
	for i = 1, #polys_a do
		local poly_a<const> = polys_a[i]
		for j = 1, #polys_b do
			local poly_b<const> = polys_b[j]
			local contact<const> = contact_poly_pair(poly_a, poly_b)
			if contact ~= nil and (best == nil or contact.depth < best.depth) then
				best = contact
			end
		end
	end
	return best
end

local is_geo_sat_pair<const> = function(kind_a, kind_b)
	if kind_a == 'poly' and kind_b == 'poly' then
		return true
	end
	if kind_a == 'poly' and kind_b == 'aabb' then
		return true
	end
	return kind_a == 'aabb' and kind_b == 'poly'
end

local get_geo_sat_polys<const> = function(collider, kind)
	if kind == 'poly' then
		return collider:get_world_polys()
	end
	if kind == 'aabb' then
		return collider:get_world_area_polys()
	end
	error('[collision2d] GEO SAT unsupported shape kind "' .. tostring(kind) .. '" for collider ' .. tostring(collider.id))
end

local count_geo_sat_collider_bytes<const> = function(collider, kind)
	local polys<const> = get_geo_sat_polys(collider, kind)
	if polys == nil or #polys == 0 then
		error('[collision2d] GEO SAT expected staged polygons for collider ' .. tostring(collider.id))
	end
	local vertex_bytes = 0
	for i = 1, #polys do
		local poly<const> = polys[i]
		local coord_count<const> = #poly
		if coord_count < 6 or (coord_count & 1) ~= 0 then
			error('[collision2d] GEO SAT expected convex polygon with at least 3 vertices for collider ' .. tostring(collider.id))
		end
		vertex_bytes = vertex_bytes + coord_count * 4
	end
	return #polys, vertex_bytes
end

local stage_geo_sat_collider<const> = function(collider, kind, batch_token, vertex_base, desc_base, vertex_cursor, desc_index)
	if collider._geo_sat_stage_token == batch_token then
		return vertex_cursor, desc_index
	end
	local polys<const> = get_geo_sat_polys(collider, kind)
	collider._geo_sat_desc_first = desc_index
	collider._geo_sat_stage_token = batch_token
	for i = 1, #polys do
		local poly<const> = polys[i]
		local coord_count<const> = #poly
		local vertex_count<const> = coord_count >> 1
		local desc_addr<const> = desc_base + desc_index * geo_sat_desc_bytes
		mem[desc_addr + 0] = sys_geo_shape_convex_poly
		mem[desc_addr + 4] = vertex_count
		mem[desc_addr + 8] = vertex_cursor - vertex_base
		mem[desc_addr + 12] = 0
		for j = 1, coord_count, 2 do
			mem[vertex_cursor + 0] = round_to_nearest(poly[j] * geo_fix16_scale)
			mem[vertex_cursor + 4] = round_to_nearest(poly[j + 1] * geo_fix16_scale)
			vertex_cursor = vertex_cursor + geo_sat_vertex_bytes
		end
		desc_index = desc_index + 1
	end
	return vertex_cursor, desc_index
end

local submit_geo_sat_batch<const> = function(pair_base, desc_base, vertex_base, result_base, pair_count)
	mem[sys_geo_src0] = pair_base
	mem[sys_geo_src1] = desc_base
	mem[sys_geo_src2] = vertex_base
	mem[sys_geo_dst0] = result_base
	mem[sys_geo_dst1] = 0
	mem[sys_geo_count] = pair_count
	mem[sys_geo_param0] = 0
	mem[sys_geo_param1] = 0
	mem[sys_geo_stride0] = geo_sat_pair_bytes
	mem[sys_geo_stride1] = geo_sat_desc_bytes
	mem[sys_geo_stride2] = geo_sat_vertex_bytes
	mem[sys_geo_cmd] = sys_geo_cmd_sat2_batch
	mem[sys_geo_ctrl] = sys_geo_ctrl_start
	local current_status = mem[sys_geo_status]
	while (current_status & sys_geo_status_busy) ~= 0 do
		current_status = mem[sys_geo_status]
	end
	if (current_status & sys_geo_status_rejected) ~= 0 or (current_status & sys_geo_status_error) ~= 0 or (current_status & sys_geo_status_done) == 0 then
		error('[collision2d] GEO SAT batch failed (status=' .. tostring(current_status) .. ', fault=' .. tostring(mem[sys_geo_fault]) .. ')')
	end
end

function collision2d.batch_collides(pairs, pair_count)
	if pair_count == 0 then
		return
	end
	geo_batch_token = geo_batch_token + 1
	if geo_batch_token >= 0x7fffffff then
		geo_batch_token = 1
	end
	local batch_token<const> = geo_batch_token
	local total_desc_count = 0
	local total_vertex_bytes = 0
	local total_geo_pair_count = 0

	for i = 1, pair_count do
		local pair<const> = pairs[i]
		pair.hit = false
		pair.geo_pair_start = 0
		pair.geo_pair_count = 0
		local a<const> = pair.a
		local b<const> = pair.b
		local kind_a<const> = a:get_shape_kind()
		local kind_b<const> = b:get_shape_kind()
		pair.kind_a = kind_a
		pair.kind_b = kind_b
		if is_geo_sat_pair(kind_a, kind_b) then
			if a._geo_sat_count_token ~= batch_token then
				local desc_count_a<const>, vertex_bytes_a<const> = count_geo_sat_collider_bytes(a, kind_a)
				a._geo_sat_count_token = batch_token
				a._geo_sat_desc_count = desc_count_a
				a._geo_sat_vertex_bytes = vertex_bytes_a
				total_desc_count = total_desc_count + desc_count_a
				total_vertex_bytes = total_vertex_bytes + vertex_bytes_a
			end
			if b._geo_sat_count_token ~= batch_token then
				local desc_count_b<const>, vertex_bytes_b<const> = count_geo_sat_collider_bytes(b, kind_b)
				b._geo_sat_count_token = batch_token
				b._geo_sat_desc_count = desc_count_b
				b._geo_sat_vertex_bytes = vertex_bytes_b
				total_desc_count = total_desc_count + desc_count_b
				total_vertex_bytes = total_vertex_bytes + vertex_bytes_b
			end
			pair.geo_pair_count = a._geo_sat_desc_count * b._geo_sat_desc_count
			total_geo_pair_count = total_geo_pair_count + pair.geo_pair_count
		else
			pair.hit = collision2d.collides(a, b)
		end
	end

	if total_geo_pair_count == 0 then
		return
	end

	local vertex_base<const> = sys_geo_scratch_base
	local desc_base<const> = vertex_base + total_vertex_bytes
	local pair_base<const> = desc_base + total_desc_count * geo_sat_desc_bytes
	local result_base<const> = pair_base + total_geo_pair_count * geo_sat_pair_bytes
	local scratch_required<const> = result_base + total_geo_pair_count * geo_sat_result_bytes
	if scratch_required > sys_geo_scratch_base + sys_geo_scratch_size then
		error('[collision2d] GEO SAT scratch overflow (' .. tostring(scratch_required - sys_geo_scratch_base) .. ' > ' .. tostring(sys_geo_scratch_size) .. ')')
	end

	local vertex_cursor = vertex_base
	local desc_index = 0
	local geo_pair_index = 0
	for i = 1, pair_count do
		local pair<const> = pairs[i]
		local geo_pair_count<const> = pair.geo_pair_count
		if geo_pair_count ~= 0 then
			local a<const> = pair.a
			local b<const> = pair.b
			vertex_cursor, desc_index = stage_geo_sat_collider(a, pair.kind_a, batch_token, vertex_base, desc_base, vertex_cursor, desc_index)
			vertex_cursor, desc_index = stage_geo_sat_collider(b, pair.kind_b, batch_token, vertex_base, desc_base, vertex_cursor, desc_index)
			pair.geo_pair_start = geo_pair_index
			local a_desc_first<const> = a._geo_sat_desc_first
			local a_desc_count<const> = a._geo_sat_desc_count
			local b_desc_first<const> = b._geo_sat_desc_first
			local b_desc_count<const> = b._geo_sat_desc_count
			for a_desc = 0, a_desc_count - 1 do
				local shape_a_index<const> = a_desc_first + a_desc
				for b_desc = 0, b_desc_count - 1 do
					local pair_addr<const> = pair_base + geo_pair_index * geo_sat_pair_bytes
					mem[pair_addr + 0] = 0
					mem[pair_addr + 4] = shape_a_index
					mem[pair_addr + 8] = geo_pair_index
					mem[pair_addr + 12] = b_desc_first + b_desc
					mem[pair_addr + 16] = 0
					geo_pair_index = geo_pair_index + 1
				end
			end
		end
	end

	if geo_pair_index ~= total_geo_pair_count then
		error('[collision2d] GEO SAT pair staging mismatch (' .. tostring(geo_pair_index) .. ' ~= ' .. tostring(total_geo_pair_count) .. ')')
	end
	if desc_index ~= total_desc_count then
		error('[collision2d] GEO SAT descriptor staging mismatch (' .. tostring(desc_index) .. ' ~= ' .. tostring(total_desc_count) .. ')')
	end
	if vertex_cursor ~= desc_base then
		error('[collision2d] GEO SAT vertex staging mismatch (' .. tostring(vertex_cursor) .. ' ~= ' .. tostring(desc_base) .. ')')
	end

	submit_geo_sat_batch(pair_base, desc_base, vertex_base, result_base, total_geo_pair_count)

	for i = 1, pair_count do
		local pair<const> = pairs[i]
		local geo_pair_count<const> = pair.geo_pair_count
		if geo_pair_count ~= 0 then
			local result_addr = result_base + pair.geo_pair_start * geo_sat_result_bytes
			for j = 1, geo_pair_count do
				if mem[result_addr] ~= 0 then
					pair.hit = true
					break
				end
				result_addr = result_addr + geo_sat_result_bytes
			end
		end
	end
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
	local area_a<const> = a:get_world_area()
	local area_b<const> = b:get_world_area()
	if not detect_aabb_areas(area_a, area_b) then
		return false
	end
	local kind_a<const> = a:get_shape_kind()
	local kind_b<const> = b:get_shape_kind()
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
	local area_a<const> = a:get_world_area()
	local area_b<const> = b:get_world_area()
	if not detect_aabb_areas(area_a, area_b) then
		return nil
	end
	local kind_a<const> = a:get_shape_kind()
	local kind_b<const> = b:get_shape_kind()
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
		local contact<const> = contact_circle_poly(b:get_world_circle(), a:get_world_polys())
		if contact ~= nil and contact.normal ~= nil then
			contact.normal.x = -contact.normal.x
			contact.normal.y = -contact.normal.y
		end
		return contact
	end
	if kind_a == 'aabb' and kind_b == 'circle' then
		local contact<const> = contact_circle_poly(b:get_world_circle(), a:get_world_area_polys())
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

local broadphase_index<const> = {}
broadphase_index.__index = broadphase_index

function broadphase_index.new(cell_size)
	local self<const> = setmetatable({}, broadphase_index)
	self.cell_size = cell_size or 64
	self.cells = {}
	self.row_pool = {}
	self.set_pool = {}
	return self
end

function broadphase_index:cell_coords_for_area(area)
	local cs<const> = self.cell_size
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
	local area<const> = collider:get_world_area()
	local cx0<const>, cy0<const>, cx1<const>, cy1<const> = self:cell_coords_for_area(area)
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
	local cx0<const>, cy0<const>, cx1<const>, cy1<const> = self:cell_coords_for_area(area)
	for cy = cy0, cy1 do
		for cx = cx0, cx1 do
			local row<const> = self.cells[cx]
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
	local index<const> = collision2d.world_index
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
