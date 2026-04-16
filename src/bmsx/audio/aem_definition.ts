import { load as loadYaml } from 'js-yaml';

// Authoring-time AEM schema and validation. AEM may describe audio behavior,
// but it is not the machine audio device or a host-side shortcut around MMIO.
export type StructuredTextDocumentFormat = 'yaml' | 'json';

type AudioAction = {
	audio_id?: string;
	modulation_preset?: string;
	priority?: number;
	cooldown_ms?: number;
};

type AudioActionOneOfSpec = {
	one_of?: Array<string | (AudioAction & { weight?: number })>;
};

type AudioDelaySpec = {
	delay_ms?: number;
};

type AudioStingerSpec = {
	stinger?: string;
	return_to?: string;
	return_to_previous?: boolean;
};

type MusicTransitionSpec = {
	music_transition?: {
		audio_id?: string;
		sync?: string | AudioDelaySpec | AudioStingerSpec;
		fade_ms?: number;
		start_at_loop_start?: boolean;
		start_fresh?: boolean;
	};
};

type AudioEventRule = {
	go?: unknown;
};

export type AemValidationDataAsset = {
	name: string;
	value: unknown;
};

export type AemValidationLookup = {
	audioIds: ReadonlySet<string>;
	dataAssetNames: ReadonlySet<string>;
	dataQualifiedKeys: ReadonlySet<string>;
};

export type AemValidationResult = {
	errors: string[];
	warnings: string[];
};

const VALID_CHANNELS = new Set(['sfx', 'music', 'ui']);
const VALID_POLICIES = new Set(['replace', 'ignore', 'queue', 'stop', 'pause']);

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
	const keyDepth = params.keyDepth ?? 3;
	for (const asset of params.dataAssets) {
		if (typeof asset.name !== 'string' || asset.name.length === 0) {
			continue;
		}
		dataAssetNames.add(asset.name);
		if (!asset.value || typeof asset.value !== 'object' || Array.isArray(asset.value)) {
			continue;
		}
		collectQualifiedKeys(asset.value as Record<string, unknown>, asset.name, keyDepth, dataQualifiedKeys);
	}
	return {
		audioIds,
		dataAssetNames,
		dataQualifiedKeys,
	};
}

function buildRuleKey(file: string, eventName: string, ruleIndex: number): string {
	return `${file}:${eventName ?? '<root>'}#rule${ruleIndex}`;
}

function validateEventMeta(
	ev: Record<string, unknown>,
	file: string,
	eventName: string,
	errors: string[],
): void {
	const where = `${file}${eventName ? `:${eventName}` : ''}`;
	const channel = ev['channel'];
	if (channel !== undefined && !VALID_CHANNELS.has(channel as string)) {
		errors.push(`Invalid channel '${channel}' at ${where}: expected one of ${Array.from(VALID_CHANNELS).join(', ')}`);
	}
	const policy = ev['policy'];
	if (policy !== undefined && !VALID_POLICIES.has(policy as string)) {
		errors.push(`Invalid policy '${policy}' at ${where}: expected one of ${Array.from(VALID_POLICIES).join(', ')}`);
	}
	if (ev['max_voices'] !== undefined) {
		const maxVoices = ev['max_voices'];
		if (typeof maxVoices !== 'number' || !Number.isInteger(maxVoices) || maxVoices < 1) {
			errors.push(`Invalid max_voices '${maxVoices}' at ${where}: expected integer >= 1`);
		}
	}
}

