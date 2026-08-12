local event_emitter<const> = require('cartlib/event_emitter')
local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()

local owner<const> = {
	id = 'timeline_time_warp_test',
	tags = {},
}
function owner:add_tag(tag)
	self.tags[tag] = true
end
function owner:remove_tag(tag)
	self.tags[tag] = nil
end
owner.events = event_emitter.events_of(owner)

local zero_count = 0
local backward_count = 0
local nested_forward_count = 0
local nested_backward_count = 0
owner.events:on({
	event = 'child.zero',
	handler = function()
		zero_count = zero_count + 1
	end,
})
owner.events:on({
	event = 'child.backward',
	handler = function()
		backward_count = backward_count + 1
	end,
})
owner.events:on({
	event = 'nested.forward',
	handler = function()
		nested_forward_count = nested_forward_count + 1
	end,
})
owner.events:on({
	event = 'nested.backward',
	handler = function()
		nested_backward_count = nested_backward_count + 1
	end,
})

local nested<const> = {
	continuous = true,
	duration_ms = 20,
	tracks = {
		{
			kind = 'event',
			keys = {
				{ time_ms = 10, event = 'nested.forward', direction = 'forward' },
				{ time_ms = 10, event = 'nested.backward', direction = 'backward' },
			},
		},
		{
			kind = 'value',
			interpolation = 'step',
			apply = function(target, value)
				target.nested_value = value
			end,
			keys = {
				{ time_ms = 0, value = 1 },
				{ time_ms = 10, value = 2 },
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

local camera<const> = { value = 0 }
local timelines<const> = timeline_component.new({ parent = owner })
timelines:on_attach()

local loop_count = 0
local loop_finished_count = 0
timelines:define('loop_parent', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			playback_mode = 'loop',
			on_loop = function(_target, evaluation)
				assert(evaluation.boundary == timeline_module.playback_boundary.loop)
				loop_count = loop_count + 1
			end,
			on_finished = function()
				loop_finished_count = loop_finished_count + 1
			end,
			sequence = child,
		},
	},
})
timelines:play('loop_parent', { bindings = { camera = camera } })
assert(zero_count == 1 and camera.value == 10)
timelines:tick_active(225)
assert(zero_count == 3 and nested_forward_count == 2)
assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
assert(loop_count == 2 and loop_finished_count == 0)
timelines:tick_active(25)
assert(nested_forward_count == 3 and camera.value == 20 and owner.tags.child_active == nil)
assert(loop_count == 2 and loop_finished_count == 1)

local crossed_finished_count = 0
timelines:define('crossed_finish_parent', {
	continuous = true,
	duration_ms = 100,
	subsequences = {
		{
			id = 'child',
			start_time_ms = 20,
			duration_ms = 20,
			sequence = nested,
			on_finished = function()
				crossed_finished_count = crossed_finished_count + 1
			end,
		},
	},
})
timelines:play('crossed_finish_parent')
timelines:tick_active(50)
assert(crossed_finished_count == 1)
timelines:seek_time('crossed_finish_parent', 0)
timelines:seek_time('crossed_finish_parent', 50)
assert(crossed_finished_count == 1)
timelines:stop('crossed_finish_parent')

local seek_loop_count = 0
local seek_finished_count = 0
timelines:define('seek_parent', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			playback_mode = 'loop',
			on_loop = function()
				seek_loop_count = seek_loop_count + 1
			end,
			on_finished = function()
				seek_finished_count = seek_finished_count + 1
			end,
			sequence = child,
		},
	},
})
local zero_before_seek<const> = zero_count
local nested_before_seek<const> = nested_forward_count
timelines:play('seek_parent', { bindings = { camera = camera } })
timelines:seek_time('seek_parent', 225)
assert(zero_count == zero_before_seek + 1 and nested_forward_count == nested_before_seek)
assert(seek_loop_count == 0 and seek_finished_count == 0)
assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
timelines:scrub_time('seek_parent', 125)
assert(zero_count == zero_before_seek + 1 and nested_forward_count == nested_before_seek)
assert(seek_loop_count == 0 and seek_finished_count == 0 and camera.value == 10)
timelines:seek_time('seek_parent', 250)
assert(seek_loop_count == 0 and seek_finished_count == 0 and owner.tags.child_active == nil)
timelines:stop('seek_parent')

