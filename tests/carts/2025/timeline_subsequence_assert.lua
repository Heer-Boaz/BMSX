local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world_object<const> = require('cartlib/world/world_object')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()

local owner<const> = setmetatable({ id = 'timeline_subsequence_test', value = 0 }, world_object)
world_object.initialize(owner)

local event_count = 0
local backward_count = 0
owner.events:on({
	event = 'child.zero',
	handler = function()
		event_count = event_count + 1
	end,
})
owner.events:on({
	event = 'child.backward',
	handler = function()
		backward_count = backward_count + 1
	end,
})

local camera<const> = { value = 0 }
local nested<const> = {
	continuous = true,
	duration_ms = 20,
	tracks = {
		{
			kind = 'value',
			interpolation = 'step',
			apply = function(target, value)
				target.nested_value = value
			end,
			keys = {
				{ time_ms = 0, value = 7 },
			},
		},
	},
}
local child<const> = {
	continuous = true,
	duration_ms = 100,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'nested',
			start_time_ms = 20,
			duration_ms = 20,
			sequence = nested,
		},
	},
	tracks = {
		{
			kind = 'value',
			interpolation = 'step',
			binding = 'camera',
			apply = function(target, value)
				target.value = value
			end,
			keys = {
				{ time_ms = 0, value = 10 },
				{ time_ms = 50, value = 20 },
			},
		},
		{
			kind = 'event',
			keys = {
				{ time_ms = 0, event = 'child.zero', direction = 'forward' },
				{ time_ms = 80, event = 'child.backward', direction = 'backward' },
			},
		},
		{
			kind = 'tag',
			name = 'active',
			tag = 'child_active',
			start = { time_ms = 20 },
			['end'] = { time_ms = 80 },
		},
	},
}

local timelines<const> = timeline_component.new({ parent = owner })
timelines:on_attach()
timelines:define('parent', {
	continuous = true,
	duration_ms = 300,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 50,
			duration_ms = 100,
			sequence = child,
		},
	},
})
timelines:play('parent', { bindings = { camera = camera } })
assert(camera.value == 0 and event_count == 0)
timelines:tick_active(50)
assert(camera.value == 10 and event_count == 1 and owner.tags.child_active == nil)
timelines:tick_active(25)
assert(camera.value == 10 and owner.tags.child_active == true and owner.nested_value == 7)
timelines:tick_active(30)
assert(camera.value == 20 and owner.tags.child_active == true)
timelines:tick_active(45)
assert(camera.value == 20 and owner.tags.child_active == nil)
timelines:seek_time('parent', 75)
assert(camera.value == 10 and owner.tags.child_active == true and event_count == 1)
timelines:scrub_time('parent', 150)
assert(camera.value == 20 and owner.tags.child_active == nil and event_count == 1)
timelines:stop('parent')
camera.value = 0
timelines:play('parent', { bindings = { camera = camera } })
timelines:advance_time_to('parent', 75)
assert(camera.value == 10 and owner.tags.child_active == true and owner.nested_value == 7 and event_count == 2)
timelines:stop('parent')
camera.value = 0
timelines:play('parent', { bindings = { camera = camera } })
timelines:tick_active(200)
assert(camera.value == 20 and owner.tags.child_active == nil and owner.nested_value == 7 and event_count == 3)
timelines:stop('parent')
timelines:define('reverse_parent', {
	continuous = true,
	duration_ms = 200,
	playback_mode = 'pingpong',
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 50,
			duration_ms = 100,
			sequence = child,
		},
	},
})
timelines:play('reverse_parent', { bindings = { camera = camera } })
timelines:tick_active(200)
timelines:tick_active(51)
assert(backward_count == 0 and owner.tags.child_active == nil)
timelines:tick_active(20)
assert(backward_count == 1 and owner.tags.child_active == true and camera.value == 20)
timelines:tick_active(60)
assert(owner.tags.child_active == nil and camera.value == 10)
timelines:tick_active(20)
assert(owner.tags.child_active == nil)
timelines:stop('reverse_parent')
local events_before_scaled<const> = event_count
timelines:define('scaled_parent', {
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 25,
			clip_in_ms = 25,
			time_scale = 2,
			sequence = child,
		},
	},
})
timelines:play('scaled_parent', { bindings = { camera = camera } })
assert(camera.value == 10 and owner.tags.child_active == true and event_count == events_before_scaled)
timelines:tick_active(25)
assert(camera.value == 20 and owner.tags.child_active == nil and event_count == events_before_scaled)

local position_value<const> = function(target, value)
	target.value = value
end
local position_child<const> = function(start_value, end_value, tag)
	return {
		continuous = true,
		duration_ms = 100,
		bindings = { 'target' },
		tracks = {
			{
				kind = 'value',
				binding = 'target',
				interpolation = 'step',
				apply = position_value,
				keys = {
					{ time_ms = 0, value = start_value },
					{ time_ms = 100, value = end_value },
				},
			},
			{
				kind = 'tag',
				name = 'active',
				tag = tag,
				start = { time_ms = 0 },
				['end'] = { time_ms = 100 },
			},
		},
	}
end
local starting_child<const> = position_child(20, 20, 'starting_active')
local ending_child<const> = position_child(10, 15, 'ending_active')
local overlay_child<const> = position_child(30, 30, 'overlay_active')
local ending_target<const> = { value = 0 }
local layered_target<const> = { value = 0 }
timelines:define('positioned_parent', {
	continuous = true,
	duration_ms = 300,
	bindings = { 'ending_target', 'layered_target' },
	subsequences = {
		{
			id = 'starting',
			start_time_ms = 100,
			duration_ms = 100,
			bindings = { target = 'layered_target' },
			sequence = starting_child,
		},
		{
			id = 'ending',
			start_time_ms = 0,
			duration_ms = 100,
			bindings = { target = 'ending_target' },
			sequence = ending_child,
		},
		{
			id = 'overlay',
			start_time_ms = 50,
			duration_ms = 100,
			bindings = { target = 'layered_target' },
			sequence = overlay_child,
		},
		{
			id = 'later_a',
			start_time_ms = 240,
			duration_ms = 10,
			bindings = { target = 'layered_target' },
			sequence = overlay_child,
		},
		{
			id = 'later_b',
			start_time_ms = 270,
			duration_ms = 10,
			bindings = { target = 'layered_target' },
			sequence = overlay_child,
		},
	},
})
timelines:play('positioned_parent', {
	bindings = {
		ending_target = ending_target,
		layered_target = layered_target,
	},
})
timelines:seek_time('positioned_parent', 100)
assert(ending_target.value == 15 and layered_target.value == 30)
assert(owner.tags.ending_active == nil)
assert(owner.tags.starting_active == true and owner.tags.overlay_active == true)
timelines:scrub_time('positioned_parent', 225)
assert(owner.tags.starting_active == nil and owner.tags.overlay_active == nil)
timelines:stop('positioned_parent')

	return nil
end

function __bmsx_host_test.update()
	return true
end