function checkAction(
	action: AudioAction,
	ctx: { file: string; eventName?: string; ruleIndex?: number; choiceIndex?: number; sequenceIndex?: number },
	lookup: AemValidationLookup,
	errors: string[],
	musicTransitionsWithFallback: Set<string>,
): void {
	const where = `${ctx.file}${ctx.eventName ? `:${ctx.eventName}` : ''}${ctx.ruleIndex != null ? `#rule${ctx.ruleIndex}` : ''}${ctx.sequenceIndex != null ? `.sequence[${ctx.sequenceIndex}]` : ''}${ctx.choiceIndex != null ? `[${ctx.choiceIndex}]` : ''}`;
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
			if (!lookup.dataAssetNames.has(value) && !lookup.dataQualifiedKeys.has(value)) {
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
			}
		} else {
			errors.push(`Invalid modulation_preset type (${typeof value}) at ${where}`);
		}
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
	eventName: string,
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
	if ((action as { stop_music?: unknown }).stop_music) {
		return;
	}
	const sequence = (action as { sequence?: unknown }).sequence;
	if (Array.isArray(sequence)) {
		for (let index = 0; index < sequence.length; index += 1) {
			validateActionSpec(sequence[index], file, eventName, ruleIndex, lookup, errors, warnings, musicTransitionsWithFallback, index);
		}
		return;
	}
	const transition = (action as MusicTransitionSpec).music_transition;
	if (transition) {
		const sync = transition.sync;
		const ruleKey = buildRuleKey(file, eventName, ruleIndex);
		const stingerSync = sync as AudioStingerSpec;
		if (stingerSync && (stingerSync.return_to !== undefined || stingerSync.return_to_previous)) {
			musicTransitionsWithFallback.add(ruleKey);
		}
		checkAction({ audio_id: transition.audio_id }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
		if (transition.fade_ms !== undefined && (typeof transition.fade_ms !== 'number' || transition.fade_ms < 0)) {
			errors.push(`Invalid fade_ms at ${where}: must be >= 0`);
		}
		if (transition.start_at_loop_start && transition.start_fresh) {
			errors.push(`Ambiguous music_transition at ${where}: start_at_loop_start and start_fresh cannot both be true`);
		}
		if (sync && typeof sync === 'object') {
			const delayMs = (sync as AudioDelaySpec).delay_ms;
			const stinger = (sync as AudioStingerSpec).stinger;
			const hasDelay = delayMs !== undefined;
			const hasStinger = stinger !== undefined;
			if (hasDelay && hasStinger) {
				errors.push(`Ambiguous music_transition at ${where}: sync cannot specify both stinger and delay_ms`);
			}
			if (hasStinger) {
				const syncObject = sync as AudioStingerSpec;
				checkAction({ audio_id: syncObject.stinger }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
				if (syncObject.return_to !== undefined) {
					checkAction({ audio_id: syncObject.return_to }, { file, eventName, ruleIndex, sequenceIndex }, lookup, errors, musicTransitionsWithFallback);
				}
				if (syncObject.return_to !== undefined && syncObject.return_to_previous) {
					errors.push(`Ambiguous music_transition at ${where}: provide either return_to or return_to_previous, not both`);
				}
				if (transition.audio_id !== undefined && syncObject.return_to !== undefined && syncObject.return_to !== transition.audio_id) {
					errors.push(`Ambiguous music_transition at ${where}: 'audio_id' (post-stinger target) conflicts with 'return_to' (two targets specified)`);
				} else if (transition.audio_id !== undefined && syncObject.return_to !== undefined) {
					warnings.push(`Redundant music_transition at ${where}: 'audio_id' and 'return_to' both target '${transition.audio_id}'. Consider removing one.`);
				}
			} else if (!hasDelay) {
				errors.push(`Invalid music_transition at ${where}: unknown sync object shape`);
			}
		}
		return;
	}
	const oneOf = (action as AudioActionOneOfSpec).one_of;
	if (Array.isArray(oneOf)) {
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
	eventName: string,
	lookup: AemValidationLookup,
	errors: string[],
	warnings: string[],
	musicTransitionsWithFallback: Set<string>,
): void {
	if (!Array.isArray(rules)) {
		return;
	}
	for (let index = 0; index < rules.length; index += 1) {
		const rule = rules[index];
		if (!rule || typeof rule !== 'object') {
			continue;
		}
		validateActionSpec(rule.go, file, eventName, index, lookup, errors, warnings, musicTransitionsWithFallback);
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
	if (eventObject.kind === 'musictransition' && eventObject.channel !== 'music') {
		errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} uses music_transition but channel is not 'music'.`);
	}
	validateRules(eventObject.rules as AudioEventRule[], fileTag, eventName, lookup, errors, warnings, musicTransitionsWithFallback);
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
	if (object.events && typeof object.events === 'object' && !Array.isArray(object.events)) {
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
		if (key === '$type' || key === 'name' || key === 'channel' || key === 'max_voices' || key === 'policy' || key === 'rules') {
			continue;
		}
		validateEventDefinition(object[key], fileTag, key, lookup, errors, warnings, musicTransitionsWithFallback);
	}
	if (Array.isArray(object.rules)) {
		validateEventMeta(object, fileTag, undefined, errors);
		validateRules(object.rules as AudioEventRule[], fileTag, undefined, lookup, errors, warnings, musicTransitionsWithFallback);
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