local backward_before_reverse<const> = backward_count
local nested_backward_before_reverse<const> = nested_backward_count
timelines:define('reverse_loop_parent', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			clip_in_ms = 250,
			time_scale = -1,
			playback_mode = 'loop',
			sequence = child,
		},
	},
})
timelines:play('reverse_loop_parent', { bindings = { camera = camera } })
assert(camera.value == 20 and owner.tags.child_active == true)
timelines:tick_active(225)
assert(backward_count == backward_before_reverse + 2)
assert(nested_backward_count == nested_backward_before_reverse + 3)
assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
timelines:tick_active(25)
assert(owner.tags.child_active == nil)

local zero_before_pingpong<const> = zero_count
local backward_before_pingpong<const> = backward_count
local nested_forward_before_pingpong<const> = nested_forward_count
local nested_backward_before_pingpong<const> = nested_backward_count
local pingpong_turn_count = 0
local pingpong_finished_count = 0
timelines:define('pingpong_parent', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			playback_mode = 'pingpong',
			on_turn = function(_target, evaluation)
				assert(evaluation.boundary == timeline_module.playback_boundary.turn)
				pingpong_turn_count = pingpong_turn_count + 1
			end,
			on_finished = function()
				pingpong_finished_count = pingpong_finished_count + 1
			end,
			sequence = child,
		},
	},
})
timelines:play('pingpong_parent', { bindings = { camera = camera } })
timelines:tick_active(225)
assert(zero_count == zero_before_pingpong + 1)
assert(backward_count == backward_before_pingpong + 1)
assert(nested_forward_count == nested_forward_before_pingpong + 1)
assert(nested_backward_count == nested_backward_before_pingpong + 1)
assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
assert(pingpong_turn_count == 2 and pingpong_finished_count == 0)
timelines:tick_active(25)
assert(nested_forward_count == nested_forward_before_pingpong + 2)
assert(camera.value == 20 and owner.tags.child_active == nil)
assert(pingpong_turn_count == 2 and pingpong_finished_count == 1)

local frame_last_count = 0
local frame_backward_count = 0
local frame_tag_start_count = 0
local frame_tag_end_count = 0
owner.events:on({
	event = 'frame.last',
	handler = function()
		frame_last_count = frame_last_count + 1
	end,
})
owner.events:on({
	event = 'frame.backward',
	handler = function()
		frame_backward_count = frame_backward_count + 1
	end,
})
owner.events:on({
	event = 'timeline.tag.frame_active.start',
	handler = function()
		frame_tag_start_count = frame_tag_start_count + 1
	end,
})
owner.events:on({
	event = 'timeline.tag.frame_active.end',
	handler = function()
		frame_tag_end_count = frame_tag_end_count + 1
	end,
})
local frame_child<const> = {
	frames = timeline_module.range(5),
	frame_duration = 20,
	tracks = {
		{
			kind = 'event',
			keys = {
				{ frame = 4, event = 'frame.last', direction = 'backward' },
				{ frame = 3, event = 'frame.backward', direction = 'backward' },
			},
		},
		{
			kind = 'tag',
			name = 'frame_active',
			tag = 'frame_active',
			start = { frame = 1 },
			['end'] = { frame = 4 },
		},
	},
}
timelines:define('frame_reverse_parent', {
	continuous = true,
	duration_ms = 250,
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 250,
			clip_in_ms = 250,
			time_scale = -1,
			playback_mode = 'loop',
			sequence = frame_child,
		},
	},
})
timelines:play('frame_reverse_parent')
assert(owner.tags.frame_active == true)
timelines:tick_active(225)
assert(frame_last_count == 2 and frame_backward_count == 2)
assert(frame_tag_start_count == 2 and frame_tag_end_count == 2)
assert(owner.tags.frame_active == true)
timelines:tick_active(25)
assert(owner.tags.frame_active == nil)

