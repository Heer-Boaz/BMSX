import { load as loadYaml } from 'js-yaml';

// Authoring-time AEM schema and validation. AEM may describe audio behavior,
// but it is not the machine audio device or a host-side shortcut around MMIO.
export type StructuredTextDocumentFormat = 'yaml' | 'json';

type AudioAction = {
	audio_id?: string;
	modulation_preset?: string;
	modulation_params?: ModulationParams;
	priority?: number;
	cooldown_ms?: number;
};

type AudioActionOneOfSpec = {
	one_of?: Array<string | (AudioAction & { weight?: number })>;
};

type AudioStingerSpec = {
	stinger?: string;
	return_to?: string;
	return_to_previous?: boolean;
};

type MusicTransitionSpec = {
	music_transition?: {
		audio_id?: string;
		sync?: string | AudioStingerSpec;
		fade_ms?: number;
		crossfade_ms?: number;
		start_at_loop_start?: boolean;
		start_fresh?: boolean;
	};
};

type AudioEventRule = {
	go?: unknown;
};

type AudioFilterParams = {
	type?: string;
	frequency?: number;
	q?: number;
	gain?: number;
};

type ModulationParams = {
	pitchDelta?: number;
	volumeDelta?: number;
	offset?: number;
	playbackRate?: number;
	pitchRange?: unknown;
	volumeRange?: unknown;
	offsetRange?: unknown;
	playbackRateRange?: unknown;
	filter?: AudioFilterParams;
};

export type AemValidationDataAsset = {
	name: string;
	value: unknown;
};

export type AemValidationLookup = {
	audioIds: ReadonlySet<string>;
	dataAssetNames: ReadonlySet<string>;
	dataQualifiedKeys: ReadonlySet<string>;
	dataAssetValues: Readonly<Record<string, unknown>>;
};

export type AemValidationResult = {
	errors: string[];
	warnings: string[];
};

const VALID_CHANNELS = new Set(['sfx', 'music', 'ui']);
const VALID_POLICIES = new Set(['replace', 'queue']);
const VALID_SYNC_STRINGS = new Set(['immediate', 'loop']);
const VALID_FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass', 'notch', 'allpass', 'peaking', 'lowshelf', 'highshelf']);
const VALID_ONE_OF_PICK = new Set(['uniform', 'weighted']);
const EVENT_KEYS = new Set(['$type', 'name', 'kind', 'channel', 'policy', 'rules']);
const RULE_KEYS = new Set(['when', 'go']);
const MATCHER_KEYS = new Set(['equals', 'any_of', 'in', 'has_tag', 'and', 'or', 'not']);
const ACTION_KEYS = new Set(['audio_id', 'modulation_preset', 'modulation_params', 'priority', 'cooldown_ms', 'stop_music', 'sequence', 'music_transition', 'one_of', 'pick', 'avoid_repeat', 'weight']);
const AUDIO_ACTION_KEYS = new Set(['audio_id', 'modulation_preset', 'modulation_params', 'priority', 'cooldown_ms', 'weight']);
const STOP_MUSIC_KEYS = new Set(['fade_ms']);
const MUSIC_TRANSITION_KEYS = new Set(['audio_id', 'sync', 'fade_ms', 'crossfade_ms', 'start_at_loop_start', 'start_fresh']);
const STINGER_SYNC_KEYS = new Set(['stinger', 'return_to', 'return_to_previous']);
const MODULATION_KEYS = new Set(['pitchDelta', 'volumeDelta', 'offset', 'playbackRate', 'pitchRange', 'volumeRange', 'offsetRange', 'playbackRateRange', 'filter']);
const FILTER_KEYS = new Set(['type', 'frequency', 'q', 'gain']);

