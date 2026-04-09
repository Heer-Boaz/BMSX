-- collision2d_cpu.lua
-- Exact CPU overlap/contact tests for AABB + polygon colliders.

local collision2d_cpu<const> = {}

local eps<const> = 1e-8
local eps_parallel<const> = 1e-12

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

function collision2d_cpu.collides(a, b)
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
	if kind_a == 'poly' and kind_b == 'poly' then
		return polygons_intersect(a:get_world_polys(), b:get_world_polys())
	end
	if kind_a == 'poly' then
		return polygons_intersect(a:get_world_polys(), b:get_world_area_polys())
	end
	return polygons_intersect(a:get_world_area_polys(), b:get_world_polys())
end

function collision2d_cpu.get_contact2d(a, b)
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
	if kind_a == 'poly' and kind_b == 'poly' then
		return contact_poly_poly(a:get_world_polys(), b:get_world_polys())
	end
	if kind_a == 'poly' then
		return contact_poly_poly(a:get_world_polys(), b:get_world_area_polys())
	end
	return contact_poly_poly(a:get_world_area_polys(), b:get_world_polys())
end

collision2d_cpu.detect_aabb_areas = detect_aabb_areas
collision2d_cpu.area_to_poly = area_to_poly
collision2d_cpu.polygons_intersect = polygons_intersect

return collision2d_cpu