local zero_before_crossed<const> = zero_count
local nested_before_crossed<const> = nested_forward_count
timelines:define('crossed_loop_parent', {
	continuous = true,
	duration_ms = 250,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 50,
			duration_ms = 200,
			playback_mode = 'loop',
			sequence = child,
		},
	},
})
timelines:play('crossed_loop_parent', { bindings = { camera = camera } })
timelines:tick_active(250)
assert(zero_count == zero_before_crossed + 3)
assert(nested_forward_count == nested_before_crossed + 2)
assert(owner.tags.child_active == nil)

local zero_before_active_source<const> = zero_count
local nested_before_active_source<const> = nested_forward_count
timelines:define('active_source_parent', {
	continuous = true,
	duration_ms = 150,
	bindings = { 'camera' },
	subsequences = {
		{
			id = 'child',
			start_time_ms = 50,
			duration_ms = 100,
			clip_in_ms = 25,
			playback_mode = 'loop',
			sequence = child,
		},
	},
})
timelines:play('active_source_parent', { bindings = { camera = camera } })
timelines:tick_active(150)
assert(zero_count == zero_before_active_source + 1)
assert(nested_forward_count == nested_before_active_source + 1)
assert(owner.tags.child_active == nil)

local initial_backward_count = 0
local turn_backward_count = 0
local origin_forward_count = 0
owner.events:on({
	event = 'direction.initial_backward',
	handler = function()
		initial_backward_count = initial_backward_count + 1
	end,
})
owner.events:on({
	event = 'direction.turn_backward',
	handler = function()
		turn_backward_count = turn_backward_count + 1
	end,
})
owner.events:on({
	event = 'direction.origin_forward',
	handler = function()
		origin_forward_count = origin_forward_count + 1
	end,
})
local direction_child<const> = {
	continuous = true,
	duration_ms = 100,
	tracks = {
		{
			kind = 'event',
			keys = {
				{ time_ms = 50, event = 'direction.initial_backward', direction = 'backward' },
				{ time_ms = 100, event = 'direction.turn_backward', direction = 'backward' },
				{ time_ms = 0, event = 'direction.origin_forward', direction = 'forward' },
			},
		},
	},
}
timelines:define('initial_reverse_loop', {
	continuous = true,
	duration_ms = 10,
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 10,
			clip_in_ms = 50,
			time_scale = -1,
			playback_mode = 'loop',
			sequence = direction_child,
		},
	},
})
timelines:play('initial_reverse_loop')
assert(initial_backward_count == 1)
timelines:stop('initial_reverse_loop')
timelines:define('initial_pingpong_turn', {
	continuous = true,
	duration_ms = 10,
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 10,
			clip_in_ms = 100,
			playback_mode = 'pingpong',
			sequence = direction_child,
		},
	},
})
timelines:play('initial_pingpong_turn')
assert(turn_backward_count == 1)
timelines:stop('initial_pingpong_turn')
timelines:define('initial_reverse_pingpong_origin', {
	continuous = true,
	duration_ms = 10,
	subsequences = {
		{
			id = 'child',
			start_time_ms = 0,
			duration_ms = 10,
			time_scale = -1,
			playback_mode = 'pingpong',
			sequence = direction_child,
		},
	},
})
timelines:play('initial_reverse_pingpong_origin')
assert(origin_forward_count == 1)
timelines:stop('initial_reverse_pingpong_origin')

	return nil
end

function __bmsx_host_test.update()
	return true
end