export function parseStructuredTextDocument(source: string, format: StructuredTextDocumentFormat, label: string): unknown {
	try {
		if (format === 'json') {
			return JSON.parse(source);
		}
		return loadYaml(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse ${label}: ${message}`);
	}
}

function collectQualifiedKeys(obj: Record<string, unknown>, prefix: string, depth: number, out: Set<string>): void {
	if (depth < 0) {
		return;
	}
	const keys = Object.keys(obj);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index]!;
		const qualified = prefix.length > 0 ? `${prefix}.${key}` : key;
		out.add(qualified);
		const value = obj[key];
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			collectQualifiedKeys(value as Record<string, unknown>, qualified, depth - 1, out);
		}
	}
}

function checkUnknownKeys(
	obj: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	where: string,
	errors: string[],
): void {
	const keys = Object.keys(obj);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index]!;
		if (!allowed.has(key)) {
			errors.push(`Unknown key '${key}' at ${where}`);
		}
	}
}

export function buildAemValidationLookup(params: {
	audioIds: Iterable<string>;
	dataAssets: Iterable<AemValidationDataAsset>;
	keyDepth?: number;
}): AemValidationLookup {
	const audioIds = new Set<string>();
	for (const audioId of params.audioIds) {
		if (typeof audioId === 'string' && audioId.length > 0) {
			audioIds.add(audioId);
		}
	}
	const dataAssetNames = new Set<string>();
	const dataQualifiedKeys = new Set<string>();
	const dataAssetValues: Record<string, unknown> = {};
	const keyDepth = params.keyDepth ?? 3;
	for (const asset of params.dataAssets) {
		if (typeof asset.name !== 'string' || asset.name.length === 0) {
			continue;
		}
		dataAssetNames.add(asset.name);
		dataAssetValues[asset.name] = asset.value;
		if (!asset.value || typeof asset.value !== 'object' || Array.isArray(asset.value)) {
			continue;
		}
		collectQualifiedKeys(asset.value as Record<string, unknown>, asset.name, keyDepth, dataQualifiedKeys);
	}
	return {
		audioIds,
		dataAssetNames,
		dataQualifiedKeys,
		dataAssetValues,
	};
}

function buildRuleKey(file: string, eventName: string | undefined, ruleIndex: number): string {
	return `${file}:${eventName ?? '<root>'}#rule${ruleIndex}`;
}

function validateEventMeta(
	ev: Record<string, unknown>,
	file: string,
	eventName: string | undefined,
	errors: string[],
): void {
	const where = `${file}${eventName ? `:${eventName}` : ''}`;
	checkUnknownKeys(ev, EVENT_KEYS, where, errors);
	const channel = ev['channel'];
	if (channel === undefined) {
		errors.push(`Missing channel at ${where}: expected one of ${Array.from(VALID_CHANNELS).join(', ')}`);
	} else if (typeof channel !== 'string' || !VALID_CHANNELS.has(channel)) {
		errors.push(`Invalid channel '${channel}' at ${where}: expected one of ${Array.from(VALID_CHANNELS).join(', ')}`);
	}
	const policy = ev['policy'];
	if (policy !== undefined && (typeof policy !== 'string' || !VALID_POLICIES.has(policy))) {
		errors.push(`Invalid policy '${policy}' at ${where}: expected one of ${Array.from(VALID_POLICIES).join(', ')}`);
	}
}

function validateMatcher(matcher: unknown, where: string, errors: string[]): void {
	if (matcher === undefined) {
		return;
	}
	if (!matcher || typeof matcher !== 'object' || Array.isArray(matcher)) {
		errors.push(`Invalid matcher at ${where}: expected object`);
		return;
	}
	const obj = matcher as Record<string, unknown>;
	checkUnknownKeys(obj, MATCHER_KEYS, where, errors);
	const equals = obj.equals;
	if (equals !== undefined && (!equals || typeof equals !== 'object' || Array.isArray(equals))) {
		errors.push(`Invalid equals matcher at ${where}: expected object`);
	}
	for (const key of ['any_of', 'in']) {
		const group = obj[key];
		if (group === undefined) {
			continue;
		}
		if (!group || typeof group !== 'object' || Array.isArray(group)) {
			errors.push(`Invalid ${key} matcher at ${where}: expected object`);
			continue;
		}
		const entries = Object.entries(group as Record<string, unknown>);
		for (let index = 0; index < entries.length; index += 1) {
			const [field, list] = entries[index]!;
			if (!Array.isArray(list)) {
				errors.push(`Invalid ${key}.${field} matcher at ${where}: expected array`);
			}
		}
	}
	const hasTag = obj.has_tag;
	if (hasTag !== undefined && !Array.isArray(hasTag)) {
		errors.push(`Invalid has_tag matcher at ${where}: expected array`);
	}
	for (const key of ['and', 'or']) {
		const list = obj[key];
		if (list === undefined) {
			continue;
		}
		if (!Array.isArray(list)) {
			errors.push(`Invalid ${key} matcher at ${where}: expected array`);
			continue;
		}
		for (let index = 0; index < list.length; index += 1) {
			validateMatcher(list[index], `${where}.${key}[${index}]`, errors);
		}
	}
	validateMatcher(obj.not, `${where}.not`, errors);
}

function checkOptionalNumber(
	value: unknown,
	name: string,
	where: string,
	errors: string[],
): void {
	if (value !== undefined && typeof value !== 'number') {
		errors.push(`Invalid ${name} '${value}' at ${where}: expected number`);
	}
}

function checkRange(
	value: unknown,
	name: string,
	where: string,
	errors: string[],
): void {
	if (value === undefined) {
		return;
	}
	if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') {
		errors.push(`Invalid ${name} at ${where}: expected [min, max] numbers`);
		return;
	}
	if (value[0] > value[1]) {
		errors.push(`Invalid ${name} at ${where}: min must be <= max`);
	}
}

function checkModulationParams(
	value: unknown,
	where: string,
	errors: string[],
): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		errors.push(`Invalid modulation_params at ${where}: expected object`);
		return;
	}
	const params = value as ModulationParams;
	checkUnknownKeys(params as Record<string, unknown>, MODULATION_KEYS, where, errors);
	checkOptionalNumber(params.pitchDelta, 'pitchDelta', where, errors);
	checkOptionalNumber(params.volumeDelta, 'volumeDelta', where, errors);
	checkOptionalNumber(params.offset, 'offset', where, errors);
	checkOptionalNumber(params.playbackRate, 'playbackRate', where, errors);
	checkRange(params.pitchRange, 'pitchRange', where, errors);
	checkRange(params.volumeRange, 'volumeRange', where, errors);
	checkRange(params.offsetRange, 'offsetRange', where, errors);
	checkRange(params.playbackRateRange, 'playbackRateRange', where, errors);
	if (typeof params.offset === 'number' && params.offset < 0 && params.offsetRange === undefined) {
		errors.push(`Invalid offset '${params.offset}' at ${where}: effective APU start sample must be >= 0`);
	}
	if (Array.isArray(params.offsetRange) && typeof params.offsetRange[0] === 'number' && typeof params.offsetRange[1] === 'number') {
		const offsetBase = typeof params.offset === 'number' ? params.offset : 0;
		if (offsetBase + params.offsetRange[0] < 0) {
			errors.push(`Invalid offsetRange at ${where}: effective APU start sample must be >= 0`);
		}
	}
	if (typeof params.playbackRate === 'number' && params.playbackRate <= 0) {
		errors.push(`Invalid playbackRate '${params.playbackRate}' at ${where}: effective APU rate step must be > 0`);
	}
	if (Array.isArray(params.playbackRateRange) && typeof params.playbackRateRange[0] === 'number' && typeof params.playbackRateRange[1] === 'number') {
		const rateBase = typeof params.playbackRate === 'number' ? params.playbackRate : 1;
		if (rateBase + params.playbackRateRange[0] <= 0) {
			errors.push(`Invalid playbackRateRange at ${where}: effective APU rate step must be > 0`);
		}
	}
	if (params.filter === undefined) {
		return;
	}
	const filter = params.filter;
	if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
		errors.push(`Invalid filter at ${where}: expected object`);
		return;
	}
	checkUnknownKeys(filter as Record<string, unknown>, FILTER_KEYS, where, errors);
	if (typeof filter.type !== 'string' || !VALID_FILTER_TYPES.has(filter.type)) {
		errors.push(`Invalid filter.type '${filter.type}' at ${where}: expected one of ${Array.from(VALID_FILTER_TYPES).join(', ')}`);
	}
	if (typeof filter.frequency !== 'number') {
		errors.push(`Invalid filter.frequency '${filter.frequency}' at ${where}: expected number`);
	}
	if (typeof filter.q !== 'number') {
		errors.push(`Invalid filter.q '${filter.q}' at ${where}: expected number`);
	}
	if (typeof filter.gain !== 'number') {
		errors.push(`Invalid filter.gain '${filter.gain}' at ${where}: expected number`);
	}
}

