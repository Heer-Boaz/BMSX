-- overlap_2d.lua
-- 2D-overlap ECS system.

--
-- DESIGN PRINCIPLES — collision handling via the 2D-overlap system
--
-- 1. NEVER WRITE CUSTOM COLLISION LOOPS IN CART CODE WHEN YOU WANT
--    EVENT-STYLE OVERLAPS.
--    The 2D-overlap system is an opt-in ECS stage. Carts that want automatic
--    overlap events add it to their pipeline; carts that do not can stick to
--    targeted collision queries. When enabled, it detects all overlapping
--    active+hittable collider pairs in the active world space and emits
--    three events on BOTH owner objects' event ports:
--
--      overlap.begin  — first frame two colliders touch (phase = 'begin')
--      overlap.stay   — every subsequent frame they remain touching (phase = 'stay')
--      overlap.end    — first frame they separate (phase = 'end', contact = nil)
--
--    Subscribe in bind(), not in update():
--
--      WRONG — manual loop every frame:
--        function hero:update(dt)
--          for enemy in objects_by_tag('enemy') do
--            if collision2d.collides(self.collider, enemy.collider) then ...
--
--      RIGHT — reactive subscription:
--        function hero:bind()
--          self:on('overlap.begin', function(e)
--            if e.other_layer == LAYER_ENEMY then
--              self:take_damage()
--            end
--          end)
--        end
--
-- 2. OVERLAP EVENT PAYLOAD FIELDS
--    Every overlap event carries a table with the following fields:
--
--      e.other_id              — world ID of the other object
--      e.other_collider_id     — component handle of the other collider
--      e.other_collider_local_id — local slot index of the other collider
--      e.other_layer           — layer bitmask of the other collider
--      e.other_mask            — mask bitmask of the other collider
--      e.collider_id           — component handle of this object's collider
--      e.collider_local_id     — local slot index of this object's collider
--      e.collider_layer        — layer bitmask of this object's collider
--      e.collider_mask         — mask bitmask of this object's collider
--      e.contact               — { normal={x,y}, depth, point={x,y} } or nil (overlap.end)
--      e.phase                 — 'begin' | 'stay' | 'end'
--
--    The overlap event and contact records are retained system scratch and
--    dispatch synchronously. Read them inside the handler; do not retain the
--    record after the handler returns.
--
-- 3. LAYER / MASK FILTERING
--    A pair is only tested when (a.layer & b.mask) != 0 OR (b.layer & a.mask) != 0.
--    Both colliders must also have hittable=true.
--    Carts program these raw bitmasks when constructing each collider.

local collider2dcomponent<const> = require('cartlib/collision/collider_2d_component')
local system_module<const> = require('cartlib/world/system')

local tick_group<const> = system_module.tick_group
local system<const> = system_module.system

local clear_map<const> = require('cartlib/util/clear_map')
local collision2d<const> = require('cartlib/collision2d')
local scratchrecordbatch<const> = require('cartlib/util/scratchrecordbatch')

local collider_2d_component_type<const> = collider2dcomponent.type_name

local overlap_2d_system<const> = {}
overlap_2d_system.__index = overlap_2d_system
setmetatable(overlap_2d_system, { __index = system })

-- Pair rows and the event payload are system-owned scratch. The two history
-- maps alternate each frame; released rows return to this system's pool so a
-- stable collider high-water mark does not allocate during physics updates.
local release_pair_rows<const> = function(system, set)
	local row_pool<const> = system.pair_row_pool
	local row_pool_count = system.pair_row_pool_count
	for key, row in pairs(set) do
		clear_map(row)
		row_pool_count = row_pool_count + 1
		row_pool[row_pool_count] = row
		set[key] = nil
	end
	system.pair_row_pool_count = row_pool_count
end

local acquire_pair_row<const> = function(system)
	local row_pool_count<const> = system.pair_row_pool_count
	if row_pool_count == 0 then
		return {}
	end
	local row_pool<const> = system.pair_row_pool
	local row<const> = row_pool[row_pool_count]
	row_pool[row_pool_count] = nil
	system.pair_row_pool_count = row_pool_count - 1
	return row
end

local emit_overlap_event<const> = function(payload, event_type, phase, owner, self_col, other_owner, other_col, contact)
	payload.other_id = other_owner.id
	payload.other_collider_id = other_col.id
	payload.other_collider_local_id = other_col.id_local
	payload.other_layer = other_col.layer
	payload.other_mask = other_col.mask
	payload.collider_id = self_col.id
	payload.collider_local_id = self_col.id_local
	payload.collider_layer = self_col.layer
	payload.collider_mask = self_col.mask
	payload.contact = contact
	payload.phase = phase
	owner.events:emit(event_type, payload)
