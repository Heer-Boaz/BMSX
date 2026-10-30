local timeline_clock<const> = require('cartlib/timeline/clock_source')

return {
	ship_idle = {
		phase = 'presentation',
		duration_ms = 1200, clock_source = timeline_clock.frame, playback_mode = 'loop',
		tracks = {{ kind = 'value', path = { 'bob' }, interpolation = 'linear',
			keys = {{ time_ms = 0, value = 0 }, { time_ms = 600, value = 1.5 }, { time_ms = 1200, value = 0 }} }},
	},
	arrival = {
		phase = 'physical', bindings = { 'pose' },
		duration_ms = 1500, clock_source = timeline_clock.frame,
		tracks = {
			{ kind = 'spatial', binding = 'pose', operation = 'local_origin3', channels = {
				ox = { interpolation = 'linear', keys = {{ time_ms = 0, value = 160 }, { time_ms = 950, value = 150 }, { time_ms = 1500, value = 160 }} },
				oy = { interpolation = 'linear', keys = {{ time_ms = 0, value = 420 }, { time_ms = 950, value = 235 }, { time_ms = 1500, value = 198 }} },
				oz = { interpolation = 'linear', keys = {{ time_ms = 0, value = 896 }, { time_ms = 950, value = 640 }, { time_ms = 1500, value = 512 }} },
			} },
			{ kind = 'value', path = { 'bank' }, interpolation = 'linear',
				keys = {{ time_ms = 0, value = -0.35 }, { time_ms = 950, value = 0.15 }, { time_ms = 1500, value = 0 }} },
		},
	},
	fire = {
		phase = 'presentation',
		duration_ms = 110,
		tracks = {{ kind = 'value', path = { 'recoil' }, interpolation = 'linear',
			keys = {{ time_ms = 0, value = 0 }, { time_ms = 35, value = 3 }, { time_ms = 110, value = 0 }} }},
	},
	hurt = {
		phase = 'presentation',
		duration_ms = 300, clock_source = timeline_clock.frame,
		tracks = {{ kind = 'value', path = { 'hit_flash' }, interpolation = 'linear',
			keys = {{ time_ms = 0, value = 1 }, { time_ms = 300, value = 0 }} }},
	},
	dash = {
		phase = 'physical',
		duration_ms = 180,
		tracks = {
			{ kind = 'value', path = { 'dash_speed' }, interpolation = 'linear',
				keys = {{ time_ms = 0, value = 2.5 }, { time_ms = 140, value = 2.5 }, { time_ms = 180, value = 1 }} },
			{ kind = 'value', path = { 'dash_shield' }, interpolation = 'linear',
				keys = {{ time_ms = 0, value = 1 }, { time_ms = 140, value = 1 }, { time_ms = 180, value = 0 }} },
		},
	},
	enemy_charge = {
		phase = 'presentation',
		duration_ms = 900,
		tracks = {{ kind = 'value', path = { 'charge' }, interpolation = 'linear',
			keys = {{ time_ms = 0, value = 0 }, { time_ms = 700, value = 1 }, { time_ms = 900, value = 0 }} }},
	},
	burst = {
		phase = 'presentation',
		duration_ms = 260,
		tracks = {{ kind = 'value', path = { 'pulse' }, interpolation = 'linear',
			keys = {{ time_ms = 0, value = 2 }, { time_ms = 100, value = 18 }, { time_ms = 260, value = 0 }} }},
	},
}
