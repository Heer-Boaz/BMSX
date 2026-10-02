import type { YAMLMap } from 'yaml';
import { AEM_PLAY_ACTION_KEYS, AEM_CHOICE_ACTION_KEYS, AEM_RANDOM_ACTION_KEYS, AEM_SEQUENCE_ACTION_KEYS, AEM_MUSIC_TRANSITION_ACTION_KEYS, AEM_STOP_ACTION_KEYS, AEM_PAUSE_MUSIC_ACTION_KEYS, AEM_RESUME_MUSIC_ACTION_KEYS, AEM_ACTION_KEYS, AEM_EVENT_KEYS, AEM_RULE_KEYS, AEM_MODULATION_KEYS, AEM_FILTER_KEYS, AEM_MUSIC_TRANSITION_KEYS, AEM_STOP_KEYS, AEM_MATCHER_KEYS } from '../../../../toolchain/ts/rompack/aem_contract';

type Template = { readonly name: string; readonly value: string };
const VALUES: Readonly<Record<string, string>> = {
	channel: '"sfx"', policy: '"replace"', rules: '[]', on_finished: '"game.audio.finished"', when: '{}', go: '{}', audio_id: '""',
	priority: '0', cooldown_ms: '0', modulation_preset: '""', modulation_params: '{}', stop: '{}', pause_music: '{}', resume_music: '{}',
	sequence: '[]', music_transition: '{}', one_of: '[]', weight: '1', pick: '"uniform"', avoid_repeat: 'true',
	sync: '"immediate"', fade_ms: '0', crossfade_ms: '0', start_at_loop_start: 'false', start_fresh: 'true',
	pitchDelta: '0', volumeDelta: '0', offset: '0', playbackRate: '1', pitchRange: '[0, 0]', volumeRange: '[0, 0]', offsetRange: '[0, 0]', playbackRateRange: '[1, 1]',
	filter: '{}', type: '"lowpass"', frequency: '1000', q: '1', gain: '0', equals: '{}', any_of: '{}', in: '{}', has_tag: '"tag"', and: '[]', or: '[]', not: '{}',
};

export function aemFieldTemplates(path: readonly (string | number)[], collection: YAMLMap): readonly Template[] {
	let keys: ReadonlySet<string>;
	if (path.length === 0) return [{ name: 'events', value: '{}' }];
	if (path.length === 2 && path[0] === 'events') keys = AEM_EVENT_KEYS;
	else if (path[path.length - 2] === 'rules') keys = AEM_RULE_KEYS;
	else if (path[path.length - 2] === 'one_of') keys = AEM_CHOICE_ACTION_KEYS;
	else if (path[path.length - 2] === 'sequence' || path[path.length - 1] === 'go') {
		if (collection.has('audio_id')) keys = AEM_PLAY_ACTION_KEYS;
		else if (collection.has('one_of')) keys = AEM_RANDOM_ACTION_KEYS;
		else if (collection.has('sequence')) keys = AEM_SEQUENCE_ACTION_KEYS;
		else if (collection.has('music_transition')) keys = AEM_MUSIC_TRANSITION_ACTION_KEYS;
		else if (collection.has('stop')) keys = AEM_STOP_ACTION_KEYS;
		else if (collection.has('pause_music')) keys = AEM_PAUSE_MUSIC_ACTION_KEYS;
		else if (collection.has('resume_music')) keys = AEM_RESUME_MUSIC_ACTION_KEYS;
		else keys = AEM_ACTION_KEYS;
	}
	else switch (path[path.length - 1]) {
		case 'modulation_params': keys = AEM_MODULATION_KEYS; break;
		case 'filter': keys = AEM_FILTER_KEYS; break;
		case 'music_transition': keys = AEM_MUSIC_TRANSITION_KEYS; break;
		case 'stop': keys = AEM_STOP_KEYS; break;
		case 'when': case 'not': keys = AEM_MATCHER_KEYS; break;
		default: return [];
	}
	return [...keys].map(name => ({ name, value: VALUES[name] }));
}
export function aemSequenceTemplate(path: readonly (string | number)[], audioId: string): string {
	return path[path.length - 1] === 'rules' ? JSON.stringify({ go: { audio_id: audioId } }) : JSON.stringify({ audio_id: audioId });
}

export function aemSequenceValueTemplate(path: readonly (string | number)[]): string | undefined {
	const field = path[path.length - 1];
	if (field === 'rules' || field === 'one_of' || field === 'sequence') return;
	if (field === 'playbackRateRange') return '1';
	if (field === 'pitchRange' || field === 'volumeRange' || field === 'offsetRange') return '0';
	return '{}';
}