function resolveDataPath(lookup: AemValidationLookup, path: string): unknown {
	const segments = path.split('.');
	for (let index = 0; index < segments.length; index += 1) {
		if (segments[index]!.length === 0) {
			return undefined;
		}
	}
	let cursor = lookup.dataAssetValues[segments[0]!];
	for (let index = 1; index < segments.length; index += 1) {
		if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
			return undefined;
		}
		cursor = (cursor as Record<string, unknown>)[segments[index]!];
	}
	return cursor;
}

function checkAction(
	action: AudioAction,
	ctx: { file: string; eventName?: string; ruleIndex?: number; choiceIndex?: number; sequenceIndex?: number },
	lookup: AemValidationLookup,
	errors: string[],
	musicTransitionsWithFallback: Set<string>,
): void {
	const where = `${ctx.file}${ctx.eventName ? `:${ctx.eventName}` : ''}${ctx.ruleIndex != null ? `#rule${ctx.ruleIndex}` : ''}${ctx.sequenceIndex != null ? `.sequence[${ctx.sequenceIndex}]` : ''}${ctx.choiceIndex != null ? `[${ctx.choiceIndex}]` : ''}`;
	checkUnknownKeys(action as Record<string, unknown>, AUDIO_ACTION_KEYS, where, errors);
	if (ctx.choiceIndex == null && (action as AudioAction & { weight?: unknown }).weight !== undefined) {
		errors.push(`Invalid weight at ${where}: weight is only valid inside one_of`);
	}
	const ruleKey = ctx.ruleIndex != null ? buildRuleKey(ctx.file, ctx.eventName, ctx.ruleIndex) : null;
	if (action.audio_id === undefined || action.audio_id === null) {
		const hasFallback = ruleKey !== null && musicTransitionsWithFallback.has(ruleKey);
		if (!hasFallback) {
			errors.push(`Missing audio_id at ${where}`);
		}
	} else if (typeof action.audio_id === 'string') {
		if (!lookup.audioIds.has(action.audio_id)) {
			errors.push(`Unknown audio_id '${action.audio_id}' at ${where}`);
		}
	} else {
		errors.push(`Invalid audio_id type (${typeof action.audio_id}) at ${where}`);
	}

	if (action.modulation_preset !== undefined) {
		const value = action.modulation_preset;
		if (typeof value === 'string') {
			const preset = resolveDataPath(lookup, value);
			if (preset === undefined) {
				let hint = '';
				if (value.indexOf('.') === -1) {
					const matches: string[] = [];
					for (const key of lookup.dataQualifiedKeys) {
						if (key.endsWith(`.${value}`)) {
							matches.push(key);
						}
					}
					if (matches.length > 0) {
						hint = ` (did you mean ${matches.join(', ')}?)`;
					}
				}
				errors.push(`Unknown data asset or key for modulation_preset '${value}' at ${where}${hint}`);
			} else {
				checkModulationParams(preset, `${where}.modulation_preset(${value})`, errors);
			}
		} else {
			errors.push(`Invalid modulation_preset type (${typeof value}) at ${where}`);
		}
	}
	if (action.modulation_params !== undefined) {
		if (action.modulation_preset !== undefined) {
			errors.push(`Ambiguous modulation at ${where}: provide either modulation_params or modulation_preset, not both`);
		}
		checkModulationParams(action.modulation_params, where, errors);
	}

	if (action.priority !== undefined && (typeof action.priority !== 'number' || action.priority < 0)) {
		errors.push(`Invalid priority '${action.priority}' at ${where}: expected number >= 0`);
	}
	if (action.cooldown_ms !== undefined && (typeof action.cooldown_ms !== 'number' || action.cooldown_ms < 0)) {
		errors.push(`Invalid cooldown_ms '${action.cooldown_ms}' at ${where}: expected number >= 0`);
	}
}

