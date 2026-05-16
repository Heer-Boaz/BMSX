__bmsx_host_test = __bmsx_host_test or {
	snapshots = {},
}

local host_timeline_id<const> = 'host.timeline.live_assert'

function __bmsx_host_test.ready()
	return oget('p3.director') ~= nil
end

function __bmsx_host_test.setup()
	local director<const> = oget('p3.director')
	local timeline<const> = require('timeline/index')
	director:define_timeline(timeline.new({
		id = host_timeline_id,
		frames = timeline.range(4),
		ticks_per_frame = 24,
		playback_mode = 'once',
	}))
	director:play_timeline(host_timeline_id, { rewind = true, snap_to_start = true })
	return host.log('live timeline test armed')
end

local capture_state<const> = function(frame)
	local director<const> = oget('p3.director')
	local tl<const> = director:get_timeline(host_timeline_id)
	local timeline_component<const> = director.timelines
	local snapshot<const> = {
		frame = frame,
		head = tl.head,
		value = tl:value(),
		ticks = tl.ticks,
		time_ms = tl.time_ms,
		ended = tl.ended,
		active_count = timeline_component.active_count,
		component_space = timeline_component._active_component_space_id,
	}
	__bmsx_host_test.snapshots[#__bmsx_host_test.snapshots + 1] = snapshot
	return snapshot
end

function __bmsx_host_test.update(frame)
	local snapshot<const> = capture_state(frame)
	if frame < 5 then
		return false
	end
	local s1<const> = __bmsx_host_test.snapshots[1]
	local s2<const> = __bmsx_host_test.snapshots[2]
	local s3<const> = __bmsx_host_test.snapshots[3]
	local s4<const> = __bmsx_host_test.snapshots[4]
	local s5<const> = __bmsx_host_test.snapshots[5]
	if s1.head ~= 0 then
		error('expected frame 1 head=0 after snap_to_start, got ' .. tostring(s1.head))
	end
	if s2.head ~= 1 then
		error('expected frame 2 head=1, got ' .. tostring(s2.head))
	end
	if s3.head ~= 2 then
		error('expected frame 3 head=2, got ' .. tostring(s3.head))
	end
	if s4.head ~= 3 then
		error('expected frame 4 head=3, got ' .. tostring(s4.head))
	end
	if s5.head ~= 3 or s5.ended ~= true then
		error('expected frame 5 to finish once-timeline at head=3 ended=true, got head=' .. tostring(s5.head) .. ' ended=' .. tostring(s5.ended))
	end
	if s1.active_count ~= 1 then
		error('expected active_count=1 on frame 1, got ' .. tostring(s1.active_count))
	end
	if s5.active_count ~= 0 then
		error('expected active_count=0 after once-timeline end, got ' .. tostring(s5.active_count))
	end
	return true
end
