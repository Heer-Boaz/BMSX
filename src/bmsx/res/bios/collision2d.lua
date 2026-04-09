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
--    polys (set_local_poly)  > AABB (default).
--    The AABB is computed automatically from parent.sx / parent.sy when no
--    explicit shape is set.  Sprite objects populate polys automatically from
--    the image's imgmeta.hitpolygons (baked at pack-time by the rombuilder).
--    See the @cx / @cc filename suffix notes in sprite.lua.

local collision2d<const> = {}
local collision2d_cpu<const> = require('collision2d_cpu')
local clear_map<const> = require('clear_map')
local round_to_nearest<const> = require('round_to_nearest')
local world_instance<const> = require('world').instance
local active_scope<const> = { scope = 'active' }

local detect_aabb_areas<const> = collision2d_cpu.detect_aabb_areas
local area_to_poly<const> = collision2d_cpu.area_to_poly
local polygons_intersect<const> = collision2d_cpu.polygons_intersect
local geo_fix16_scale<const> = 65536
local geo_overlap_instance_bytes<const> = 48
local geo_overlap_pair_bytes<const> = 16
local geo_overlap_result_bytes<const> = 48
local geo_overlap_summary_bytes<const> = 16
local geo_overlap_param0<const> = sys_geo_overlap_mode_candidate_pairs | sys_geo_overlap_broadphase_none | sys_geo_overlap_contact_clipped_feature | sys_geo_overlap_output_stop_on_overflow
local geo_batch_token = 0

local clear_array<const> = function(array)
	for i = #array, 1, -1 do
		array[i] = nil
	end
end

local is_geo_overlap_pair<const> = function(a, b)
	return a._overlap_geo_blob_base ~= nil and b._overlap_geo_blob_base ~= nil
end

local ensure_pair_contact<const> = function(pair)
	local contact<const> = pair.contact
	if contact ~= nil then
		return contact
	end
	local created<const> = {
		normal = { x = 0, y = 0 },
		depth = 0,
		point = { x = 0, y = 0 },
		piece_a = 0,
		piece_b = 0,
		feature_meta = 0,
	}
	pair.contact = created
	return created
end

local set_pair_contact_from_geo_result<const> = function(pair, result_addr)
	local contact<const> = ensure_pair_contact(pair)
	contact.normal.x = fix16_to_f32(mem[result_addr + 12])
	contact.normal.y = fix16_to_f32(mem[result_addr + 16])
	contact.depth = fix16_to_f32(mem[result_addr + 20])
	contact.point.x = fix16_to_f32(mem[result_addr + 24])
	contact.point.y = fix16_to_f32(mem[result_addr + 28])
	contact.piece_a = mem[result_addr + 32]
	contact.piece_b = mem[result_addr + 36]
	contact.feature_meta = mem[result_addr + 40]
end

local stage_geo_overlap_instance<const> = function(collider, batch_token, instance_base)
	if collider._geo_overlap_stage_token == batch_token then
		return
	end
	local instance_addr<const> = instance_base + collider._geo_overlap_instance_index * geo_overlap_instance_bytes
	memwrite(
		instance_addr,
		0,
		collider._geo_overlap_instance_index + 1,
		collider._overlap_geo_blob_base,
		collider._overlap_geo_shape_offset,
		collider.layer,
		collider.mask,
		geo_fix16_scale,
		0,
		round_to_nearest(collider._overlap_geo_tx * geo_fix16_scale),
		0,
		geo_fix16_scale,
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
		if is_geo_overlap_pair(a, b) then
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
			local contact<const> = collision2d_cpu.get_contact2d(a, b)
			pair.contact = contact
			pair.hit = contact ~= nil
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
				0,
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
		local pair_meta<const> = mem[result_addr + 44]
		if pair_meta < 1 or pair_meta > pair_count then
			error('[collision2d] GEO overlap returned invalid pair meta ' .. tostring(pair_meta))
		end
		local pair<const> = pairs[pair_meta]
		pair.hit = true
		set_pair_contact_from_geo_result(pair, result_addr)
	end
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

collision2d.collides = collision2d_cpu.collides
collision2d.get_contact2d = collision2d_cpu.get_contact2d
collision2d.detect_aabb_areas = detect_aabb_areas
collision2d.area_to_poly = area_to_poly
collision2d.polygons_intersect = polygons_intersect

return collision2d
