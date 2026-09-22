local timeline_module<const> = require('cartlib/timeline/timeline')
local timeline_clock_source<const> = require('cartlib/timeline/clock_source')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world_object<const> = require('cartlib/world/world_object')

return {
	kind = 'unit',
	tests = {
		linear_value = function()

			local owner<const> = setmetatable({ id = 'timeline_linear_value_test' }, world_object)
			world_object.initialize(owner)

			local timelines<const> = timeline_component.new({ parent = owner })
			timelines:on_attach()
			local target<const> = { value = -1, method = -1 }
			timelines:define('time_linear', {
				continuous = true,
				duration_ms = 100,
				tracks = {
					{
						kind = 'value',
						interpolation = 'linear',
						apply = function(binding, value, _params, evaluation)
							binding.value = value
							binding.method = evaluation.method
						end,
						keys = {
							{ time_ms = 100, value = 0 },
							{ time_ms = 0, value = 0 },
							{ time_ms = 50, value = 20 },
						},
					},
				},
			})
			timelines:play('time_linear', { target = target })
			assert(target.value == 0 and target.method == timeline_module.update_method.play)
			timelines:tick_gameplay(25)
			assert(target.value == 10)
			timelines:tick_gameplay(25)
			assert(target.value == 20)
			timelines:seek_time('time_linear', 75)
			assert(target.value == 10 and target.method == timeline_module.update_method.jump)
			timelines:scrub_time('time_linear', 100)
			assert(target.value == 0 and target.method == timeline_module.update_method.scrub)
			timelines:seek_time('time_linear', 25)
			assert(target.value == 10 and target.method == timeline_module.update_method.jump)
			timelines:stop('time_linear')

			local frame_target<const> = { nested = { value = -1, other = -1, constant = -1 } }
			timelines:define('frame_linear', {
				frames = timeline_module.range(5),
				frame_duration = 20,
				tracks = {
					{
						kind = 'value',
						interpolation = 'linear',
						path = { 'nested', 'value' },
						keys = {
							{ frame = 0, value = 0 },
							{ frame = 4, value = 40 },
						},
					},
					{
						kind = 'value',
						interpolation = 'linear',
						path = { 'nested', 'other' },
						keys = {
							{ frame = 0, value = 5 },
							{ frame = 4, value = 9 },
						},
					},
					{
						kind = 'value',
						interpolation = 'linear',
						path = { 'nested', 'constant' },
						keys = {
							{ frame = 2, value = 7 },
						},
					},
				},
			})
			timelines:play('frame_linear', { target = frame_target })
			assert(frame_target.nested.value == 0 and frame_target.nested.other == 5)
			assert(frame_target.nested.constant == 7)
			timelines:tick_gameplay(20)
			assert(frame_target.nested.value == 10 and frame_target.nested.other == 6)
			timelines:seek('frame_linear', 3)
			assert(frame_target.nested.value == 30 and frame_target.nested.other == 8)
			timelines:stop('frame_linear')

			local built_target<const> = { value = -1 }
			timelines:define('built_frame_linear', {
				frames = function(params)
					return timeline_module.range(params.frame_count)
				end,
				frame_duration = 20,
				tracks = {
					{
						kind = 'value',
						interpolation = 'linear',
						path = { 'value' },
						keys = {
							{ u = 0, value = 0 },
							{ u = 0.5, value = 80 },
							{ u = 1, value = 0 },
						},
					},
				},
			})
			timelines:play('built_frame_linear', {
				target = built_target,
				params = { frame_count = 5 },
			})
			timelines:tick_gameplay(20)
			assert(built_target.value == 40)
			timelines:tick_gameplay(20)
			assert(built_target.value == 80)
			timelines:stop('built_frame_linear')
			timelines:play('built_frame_linear', {
				target = built_target,
				params = { frame_count = 9 },
			})
			timelines:tick_gameplay(20)
			assert(built_target.value == 20)
			timelines:tick_gameplay(20)
			assert(built_target.value == 40)
			timelines:stop('built_frame_linear')

			local pingpong_target<const> = { value = -1 }
			timelines:define('pingpong_linear', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'pingpong',
				tracks = {
					{
						kind = 'value',
						interpolation = 'linear',
						path = { 'value' },
						keys = {
							{ time_ms = 0, value = 0 },
							{ time_ms = 100, value = 100 },
						},
					},
				},
			})
			timelines:play('pingpong_linear', { target = pingpong_target })
			timelines:tick_gameplay(125)
			assert(pingpong_target.value == 75)
			timelines:tick_gameplay(50)
			assert(pingpong_target.value == 25)
			timelines:stop('pingpong_linear')

			local child<const> = {
				continuous = true,
				duration_ms = 100,
				bindings = { 'camera' },
				tracks = {
					{
						kind = 'value',
						interpolation = 'linear',
						binding = 'camera',
						path = { 'value' },
						keys = {
							{ time_ms = 0, value = 0 },
							{ time_ms = 100, value = 100 },
						},
					},
				},
			}
			local camera<const> = { value = -1 }
			timelines:define('nested_linear', {
				continuous = true,
				duration_ms = 250,
				bindings = { 'camera' },
				subsequences = {
					{
						id = 'child',
						start_time_ms = 0,
						duration_ms = 250,
						playback_mode = 'loop',
						sequence = child,
					},
				},
			})
			timelines:play('nested_linear', { bindings = { camera = camera } })
			timelines:tick_gameplay(225)
			assert(camera.value == 25)
			timelines:seek_time('nested_linear', 125)
			assert(camera.value == 25)
			timelines:stop('nested_linear')

			timelines:define('manual_schedule', {
				frames = timeline_module.range(5),
				frame_duration = 20,
				clock_source = timeline_clock_source.manual,
			})
			timelines:play('manual_schedule')
			local manual_schedule<const> = timelines:get('manual_schedule')
			timelines:tick_gameplay(20)
			assert(manual_schedule:value() == 0)
			timelines:advance('manual_schedule')
			assert(manual_schedule:value() == 1)
			timelines:define('manual_schedule', {
				frames = timeline_module.range(5),
				frame_duration = 20,
				clock_source = timeline_clock_source.gameplay,
			})
			timelines:tick_gameplay(20)
			assert(manual_schedule:value() == 2)
			timelines:define('manual_schedule', {
				frames = timeline_module.range(5),
				frame_duration = 20,
				clock_source = timeline_clock_source.manual,
			})
			timelines:tick_gameplay(20)
			assert(manual_schedule:value() == 2)
			timelines:define('manual_schedule', {
				frames = timeline_module.range(1),
				continuous = true,
				clock_source = timeline_clock_source.gameplay,
			})
			timelines:tick_gameplay(7)
			assert(manual_schedule.position_ms == 47)
			timelines:define('manual_schedule', {
				frames = timeline_module.range(5),
				frame_duration = 10,
				clock_source = timeline_clock_source.gameplay,
			})
			timelines:tick_gameplay(10)
			assert(manual_schedule:value() == 3)
			timelines:stop('manual_schedule')

			timelines:define('platform_schedule', {
				frames = timeline_module.range(1),
				continuous = true,
				duration_ms = 100,
				clock_source = timeline_clock_source.platform,
			})
			timelines:define('frame_schedule', {
				frames = timeline_module.range(1),
				continuous = true,
				duration_ms = 100,
				clock_source = timeline_clock_source.frame,
			})
			timelines:play('platform_schedule')
			timelines:play('frame_schedule')
			timelines:tick_frame(20)
			assert(timelines:get('platform_schedule').position_ms == 0)
			assert(timelines:get('frame_schedule').position_ms == 20)
			timelines:tick_platform(20)
			assert(timelines:get('platform_schedule').position_ms == 20)
			timelines:stop('platform_schedule')
			timelines:stop('frame_schedule')

			timelines:define('audio_schedule', {
				frames = timeline_module.range(1),
				continuous = true,
				duration_ms = 100,
				clock_source = timeline_clock_source.audio,
			})
			timelines:play('audio_schedule')
			timelines:tick_audio(25)
			assert(timelines:get('audio_schedule').position_ms == 25)
			timelines:stop('audio_schedule')

			timelines:define('immediate_schedule', {
				frames = timeline_module.range(3),
				frame_duration = 0,
				auto_tick = true,
			})
			timelines:play('immediate_schedule')
			timelines:tick_gameplay(20)
			assert(timelines:get('immediate_schedule'):value() == 1)
			timelines:stop('immediate_schedule')
		end,
		cubic_value = function()

			local abs<const> = math.abs

			local assert_close<const> = function(actual, expected)
				assert(abs(actual - expected) < 0.000001)
			end

			local owner<const> = setmetatable({ id = 'timeline_cubic_value_test' }, world_object)
			world_object.initialize(owner)

			local timelines<const> = timeline_component.new({ parent = owner })
			timelines:on_attach()
			local target<const> = { value = -1, method = -1 }
			timelines:define('time_cubic', {
				continuous = true,
				duration_ms = 100,
				tracks = {
					{
						kind = 'value',
						interpolation = 'cubic',
						apply = function(binding, value, _params, evaluation)
							binding.value = value
							binding.method = evaluation.method
						end,
						keys = {
							{ time_ms = 100, value = 10, arrive_tangent = 0 },
							{ time_ms = 0, value = 0, leave_tangent = 0.2 },
						},
					},
				},
			})
			timelines:play('time_cubic', { target = target })
			assert_close(target.value, 0)
			timelines:tick_gameplay(25)
			assert_close(target.value, 4.375)
			timelines:tick_gameplay(25)
			assert_close(target.value, 7.5)
			timelines:seek_time('time_cubic', 75)
			assert_close(target.value, 9.375)
			assert(target.method == timeline_module.update_method.jump)
			timelines:scrub_time('time_cubic', 100)
			assert_close(target.value, 10)
			assert(target.method == timeline_module.update_method.scrub)
			timelines:stop('time_cubic')

			local frame_target<const> = { nested = { value = -1 } }
			timelines:define('frame_cubic', {
				frames = timeline_module.range(5),
				frame_duration = 20,
				tracks = {
					{
						kind = 'value',
						interpolation = 'cubic',
						path = { 'nested', 'value' },
						keys = {
							{ frame = 0, value = 0, leave_tangent = 0 },
							{ frame = 2, value = 20, arrive_tangent = 0, leave_tangent = 0 },
							{ frame = 4, value = 40, arrive_tangent = 0 },
						},
					},
				},
			})
			timelines:play('frame_cubic', { target = frame_target })
			assert_close(frame_target.nested.value, 0)
			timelines:tick_gameplay(20)
			assert_close(frame_target.nested.value, 10)
			timelines:seek('frame_cubic', 3)
			assert_close(frame_target.nested.value, 30)
			timelines:seek('frame_cubic', 1)
			assert_close(frame_target.nested.value, 10)
			timelines:stop('frame_cubic')

			local pingpong_target<const> = { value = -1 }
			timelines:define('pingpong_cubic', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'pingpong',
				tracks = {
					{
						kind = 'value',
						interpolation = 'cubic',
						path = { 'value' },
						keys = {
							{ time_ms = 0, value = 0, leave_tangent = 0 },
							{ time_ms = 100, value = 100, arrive_tangent = 0 },
						},
					},
				},
			})
			timelines:play('pingpong_cubic', { target = pingpong_target })
			timelines:tick_gameplay(125)
			assert_close(pingpong_target.value, 84.375)
			timelines:tick_gameplay(50)
			assert_close(pingpong_target.value, 15.625)
			timelines:stop('pingpong_cubic')

			local child<const> = {
				continuous = true,
				duration_ms = 100,
				bindings = { 'camera' },
				tracks = {
					{
						kind = 'value',
						interpolation = 'cubic',
						binding = 'camera',
						path = { 'value' },
						keys = {
							{ time_ms = 0, value = 0, leave_tangent = 0 },
							{ time_ms = 100, value = 100, arrive_tangent = 0 },
						},
					},
				},
			}
			local camera<const> = { value = -1 }
			timelines:define('nested_cubic', {
				continuous = true,
				duration_ms = 250,
				bindings = { 'camera' },
				subsequences = {
					{
						id = 'child',
						start_time_ms = 0,
						duration_ms = 250,
						playback_mode = 'loop',
						sequence = child,
					},
				},
			})
			timelines:play('nested_cubic', { bindings = { camera = camera } })
			timelines:tick_gameplay(225)
			assert_close(camera.value, 15.625)
			timelines:seek_time('nested_cubic', 175)
			assert_close(camera.value, 84.375)
			timelines:stop('nested_cubic')
		end,
		subsequence = function()

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
			timelines:tick_gameplay(50)
			assert(camera.value == 10 and event_count == 1 and owner.tags.child_active == nil)
			timelines:tick_gameplay(25)
			assert(camera.value == 10 and owner.tags.child_active == true and owner.nested_value == 7)
			timelines:tick_gameplay(30)
			assert(camera.value == 20 and owner.tags.child_active == true)
			timelines:tick_gameplay(45)
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
			timelines:tick_gameplay(200)
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
			timelines:tick_gameplay(200)
			timelines:tick_gameplay(51)
			assert(backward_count == 0 and owner.tags.child_active == nil)
			timelines:tick_gameplay(20)
			assert(backward_count == 1 and owner.tags.child_active == true and camera.value == 20)
			timelines:tick_gameplay(60)
			assert(owner.tags.child_active == nil and camera.value == 10)
			timelines:tick_gameplay(20)
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
			timelines:tick_gameplay(25)
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
		end,
		time_warp = function()

			local owner<const> = setmetatable({ id = 'timeline_time_warp_test' }, world_object)
			world_object.initialize(owner)
			owner:add_tag('tag_ownership_probe')
			owner:_retain_tag('tag_ownership_probe')
			owner:remove_tag('tag_ownership_probe')
			assert(owner:has_tag('tag_ownership_probe'))
			owner:_release_tag('tag_ownership_probe')
			assert(not owner:has_tag('tag_ownership_probe'))
			owner:_retain_tag('tag_ownership_probe')
			owner:_retain_tag('tag_ownership_probe')
			owner:_release_tag('tag_ownership_probe')
			assert(owner:has_tag('tag_ownership_probe'))
			owner:_release_tag('tag_ownership_probe')
			assert(not owner:has_tag('tag_ownership_probe'))

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

			local root_loop_count = 0
			timelines:define('root_loop', {
				frames = timeline_module.range(1),
				continuous = true,
				duration_ms = 100,
				playback_mode = 'loop',
				apply = function(_target, _value, _params, evaluation)
					if evaluation.wrapped then
						assert(evaluation.boundary == timeline_module.playback_boundary.loop)
						assert(not evaluation.initial)
						root_loop_count = root_loop_count + 1
					end
				end,
			})
			timelines:play('root_loop')
			timelines:tick_gameplay(125)
			assert(root_loop_count == 1)
			timelines:stop('root_loop')

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
			timelines:tick_gameplay(225)
			assert(zero_count == 3 and nested_forward_count == 2)
			assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
			assert(loop_count == 2 and loop_finished_count == 0)
			timelines:tick_gameplay(25)
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
			timelines:tick_gameplay(50)
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
			timelines:tick_gameplay(225)
			assert(backward_count == backward_before_reverse + 2)
			assert(nested_backward_count == nested_backward_before_reverse + 3)
			assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
			timelines:tick_gameplay(25)
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
			timelines:tick_gameplay(225)
			assert(zero_count == zero_before_pingpong + 1)
			assert(backward_count == backward_before_pingpong + 1)
			assert(nested_forward_count == nested_forward_before_pingpong + 1)
			assert(nested_backward_count == nested_backward_before_pingpong + 1)
			assert(camera.value == 10 and owner.nested_value == 1 and owner.tags.child_active == true)
			assert(pingpong_turn_count == 2 and pingpong_finished_count == 0)
			timelines:tick_gameplay(25)
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
			timelines:tick_gameplay(225)
			assert(frame_last_count == 2 and frame_backward_count == 2)
			assert(frame_tag_start_count == 2 and frame_tag_end_count == 2)
			assert(owner.tags.frame_active == true)
			timelines:tick_gameplay(25)
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
			timelines:tick_gameplay(250)
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
			timelines:tick_gameplay(150)
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

			local play_policy_count = 0
			local seek_policy_count = 0
			local scrub_policy_count = 0
			owner.events:on({
				event = 'policy.play',
				handler = function()
					play_policy_count = play_policy_count + 1
				end,
			})
			owner.events:on({
				event = 'policy.seek',
				handler = function()
					seek_policy_count = seek_policy_count + 1
				end,
			})
			owner.events:on({
				event = 'policy.scrub',
				handler = function()
					scrub_policy_count = scrub_policy_count + 1
				end,
			})
			timelines:define('event_update_policy', {
				continuous = true,
				duration_ms = 100,
				tracks = {
					{
						kind = 'event',
						keys = {
							{ time_ms = 20, event = 'policy.play', direction = 'both' },
						},
					},
					{
						kind = 'event',
						fire_on_seek = true,
						keys = {
							{ time_ms = 40, event = 'policy.seek', direction = 'both' },
						},
					},
					{
						kind = 'event',
						fire_on_scrub = true,
						keys = {
							{ time_ms = 60, event = 'policy.scrub', direction = 'both' },
						},
					},
				},
			})
			timelines:play('event_update_policy')
			timelines:seek_time('event_update_policy', 50)
			assert(play_policy_count == 0 and seek_policy_count == 1 and scrub_policy_count == 0)
			timelines:scrub_time('event_update_policy', 80)
			assert(play_policy_count == 0 and seek_policy_count == 1 and scrub_policy_count == 1)
			timelines:seek_time('event_update_policy', 0)
			assert(play_policy_count == 0 and seek_policy_count == 2 and scrub_policy_count == 1)
			timelines:advance_time_to('event_update_policy', 80)
			assert(play_policy_count == 1 and seek_policy_count == 3 and scrub_policy_count == 2)
			timelines:scrub_time('event_update_policy', 0)
			assert(play_policy_count == 1 and seek_policy_count == 3 and scrub_policy_count == 3)
			timelines:stop('event_update_policy')

			local chain_owner<const> = setmetatable({ id = 'timeline_completion_chain_test' }, world_object)
			world_object.initialize(chain_owner)
			local chain_timelines<const> = timeline_component.new({ parent = chain_owner })
			chain_timelines:on_attach()
			chain_timelines:define('successor', {
				continuous = true,
				duration_ms = 40,
				playback_mode = 'once',
			})
			chain_timelines:define('predecessor', {
				continuous = true,
				duration_ms = 20,
				playback_mode = 'once',
			})
			chain_timelines:play('predecessor', nil, function(target)
				target.timelines:play('successor')
			end)
			chain_timelines:tick_gameplay(20)
			assert(chain_timelines:get('successor').position_ms == 0,
			'completion successor consumed its predecessor delta')
			chain_timelines:tick_gameplay(20)
			assert(chain_timelines:get('successor').position_ms == 20)

			local mutation_owner<const> = setmetatable({ id = 'timeline_lane_mutation_test' }, world_object)
			world_object.initialize(mutation_owner)
			local mutation_timelines<const> = timeline_component.new({ parent = mutation_owner })
			mutation_timelines:on_attach()
			mutation_owner.events:on({
				event = 'timeline.replace_peer',
				handler = function()
					mutation_timelines:stop('peer')
					mutation_timelines:play('replacement')
				end,
			})
			mutation_timelines:define('source', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'once',
				tracks = {
					{
						kind = 'event',
						keys = {
							{ time_ms = 20, event = 'timeline.replace_peer', direction = 'forward' },
						},
					},
				},
			})
			mutation_timelines:define('peer', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'once',
			})
			mutation_timelines:define('replacement', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'once',
			})
			mutation_timelines:play('source')
			mutation_timelines:play('peer')
			mutation_timelines:tick_gameplay(20)
			assert(not mutation_timelines:get('peer').playing)
			assert(mutation_timelines:get('replacement').position_ms == 0)
			mutation_timelines:tick_gameplay(20)
			assert(mutation_timelines:get('source').position_ms == 40)
			assert(mutation_timelines:get('replacement').position_ms == 20)

			local rate_owner<const> = setmetatable({ id = 'timeline_play_rate_test' }, world_object)
			world_object.initialize(rate_owner)
			local rate_timelines<const> = timeline_component.new({ parent = rate_owner })
			rate_timelines:on_attach()
			rate_timelines:define('scaled', {
				continuous = true,
				duration_ms = 100,
				playback_mode = 'once',
			})
			rate_timelines:play('scaled', {
				play_rate = 0.5,
				snap_to_start = false,
			})
			rate_timelines:tick_gameplay(40)
			assert(rate_timelines:get('scaled').position_ms == 20,
			'non-identity play rate did not scale the scheduled transport delta')
			rate_timelines:set_play_rate('scaled', 2)
			rate_timelines:tick_gameplay(10)
			assert(rate_timelines:get('scaled').position_ms == 40,
			'dynamic play-rate change did not retain the current source position')
			rate_timelines:seek_time('scaled', 60)
			rate_timelines:tick_gameplay(10)
			assert(rate_timelines:get('scaled').position_ms == 80,
			'play rate rewrote or discarded an explicit source-time position')
			rate_timelines:stop('scaled')
			rate_timelines:play('scaled')
			rate_timelines:tick_gameplay(10)
			assert(rate_timelines:get('scaled').position_ms == 10,
			'a later default play inherited the previous playback rate')
		end,
	},
}