end

local emit_overlap_end_events<const> = function(payload, prev_pairs, new_pairs)
	local has_new_pairs<const> = new_pairs ~= nil
	for a, row in pairs(prev_pairs) do
		for b in pairs(row) do
			if not (has_new_pairs and new_pairs[a] ~= nil and new_pairs[a][b]) then
				local owner_a<const> = a.parent
				local owner_b<const> = b.parent
				if owner_a.active and owner_b.active then
					emit_overlap_event(payload, 'overlap.end', 'end', owner_a, a, owner_b, b, nil)
					emit_overlap_event(payload, 'overlap.end', 'end', owner_b, b, owner_a, a, nil)
				end
			end
		end
	end
end

function overlap_2d_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.physics, 42), overlap_2d_system)
	self.components = world:_active_component_view(collider_2d_component_type)
	self.prev_pairs = {}
	self.next_pairs = {}
	self.pair_row_pool = {}
	self.pair_row_pool_count = 0
	self.overlap_payload = {
		other_id = false,
		other_collider_id = false,
		other_collider_local_id = false,
		other_layer = 0,
		other_mask = 0,
		collider_id = false,
		collider_local_id = false,
		collider_layer = 0,
		collider_mask = 0,
		contact = false,
		phase = false,
	}
	self.event_colliders = {}
	self.overlap_pairs = scratchrecordbatch.new(64)
	self.event_collider_count = 0
	return self
end

function overlap_2d_system:update()
	local prev_pairs<const> = self.prev_pairs
	local new_pairs<const> = self.next_pairs
	local overlap_pairs<const> = self.overlap_pairs
	local overlap_payload<const> = self.overlap_payload
	release_pair_rows(self, new_pairs)

	local event_colliders<const> = self.event_colliders
	local colliders<const> = self.components.items
	local event_collider_count = 0
	local previous_event_collider_count<const> = self.event_collider_count
	for i = 1, #colliders do
		local collider<const> = colliders[i]
		if collider.hittable then
			event_collider_count = event_collider_count + 1
			event_colliders[event_collider_count] = collider
		end
	end
	for i = event_collider_count + 1, previous_event_collider_count do
		event_colliders[i] = nil
	end
	self.event_collider_count = event_collider_count

	if event_collider_count <= 1 then
		emit_overlap_end_events(overlap_payload, prev_pairs, nil)
		release_pair_rows(self, prev_pairs)
		return
	end

	local overlap_pair_count<const> = collision2d.collect_overlaps(event_colliders, event_collider_count, overlap_pairs)

	for i = 1, overlap_pair_count do
		local pair<const> = overlap_pairs.items[i]
		local a<const> = pair.a
		local b<const> = pair.b
		local owner_a<const> = a.parent
		local owner_b<const> = b.parent
		local key_a
		local key_b
		if a.id < b.id then
			key_a = a
			key_b = b
		else
			key_a = b
			key_b = a
		end
		local row = new_pairs[key_a]
		if row == nil then
			row = acquire_pair_row(self)
			new_pairs[key_a] = row
		end
		row[key_b] = true
		local prev_row<const> = prev_pairs[key_a]
		if prev_row ~= nil and prev_row[key_b] then
			if owner_a.active and owner_b.active then
				emit_overlap_event(overlap_payload, 'overlap.stay', 'stay', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event(overlap_payload, 'overlap.stay', 'stay', owner_b, b, owner_a, a, pair.contact_other)
			end
		else
			if owner_a.active and owner_b.active then
				emit_overlap_event(overlap_payload, 'overlap.begin', 'begin', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event(overlap_payload, 'overlap.begin', 'begin', owner_b, b, owner_a, a, pair.contact_other)
			end
		end
	end

	emit_overlap_end_events(overlap_payload, prev_pairs, new_pairs)

	self.prev_pairs = new_pairs
	self.next_pairs = prev_pairs
end

function overlap_2d_system:clear()
	release_pair_rows(self, self.prev_pairs)
	release_pair_rows(self, self.next_pairs)
	local event_colliders<const> = self.event_colliders
	for index = 1, self.event_collider_count do
		event_colliders[index] = nil
	end
	self.event_collider_count = 0
	local overlap_items<const> = self.overlap_pairs.items
	for index = 1, #overlap_items do
		clear_map(overlap_items[index])
	end
end

return overlap_2d_system
