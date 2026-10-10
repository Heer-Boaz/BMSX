/** Native cartlib source templates, not a second asset schema. */
export const ANIMATION_TRACK_TEMPLATES = [
	{ label: 'Linear', description: 'Scalar', detail: '', path: true,
		create: (path: string) => `{kind = 'value', interpolation = 'linear', path = ${path}, keys = {{time_ms = 0, value = 0}, {time_ms = 100, value = 0}}}` },
	{ label: 'Cubic', description: 'Scalar / Hermite', detail: '', path: true,
		create: (path: string) => `{kind = 'value', interpolation = 'cubic', path = ${path}, keys = {{time_ms = 0, value = 0, arrive_tangent = 0, leave_tangent = 0}, {time_ms = 100, value = 0, arrive_tangent = 0, leave_tangent = 0}}}` },
	{ label: 'Step', description: 'Discrete values', detail: '', path: true,
		create: (path: string) => `{kind = 'value', interpolation = 'step', path = ${path}, keys = {{time_ms = 0, value = 0}, {time_ms = 100, value = 0}}}` },
	{ label: 'Event', description: 'Effects / audio / callbacks', detail: '', path: false,
		create: () => "{kind = 'event', fire_on_seek = false, fire_on_scrub = false, keys = {{time_ms = 0, direction = 'forward', event = 'animation.event', payload = {}}}}" },
	{ label: 'Tag', description: 'Activity interval', detail: '', path: false,
		create: () => "{kind = 'tag', name = 'activity', tag = 'activity', start = {time_ms = 0}, ['end'] = {time_ms = 100}, start_payload = {}, end_payload = {}}" },
	{ label: 'Wave', description: 'Native periodic scalar', detail: '', path: true,
		create: (path: string) => `{kind = 'wave', path = ${path}, base = 0, amp = 1, phase = 0, period = 1, wave = 'pingpong'}` },
	{ label: 'Sample', description: 'Source callback', detail: '', path: false,
		create: () => '{kind = \'sample\', apply = function(owner, params, evaluation, time_seconds) end}' },
] as const;
