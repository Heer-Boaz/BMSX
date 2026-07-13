local components<const> = require('cartlib/components')
local worldobject<const> = require('cartlib/world/object')
local world<const> = require('cartlib/world/index').instance

local collisionfixture<const> = {}
collisionfixture.__index = collisionfixture
setmetatable(collisionfixture, { __index = worldobject })

local fixture_a
local fixture_b
local overlap_system
local first_event
local first_contact
local first_pair_row
local begin_count = 0
local stay_count = 0
local end_count = 0
local stage = 0

local on_overlap_begin<const> = function(event)
	assert(event.emitter == fixture_a, 'overlap event owner')
	assert(event.other_id == fixture_b.id, 'overlap other owner')
	assert(event.contact ~= nil, 'overlap begin contact')
	if first_event == nil then
		first_event = event
		first_contact = event.contact
	else
		assert(event == first_event, 'overlap event record retained')
		assert(event.contact == first_contact, 'overlap contact record retained')
	end
	begin_count = begin_count + 1
end

local on_overlap_stay<const> = function(event)
	assert(event == first_event, 'overlap stay event record retained')
	assert(event.contact == first_contact, 'overlap stay contact record retained')
	stay_count = stay_count + 1
end

local on_overlap_end<const> = function(event)
	assert(event == first_event, 'overlap end event record retained')
	assert(event.contact == nil, 'overlap end has no contact')
	end_count = end_count + 1
end

function collisionfixture.new(id, listen)
	local self<const> = setmetatable(worldobject.new({ id = id }), collisionfixture)
	self.listen = listen
	self.collider = components.collider2dcomponent.new({
		local_area = { left = 0, top = 0, right = 16, bottom = 16 },
	})
	self:add_component(self.collider)
	return self
end

function collisionfixture:bind()
	if not self.listen then
		return
	end
	self.events:on({ event = 'overlap.begin', subscriber = self, handler = on_overlap_begin })
	self.events:on({ event = 'overlap.stay', subscriber = self, handler = on_overlap_stay })
	self.events:on({ event = 'overlap.end', subscriber = self, handler = on_overlap_end })
end

local active_pair_row<const> = function()
	for _, row in pairs(overlap_system.prev_pairs) do
		return row
	end
	return nil
end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return oget('pietolon') ~= nil and rget('ecs:overlapevents') ~= nil
end

function __bmsx_host_test.setup()
	overlap_system = rget('ecs:overlapevents')
	add_space('overlap_retained')
	set_space('overlap_retained')
	fixture_a = collisionfixture.new('overlap_fixture_a', true)
	fixture_b = collisionfixture.new('overlap_fixture_b', false)
	world:spawn(fixture_a, { x = 0, y = 0, z = 0 })
	world:spawn(fixture_b, { x = 8, y = 0, z = 0 })
end

function __bmsx_host_test.update(frame)
	if stage == 0 and begin_count == 1 and stay_count >= 1 then
		first_pair_row = active_pair_row()
		assert(first_pair_row ~= nil, 'overlap pair history row')
		fixture_b.x = 32
		stage = 1
	elseif stage == 1 and end_count == 1 then
		fixture_b.x = 8
		stage = 2
	elseif stage == 2 and begin_count == 2 then
		assert(active_pair_row() == first_pair_row, 'overlap pair row retained')
		return true
	end
	assert(frame < 40, 'overlap lifecycle did not complete')
	return false
end