function validateActionSpec(
	action: unknown,
	file: string,
	eventName: string | undefined,
	eventChannel: unknown,
	ruleIndex: number,
	lookup: AemValidationLookup,
	errors: string[],
	warnings: string[],
	musicTransitionsWithFallback: Set<string>,
	sequenceIndex?: number,
): void {
	const where = `${file}${eventName ? `:${eventName}` : ''}#rule${ruleIndex}${sequenceIndex != null ? `.sequence[${sequenceIndex}]` : ''}`;
	if (!action) {
		errors.push(`Missing 'go' action at ${where}`);
		return;
	}
	if (typeof action !== 'object') {
		if (typeof action === 'string') {
			checkAction({ audio_id: action }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
			return;
		}
		errors.push(`Invalid action at ${where}`);
		return;
	}
	const actionObject = action as Record<string, unknown>;
	checkUnknownKeys(actionObject, ACTION_KEYS, where, errors);
	let commandCount = 0;
	if (actionObject.stop_music !== undefined) commandCount += 1;
	if (actionObject.sequence !== undefined) commandCount += 1;
	if (actionObject.music_transition !== undefined) commandCount += 1;
	if (actionObject.one_of !== undefined) commandCount += 1;
	if (actionObject.audio_id !== undefined) commandCount += 1;
	if (commandCount !== 1) {
		errors.push(`Invalid action command at ${where}: expected exactly one of audio_id, stop_music, sequence, music_transition, one_of`);
	}
	const stopMusic = actionObject.stop_music;
	if (stopMusic !== undefined) {
		if (stopMusic !== true) {
			if (!stopMusic || typeof stopMusic !== 'object' || Array.isArray(stopMusic)) {
				errors.push(`Invalid stop_music at ${where}: expected true or object`);
				return;
			}
			checkUnknownKeys(stopMusic as Record<string, unknown>, STOP_MUSIC_KEYS, `${where}.stop_music`, errors);
			checkOptionalNumber((stopMusic as { fade_ms?: unknown }).fade_ms, 'stop_music.fade_ms', where, errors);
		}
		return;
	}
	const sequence = actionObject.sequence;
	if (sequence !== undefined) {
		if (!Array.isArray(sequence)) {
			errors.push(`Invalid sequence at ${where}: expected array`);
			return;
		}
		if (sequence.length === 0) {
			errors.push(`Invalid sequence at ${where}: expected at least one item`);
			return;
		}
		for (let index = 0; index < sequence.length; index += 1) {
			validateActionSpec(sequence[index], file, eventName, eventChannel, ruleIndex, lookup, errors, warnings, musicTransitionsWithFallback, index);
		}
		return;
	}
	const transition = (action as MusicTransitionSpec).music_transition;
	if (transition !== undefined) {
		if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
			errors.push(`Invalid music_transition at ${where}: expected object`);
			return;
		}
		checkUnknownKeys(transition as Record<string, unknown>, MUSIC_TRANSITION_KEYS, `${where}.music_transition`, errors);
		const sync = transition.sync;
		const ruleKey = buildRuleKey(file, eventName, ruleIndex);
		const stingerSync = sync as AudioStingerSpec;
		if (stingerSync && typeof stingerSync === 'object' && stingerSync.return_to !== undefined) {
			musicTransitionsWithFallback.add(ruleKey);
		}
		checkAction({ audio_id: transition.audio_id }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
		if (transition.fade_ms !== undefined && (typeof transition.fade_ms !== 'number' || transition.fade_ms < 0)) {
			errors.push(`Invalid fade_ms at ${where}: must be >= 0`);
		}
		if (transition.crossfade_ms !== undefined && (typeof transition.crossfade_ms !== 'number' || transition.crossfade_ms < 0)) {
			errors.push(`Invalid crossfade_ms at ${where}: must be >= 0`);
		}
		if (transition.fade_ms !== undefined && transition.crossfade_ms !== undefined) {
			errors.push(`Ambiguous music_transition at ${where}: fade_ms and crossfade_ms cannot both be set`);
		}
		if (transition.start_at_loop_start !== undefined && typeof transition.start_at_loop_start !== 'boolean') {
			errors.push(`Invalid start_at_loop_start at ${where}: expected boolean`);
		}
		if (transition.start_fresh !== undefined && typeof transition.start_fresh !== 'boolean') {
			errors.push(`Invalid start_fresh at ${where}: expected boolean`);
		}
		if (transition.start_at_loop_start && transition.start_fresh) {
			errors.push(`Ambiguous music_transition at ${where}: start_at_loop_start and start_fresh cannot both be true`);
		}
		if (typeof sync === 'string') {
			if (!VALID_SYNC_STRINGS.has(sync)) {
				errors.push(`Invalid music_transition sync '${sync}' at ${where}: expected one of ${Array.from(VALID_SYNC_STRINGS).join(', ')}`);
			}
		} else if (sync && typeof sync === 'object' && !Array.isArray(sync)) {
			checkUnknownKeys(sync as Record<string, unknown>, STINGER_SYNC_KEYS, `${where}.music_transition.sync`, errors);
			const stinger = (sync as AudioStingerSpec).stinger;
			const hasStinger = stinger !== undefined;
			if (hasStinger) {
				const syncObject = sync as AudioStingerSpec;
				checkAction({ audio_id: syncObject.stinger }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
				if (syncObject.return_to_previous !== undefined) {
					errors.push(`Unsupported music_transition at ${where}: return_to_previous is runtime-state dependent; use explicit audio_id or return_to`);
				}
				if (syncObject.return_to !== undefined) {
					checkAction({ audio_id: syncObject.return_to }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
				}
				if (transition.audio_id !== undefined && syncObject.return_to !== undefined && syncObject.return_to !== transition.audio_id) {
					errors.push(`Ambiguous music_transition at ${where}: 'audio_id' (post-stinger target) conflicts with 'return_to' (two targets specified)`);
				} else if (transition.audio_id !== undefined && syncObject.return_to !== undefined) {
					warnings.push(`Redundant music_transition at ${where}: 'audio_id' and 'return_to' both target '${transition.audio_id}'. Consider removing one.`);
				}
			}
			else {
				errors.push(`Invalid music_transition at ${where}: sync object must specify stinger`);
			}
		} else if (sync !== undefined) {
			errors.push(`Invalid music_transition sync at ${where}: expected string or stinger object`);
		}
		return;
	}
	const oneOf = (action as AudioActionOneOfSpec).one_of;
	if (oneOf !== undefined) {
		if (!Array.isArray(oneOf)) {
			errors.push(`Invalid one_of at ${where}: expected array`);
			return;
		}
		if (oneOf.length === 0) {
			errors.push(`Invalid one_of at ${where}: expected at least one item`);
			return;
		}
		const pick = actionObject.pick;
		if (pick !== undefined && (typeof pick !== 'string' || !VALID_ONE_OF_PICK.has(pick))) {
			errors.push(`Invalid one_of pick '${String(pick)}' at ${where}: expected one of ${Array.from(VALID_ONE_OF_PICK).join(', ')}`);
		}
		if (actionObject.avoid_repeat !== undefined && typeof actionObject.avoid_repeat !== 'boolean') {
			errors.push(`Invalid avoid_repeat at ${where}: expected boolean`);
		}
		for (let index = 0; index < oneOf.length; index += 1) {
			const item = oneOf[index];
			if (typeof item === 'string') {
				checkAction({ audio_id: item }, { file, eventName, ruleIndex, sequenceIndex, choiceIndex: index }, lookup, errors, musicTransitionsWithFallback);
				continue;
			}
			if (item && typeof item === 'object') {
				checkAction(item, { file, eventName, ruleIndex, sequenceIndex, choiceIndex: index }, lookup, errors, musicTransitionsWithFallback);
				const weight = item.weight;
				if (weight !== undefined && (typeof weight !== 'number' || weight < 0)) {
					errors.push(`Invalid weight '${weight}' at ${where}[${index}]: expected number >= 0`);
				}
				continue;
			}
			errors.push(`Invalid one_of item at ${where}[${index}]`);
		}
		return;
	}
	checkAction(action as AudioAction, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
}

function validateRules(
	rules: AudioEventRule[],
	file: string,
	eventName: string | undefined,
	eventChannel: unknown,
	lookup: AemValidationLookup,
	errors: string[],
	warnings: string[],
	musicTransitionsWithFallback: Set<string>,
): void {
	if (!Array.isArray(rules)) {
		errors.push(`Rules for ${file}${eventName ? `:${eventName}` : ''} must be an array.`);
		return;
	}
	if (rules.length === 0) {
		errors.push(`Rules for ${file}${eventName ? `:${eventName}` : ''} must contain at least one rule.`);
		return;
	}
	for (let index = 0; index < rules.length; index += 1) {
		const rule = rules[index];
		if (!rule || typeof rule !== 'object') {
			errors.push(`Rule ${index} for ${file}${eventName ? `:${eventName}` : ''} must be an object.`);
			continue;
		}
		checkUnknownKeys(rule as Record<string, unknown>, RULE_KEYS, `${file}${eventName ? `:${eventName}` : ''}#rule${index}`, errors);
		validateMatcher((rule as { when?: unknown }).when, `${file}${eventName ? `:${eventName}` : ''}#rule${index}.when`, errors);
		validateActionSpec(rule.go, file, eventName, eventChannel, index, lookup, errors, warnings, musicTransitionsWithFallback);
	}
}

function validateEventDefinition(
	eventDefinition: unknown,
	fileTag: string,
	eventName: string,
	lookup: AemValidationLookup,
	errors: string[],
	warnings: string[],
	musicTransitionsWithFallback: Set<string>,
): void {
	if (Array.isArray(eventDefinition)) {
		errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} must be an object with 'rules'.`);
		return;
	}
	if (!eventDefinition || typeof eventDefinition !== 'object') {
		errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} must be an object.`);
		return;
	}
	const eventObject = eventDefinition as Record<string, unknown>;
	validateEventMeta(eventObject, fileTag, eventName, errors);
	if (!Array.isArray(eventObject.rules)) {
		errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} is missing a 'rules' array.`);
		return;
	}
	validateRules(eventObject.rules as AudioEventRule[], fileTag, eventName, eventObject.channel, lookup, errors, warnings, musicTransitionsWithFallback);
}

export function validateAemDocument(doc: unknown, lookup: AemValidationLookup, fileTag: string): AemValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const musicTransitionsWithFallback = new Set<string>();
	if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
		errors.push(`AEM document '${fileTag}' must be an object.`);
		return { errors, warnings };
	}
	const object = doc as Record<string, unknown>;
	if (object.events !== undefined) {
		if (!object.events || typeof object.events !== 'object' || Array.isArray(object.events)) {
			errors.push(`AEM document '${fileTag}' has invalid events: expected object.`);
			return { errors, warnings };
		}
		const eventNames = Object.keys(object.events as Record<string, unknown>);
		for (let index = 0; index < eventNames.length; index += 1) {
			const eventName = eventNames[index]!;
			validateEventDefinition((object.events as Record<string, unknown>)[eventName], fileTag, eventName, lookup, errors, warnings, musicTransitionsWithFallback);
		}
		return { errors, warnings };
	}
	const keys = Object.keys(object);
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index]!;
		switch (key) {
			case '$type':
			case 'name':
			case 'channel':
			case 'policy':
			case 'rules':
				continue;
		}
		validateEventDefinition(object[key], fileTag, key, lookup, errors, warnings, musicTransitionsWithFallback);
	}
	if (Array.isArray(object.rules)) {
		validateEventMeta(object, fileTag, undefined, errors);
		validateRules(object.rules as AudioEventRule[], fileTag, undefined, object.channel, lookup, errors, warnings, musicTransitionsWithFallback);
	}
	return { errors, warnings };
}

export function assertValidAemDocument(doc: unknown, lookup: AemValidationLookup, fileTag: string): void {
	const result = validateAemDocument(doc, lookup, fileTag);
	if (result.warnings.length > 0) {
		for (let index = 0; index < result.warnings.length; index += 1) {
			console.warn(result.warnings[index]);
		}
	}
	if (result.errors.length === 0) {
		return;
	}
	const body = result.errors.map(error => ` - ${error}`).join('\n');
	throw new Error(`Audio Event Map validation failed:\n${body}`);
}
