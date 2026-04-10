-- collision2d.lua
-- 2D collision GEO orchestration + broadphase index
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
--          for obj in world_instance:objects() do
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
--    Use collision2d.collides() only for cases
--    that genuinely fall outside the per-frame ECS pipeline:
--      a) One-shot hit-scan / ray queries that happen at an arbitrary moment
--         (e.g. 'is there anything at this point right now?').
--      b) Custom broadphase queries in a specialised ECS system you are
--         writing (not in an ordinary object's update()).
--    In all other cases, rely on overlap2dsystem events.
--
-- 3. COLLISION SHAPE PRIORITY (per collider, highest wins).
--    polys (set_local_poly)  > AABB (default).
--    The AABB is computed automatically from parent.sx / parent.sy when no
--    explicit shape is set.  Sprite objects populate polys automatically from
--    the image's imgmeta.hitpolygons (baked at pack-time by the rombuilder).
--    See the @cx / @cc filename suffix notes in sprite.lua.

local collision2d<const> = {}
local clear_map<const> = require('clear_map')
local round_to_nearest<const> = require('round_to_nearest')
local world_instance<const> = require('world').instance

local detect_aabb_areas<const> = function(a, b)
	return not (a.left > b.right or a.right < b.left or a.bottom < b.top or a.top > b.bottom)
end

local orient2d<const> = function(ax, ay, bx, by, cx, cy)
	return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
end

local geo_fix16_scale<const> = 65536
local geo_overlap_instance_bytes<const> = 12
local geo_overlap_pair_bytes<const> = 12
local geo_overlap_result_bytes<const> = 36
local geo_overlap_summary_bytes<const> = 16
local geo_overlap_param0<const> = sys_geo_overlap_mode_candidate_pairs | sys_geo_overlap_broadphase_none | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_batch_token = 0
local direct_query_pair<const> = {
	a = nil,
	b = nil,
	hit = false,
	geo_pair_index = -1,
	contact = nil,
	contact_other = nil,
}
local direct_query_pairs<const> = { direct_query_pair }

local stage_geo_overlap_instance<const> = function(collider, batch_token, instance_base)
	if collider._geo_overlap_stage_token == batch_token then
		return
	end
	local instance_addr<const> = instance_base + collider._geo_overlap_instance_index * geo_overlap_instance_bytes
	memwrite(
		instance_addr,
		collider._overlap_geo_shape_ref,
		round_to_nearest(collider._overlap_geo_tx * geo_fix16_scale),
		round_to_nearest(collider._overlap_geo_ty * geo_fix16_scale)
	)
	collider._geo_overlap_stage_token = batch_token
end

local submit_geo_overlap_batch<const> = function(instance_base, pair_base, result_base, summary_base, instance_count, pair_count)
	memwrite(
		sys_geo_src0,
		instance_base,
		pair_base,
		0,
		result_base,
		summary_base,
		pair_count
	)
	memwrite(
		sys_geo_param0,
		geo_overlap_param0,
		pair_count,
		geo_overlap_instance_bytes,
		geo_overlap_pair_bytes,
		instance_count
	)
	memwrite(
		sys_geo_cmd,
		sys_geo_cmd_overlap2d_pass,
		sys_geo_ctrl_start
	)
	local current_status = mem[sys_geo_status]
	while (current_status & sys_geo_status_busy) ~= 0 do
		current_status = mem[sys_geo_status]
	end
	if (current_status & sys_geo_status_rejected) ~= 0 or (current_status & sys_geo_status_error) ~= 0 or (current_status & sys_geo_status_done) == 0 then
		error('[collision2d] GEO overlap batch failed (status=' .. tostring(current_status) .. ', fault=' .. tostring(mem[sys_geo_fault]) .. ')')
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
	local geo_pair_count = 0
	local instance_count = 0

	for i = 1, pair_count do
		local pair<const> = pairs[i]
		pair.hit = false
		pair.geo_pair_index = -1
		local a<const> = pair.a
		local b<const> = pair.b
		if a._overlap_geo_shape_ref ~= nil and b._overlap_geo_shape_ref ~= nil then
			if a._geo_overlap_instance_token ~= batch_token then
				a._geo_overlap_instance_token = batch_token
				a._geo_overlap_instance_index = instance_count
				instance_count = instance_count + 1
			end
			if b._geo_overlap_instance_token ~= batch_token then
				b._geo_overlap_instance_token = batch_token
				b._geo_overlap_instance_index = instance_count
				instance_count = instance_count + 1
			end
			pair.geo_pair_index = geo_pair_count
			geo_pair_count = geo_pair_count + 1
		else
			error('[collision2d] GEO overlap requires baked collision bin data: ' .. tostring(a.id) .. ' / ' .. tostring(b.id))
		end
	end

	if geo_pair_count == 0 then
		return
	end

	local instance_base<const> = sys_geo_scratch_base
	local pair_base<const> = instance_base + instance_count * geo_overlap_instance_bytes
	local result_base<const> = pair_base + geo_pair_count * geo_overlap_pair_bytes
	local summary_base<const> = result_base + geo_pair_count * geo_overlap_result_bytes
	local scratch_required<const> = summary_base + geo_overlap_summary_bytes
	if scratch_required > sys_geo_scratch_base + sys_geo_scratch_size then
		error('[collision2d] GEO overlap scratch overflow (' .. tostring(scratch_required - sys_geo_scratch_base) .. ' > ' .. tostring(sys_geo_scratch_size) .. ')')
	end

	for i = 1, pair_count do
		local pair<const> = pairs[i]
		if pair.geo_pair_index >= 0 then
			local a<const> = pair.a
			local b<const> = pair.b
			stage_geo_overlap_instance(a, batch_token, instance_base)
			stage_geo_overlap_instance(b, batch_token, instance_base)
			local pair_addr<const> = pair_base + pair.geo_pair_index * geo_overlap_pair_bytes
			memwrite(
				pair_addr,
				a._geo_overlap_instance_index,
				b._geo_overlap_instance_index,
				i
			)
		end
	end

	submit_geo_overlap_batch(instance_base, pair_base, result_base, summary_base, instance_count, geo_pair_count)

	local result_count<const> = mem[summary_base + 0]
	for i = 0, result_count - 1 do
		local result_addr<const> = result_base + i * geo_overlap_result_bytes
		local pair_meta<const> = mem[result_addr + 32]
		if pair_meta < 1 or pair_meta > pair_count then
			error('[collision2d] GEO overlap returned invalid pair meta ' .. tostring(pair_meta))
		end
		local pair<const> = pairs[pair_meta]
		local contact = pair.contact
		local contact_other = pair.contact_other
		if contact == nil then
			contact = {
				normal = { x = 0, y = 0 },
				depth = 0,
				point = { x = 0, y = 0 },
				piece_a = 0,
				piece_b = 0,
				feature_meta = 0,
			}
			contact_other = {
				normal = { x = 0, y = 0 },
				depth = 0,
				point = { x = 0, y = 0 },
				piece_a = 0,
				piece_b = 0,
				feature_meta = 0,
			}
			pair.contact = contact
			pair.contact_other = contact_other
		end
		local normal_x<const> = fix16_to_f32(mem[result_addr + 0])
		local normal_y<const> = fix16_to_f32(mem[result_addr + 4])
		local depth<const> = fix16_to_f32(mem[result_addr + 8])
		local point_x<const> = fix16_to_f32(mem[result_addr + 12])
		local point_y<const> = fix16_to_f32(mem[result_addr + 16])
		local piece_a<const> = mem[result_addr + 20]
		local piece_b<const> = mem[result_addr + 24]
		local feature_meta<const> = mem[result_addr + 28]
		pair.hit = true
		contact.normal.x = normal_x
		contact.normal.y = normal_y
		contact.depth = depth
		contact.point.x = point_x
		contact.point.y = point_y
		contact.piece_a = piece_a
		contact.piece_b = piece_b
		contact.feature_meta = feature_meta
		contact_other.normal.x = -normal_x
		contact_other.normal.y = -normal_y
		contact_other.depth = depth
		contact_other.point.x = point_x
		contact_other.point.y = point_y
		contact_other.piece_a = piece_b
		contact_other.piece_b = piece_a
		contact_other.feature_meta = feature_meta
	end
end

local broadphase_index<const> = {}
broadphase_index.__index = broadphase_index

function broadphase_index.new(cell_size)
	local self<const> = setmetatable({}, broadphase_index)
	self.cell_size = cell_size or 64
	-- Sparse grid: cells[cx][cy][collider] = true.
	self.cells = {}
	self.row_pool = {}
	self.set_pool = {}
	return self
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

function broadphase_index:add(collider)
	local area<const> = collider:get_world_area()
	local cs<const> = self.cell_size
	local cx0<const> = math.floor(area.left / cs)
	local cy0<const> = math.floor(area.top / cs)
	local cx1<const> = math.floor(area.right / cs)
	local cy1<const> = math.floor(area.bottom / cs)
	local cells<const> = self.cells
	local row_pool<const> = self.row_pool
	local set_pool<const> = self.set_pool
	for cx = cx0, cx1 do
		local row = cells[cx]
		if row == nil then
			local row_pool_index<const> = #row_pool
			row = row_pool[row_pool_index]
			if row == nil then
				row = {}
			else
				row_pool[row_pool_index] = nil
			end
			cells[cx] = row
		end
		for cy = cy0, cy1 do
			local set = row[cy]
			if set == nil then
				local set_pool_index<const> = #set_pool
				set = set_pool[set_pool_index]
				if set == nil then
					set = {}
				else
					set_pool[set_pool_index] = nil
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
	clear_map(seen)
	local out_count = 0
	local cs<const> = self.cell_size
	local cx0<const> = math.floor(area.left / cs)
	local cy0<const> = math.floor(area.top / cs)
	local cx1<const> = math.floor(area.right / cs)
	local cy1<const> = math.floor(area.bottom / cs)
	local cells<const> = self.cells
	for cx = cx0, cx1 do
		local row<const> = cells[cx]
		if row ~= nil then
			for cy = cy0, cy1 do
				local set<const> = row[cy]
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
	end
	out[out_count + 1] = nil
	return out, out_count
end

collision2d.world_index = broadphase_index.new(64)

function collision2d.collides(a, b)
	if not a.hittable or not b.hittable then
		return nil
	end
	a:get_world_area()
	if b ~= a then
		b:get_world_area()
	end
	if a._overlap_geo_shape_ref == nil or b._overlap_geo_shape_ref == nil then
		error('[collision2d] GEO overlap requires baked collision bin data: ' .. tostring(a.id) .. ' / ' .. tostring(b.id))
	end
	local pair<const> = direct_query_pair
	pair.a = a
	pair.b = b
	pair.hit = false
	pair.geo_pair_index = -1
	collision2d.batch_collides(direct_query_pairs, 1)
	if b ~= a then
		b._overlap_cache_valid = false
		b._world_polys_cache_valid = false
	end
	a._overlap_cache_valid = false
	a._world_polys_cache_valid = false
	if not pair.hit then
		return nil
	end
	return pair.contact
end

return collision2d
