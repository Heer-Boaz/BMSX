// AEM authoring vocabulary shared by ROM validation and editor tooling. The
// cartridge receives a cooked event map; these names never enter its dispatch
// path as a second runtime contract.

export const AEM_CHANNELS = ['sfx', 'music', 'ui'] as const;
export const AEM_POLICIES = ['replace', 'queue'] as const;
export const AEM_SYNC_MODES = ['immediate', 'loop'] as const;
export const AEM_FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking', 'lowshelf', 'highshelf'] as const;
export const AEM_SELECTION_MODES = ['uniform', 'weighted'] as const;

export const AEM_CHANNEL_SET: ReadonlySet<string> = new Set(AEM_CHANNELS);
export const AEM_POLICY_SET: ReadonlySet<string> = new Set(AEM_POLICIES);
export const AEM_SYNC_MODE_SET: ReadonlySet<string> = new Set(AEM_SYNC_MODES);
export const AEM_FILTER_TYPE_SET: ReadonlySet<string> = new Set(AEM_FILTER_TYPES);
export const AEM_SELECTION_MODE_SET: ReadonlySet<string> = new Set(AEM_SELECTION_MODES);

export const AEM_DOCUMENT_KEYS: ReadonlySet<string> = new Set(['events']);
export const AEM_EVENT_KEYS: ReadonlySet<string> = new Set(['channel', 'policy', 'rules']);
export const AEM_RULE_KEYS: ReadonlySet<string> = new Set(['when', 'go']);
export const AEM_MATCHER_KEYS: ReadonlySet<string> = new Set(['equals', 'any_of', 'in', 'has_tag', 'and', 'or', 'not']);
export const AEM_ACTION_KEYS: ReadonlySet<string> = new Set([
	'audio_id',
	'modulation_preset',
	'modulation_params',
	'priority',
	'cooldown_ms',
	'stop_music',
	'pause_music',
	'resume_music',
	'sequence',
	'music_transition',
	'one_of',
	'pick',
	'avoid_repeat',
]);
export const AEM_PLAY_ACTION_KEYS: ReadonlySet<string> = new Set([
	'audio_id',
	'modulation_preset',
	'modulation_params',
	'priority',
	'cooldown_ms',
]);
export const AEM_CHOICE_ACTION_KEYS: ReadonlySet<string> = new Set([
	...AEM_PLAY_ACTION_KEYS,
	'weight',
]);
export const AEM_STOP_MUSIC_ACTION_KEYS: ReadonlySet<string> = new Set(['stop_music']);
export const AEM_PAUSE_MUSIC_ACTION_KEYS: ReadonlySet<string> = new Set(['pause_music']);
export const AEM_RESUME_MUSIC_ACTION_KEYS: ReadonlySet<string> = new Set(['resume_music']);
export const AEM_SEQUENCE_ACTION_KEYS: ReadonlySet<string> = new Set(['sequence']);
export const AEM_RANDOM_ACTION_KEYS: ReadonlySet<string> = new Set(['one_of', 'pick', 'avoid_repeat']);
export const AEM_MUSIC_TRANSITION_ACTION_KEYS: ReadonlySet<string> = new Set(['music_transition']);
export const AEM_STOP_MUSIC_KEYS: ReadonlySet<string> = new Set(['fade_ms']);
export const AEM_EMPTY_ACTION_KEYS: ReadonlySet<string> = new Set();
export const AEM_MUSIC_TRANSITION_KEYS: ReadonlySet<string> = new Set([
	'audio_id',
	'sync',
	'fade_ms',
	'crossfade_ms',
	'start_at_loop_start',
	'start_fresh',
]);
export const AEM_STINGER_SYNC_KEYS: ReadonlySet<string> = new Set(['stinger', 'return_to']);
export const AEM_MODULATION_KEYS: ReadonlySet<string> = new Set([
	'pitchDelta',
	'volumeDelta',
	'offset',
	'playbackRate',
	'pitchRange',
	'volumeRange',
	'offsetRange',
	'playbackRateRange',
	'filter',
]);
export const AEM_FILTER_KEYS: ReadonlySet<string> = new Set(['type', 'frequency', 'q', 'gain']);
