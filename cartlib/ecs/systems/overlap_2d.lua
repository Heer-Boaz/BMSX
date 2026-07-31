-- overlap_2d.lua
-- overlapevents pipeline system.

--
-- DESIGN PRINCIPLES — collision handling via overlap2dsystem
--
-- 1. NEVER WRITE CUSTOM COLLISION LOOPS IN CART CODE WHEN YOU WANT
--    EVENT-STYLE OVERLAPS.
--    overlap2dsystem is an opt-in ECS stage. Carts that want automatic
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
--    Use collision_profiles to assign named layer+mask presets rather than
--    setting layer/mask directly.

local ecs<const> = require('cartlib/ecs/index')
local component_types<const> = require('cartlib/components/types')
local world_instance<const> = require('cartlib/world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local clear_map<const> = require('cartlib/util/clear_map')
local collision2d<const> = require('cartlib/collision2d')
local scratchrecordbatch<const> = require('cartlib/util/scratchrecordbatch')

local overlap_component_type<const> = component_types.collider_2d

local overlap2dsystem<const> = {}
overlap2dsystem.__index = overlap2dsystem
setmetatable(overlap2dsystem, { __index = ecsystem })

-- Pair rows and the event record are system-owned scratch. The two history
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

local emit_overlap_event<const> = function(event, event_name, phase, owner, self_col, other_owner, other_col, contact)
	event.type = event_name
	event.emitter = owner
	event.other_id = other_owner.id
	event.other_collider_id = other_col.id
	event.other_collider_local_id = other_col.id_local
	event.other_layer = other_col.layer
	event.other_mask = other_col.mask
	event.collider_id = self_col.id
	event.collider_local_id = self_col.id_local
	event.collider_layer = self_col.layer
	event.collider_mask = self_col.mask
	event.contact = contact
	event.phase = phase
	owner.events:emit_event(event)
end

local emit_overlap_end_events<const> = function(event, prev_pairs, new_pairs)
	local has_new_pairs<const> = new_pairs ~= nil
	for a, row in pairs(prev_pairs) do
		for b in pairs(row) do
			if not (has_new_pairs and new_pairs[a] ~= nil and new_pairs[a][b]) then
				local owner_a<const> = a.parent
				local owner_b<const> = b.parent
				if owner_a.active and owner_b.active then
					emit_overlap_event(event, 'overlap.end', 'end', owner_a, a, owner_b, b, nil)
					emit_overlap_event(event, 'overlap.end', 'end', owner_b, b, owner_a, a, nil)
				end
			end
		end
	end
end

function overlap2dsystem.new(priority)
	local self<const> = setmetatable(ecsystem.new(tickgroup.physics, priority), overlap2dsystem)
	self.prev_pairs = {}
	self.next_pairs = {}
	self.pair_row_pool = {}
	self.pair_row_pool_count = 0
	self.overlap_event = {}
	self.event_colliders = {}
	self.overlap_pairs = scratchrecordbatch.new(64)
	self.event_collider_count = 0
	return self
end

function overlap2dsystem:update()
	local prev_pairs<const> = self.prev_pairs
	local new_pairs<const> = self.next_pairs
	local overlap_pairs<const> = self.overlap_pairs
	local overlap_event<const> = self.overlap_event
	release_pair_rows(self, new_pairs)

	local event_colliders<const> = self.event_colliders
	local colliders<const> = world_instance.active_space.active_components_by_type[overlap_component_type]
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
		emit_overlap_end_events(overlap_event, prev_pairs, nil)
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
				emit_overlap_event(overlap_event, 'overlap.stay', 'stay', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event(overlap_event, 'overlap.stay', 'stay', owner_b, b, owner_a, a, pair.contact_other)
			end
		else
			if owner_a.active and owner_b.active then
				emit_overlap_event(overlap_event, 'overlap.begin', 'begin', owner_a, a, owner_b, b, pair.contact)
				emit_overlap_event(overlap_event, 'overlap.begin', 'begin', owner_b, b, owner_a, a, pair.contact_other)
			end
		end
	end

	emit_overlap_end_events(overlap_event, prev_pairs, new_pairs)

	self.prev_pairs = new_pairs
	self.next_pairs = prev_pairs
end

return {
	id = 'overlapevents',
	group = tickgroup.physics,
	default_priority = 42,
	create = overlap2dsystem.new,
}
