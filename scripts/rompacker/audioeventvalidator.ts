import type { Resource } from './rompacker.rompack';
// @ts-ignore
const yaml = require('js-yaml');

type AudioAction = {
	kind?: string;
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

const VALID_CHANNELS = new Set(['sfx', 'music', 'ui']);
const VALID_POLICIES = new Set(['replace', 'ignore', 'queue', 'stop', 'pause']);

/**
 * Validates cross-references in Audio Event Maps (AEM):
 * - Ensures each referenced `audio_id` exists among loaded audio resources.
 * - Ensures each referenced `modulation_preset` exists in `modulationparams` data.
 * This check runs after all resources are loaded and prior to ROM asset generation.
 *
 * Throws an Error with a summary of all issues if any invalid references are found.
 */
export function validateAudioEventReferences(resources: Resource[]): void {
	// Build lookup of audio resources by name and id
	const audioByName = new Set<string>();
	for (const r of resources) {
		if (r.type === 'audio') {
			audioByName.add(r.name);
		}
	}

	function validateEventMeta(ev: Record<string, unknown>, file: string, eventName?: string): void {
		const where = `${file}${eventName ? `:${eventName}` : ''}`;
		const channel = ev['channel'];
		if (channel !== undefined && (!VALID_CHANNELS.has(channel as string))) {
			errors.push(`Invalid channel '${channel}' at ${where}: expected one of ${Array.from(VALID_CHANNELS).join(', ')}`);
		}
		const policy = ev['policy'];
		if (policy !== undefined && (!VALID_POLICIES.has(policy as string))) {
			errors.push(`Invalid policy '${policy}' at ${where}: expected one of ${Array.from(VALID_POLICIES).join(', ')}`);
		}
		if (ev['max_voices'] !== undefined) {
			const max_voices = ev['max_voices'];
			if (typeof max_voices !== 'number' || !Number.isInteger(max_voices) || max_voices < 1) {
				errors.push(`Invalid max_voices '${max_voices}' at ${where}: expected integer >= 1`);
			}
		}
	}

	// Build lookup of data assets (any data file). Referencing a modulation preset now requires
	// dot-notation: `${dataAssetName}.${topLevelKey}`. Referencing the entire data asset by name
	// remains valid (for presets provided as whole objects).
	const dataByName = new Set<string>();
	const dataQualifiedKeys = new Set<string>();
	for (const r of resources) {
		if (r.type === 'data') {
			if (typeof r.name === 'string') dataByName.add(r.name);
			if (r.buffer && (r.datatype === 'yaml' || r.datatype === 'json')) {
				try {
					const raw = r.buffer.toString('utf8');
					const obj = r.datatype === 'yaml' ? yaml.load(raw) : JSON.parse(raw);
					if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof r.name === 'string') {
						collectKeys(obj as Record<string, unknown>, r.name, 3);
					}
				} catch { /* ignore parse errors here; data file validity will be enforced elsewhere */ }
			}
		}
	}

	const errors: string[] = [];
	const warnings: string[] = [];
	const musicTransitionsWithFallback = new Set<string>();

	function collectKeys(obj: Record<string, unknown>, prefix: string, depth: number): void {
		if (depth < 0) return;
		for (const key of Object.keys(obj)) {
			const qualified = prefix ? `${prefix}.${key}` : key;
			dataQualifiedKeys.add(qualified);
			const value = obj[key];
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				collectKeys(value as Record<string, unknown>, qualified, depth - 1);
			}
		}
	}

	function makeRuleKey(file: string, event: string, ruleIndex: number): string {
		return `${file}:${event ?? '<root>'}#rule${ruleIndex}`;
	}

	function checkAction(ref: AudioAction, ctx: { file: string; event?: string; ruleIndex?: number; choiceIndex?: number; sequenceIndex?: number }): void {
		const where = `${ctx.file}${ctx.event ? `:${ctx.event}` : ''}${ctx.ruleIndex != null ? `#rule${ctx.ruleIndex}` : ''}${ctx.sequenceIndex != null ? `.sequence[${ctx.sequenceIndex}]` : ''}${ctx.choiceIndex != null ? `[${ctx.choiceIndex}]` : ''}`;
		const ruleKey = ctx.ruleIndex != null ? makeRuleKey(ctx.file, ctx.event, ctx.ruleIndex) : undefined;
		// audio_id: string (name) or number (id)
		if (ref.audio_id === undefined || ref.audio_id === null) {
			const hasStingerFallback = ruleKey ? musicTransitionsWithFallback.has(ruleKey) : false;
			if (!hasStingerFallback) errors.push(`Missing audio_id at ${where}`);
		} else if (typeof ref.audio_id === 'string') {
			if (!audioByName.has(ref.audio_id)) errors.push(`Unknown audio_id '${ref.audio_id}' at ${where}`);
		} else {
			errors.push(`Invalid audio_id type (${typeof ref.audio_id}) at ${where}`);
		}

		// modulation_preset: if present, must reference a known data asset (name or id)
		if (ref.modulation_preset !== undefined) {
			const v = ref.modulation_preset;
			if (typeof v === 'string') {
				if (!dataByName.has(v) && !dataQualifiedKeys.has(v)) {
					let hint = '';
					if (!v.includes('.')) {
						const matches: string[] = [];
						for (const key of dataQualifiedKeys) {
							if (key.endsWith(`.${v}`)) matches.push(key);
						}
						if (matches.length > 0) {
							hint = ` (did you mean ${matches.join(', ')}?)`;
						}
					}
					errors.push(`Unknown data asset or key for modulation_preset '${v}' at ${where}${hint}`);
				}
			} else {
				errors.push(`Invalid modulation_preset type (${typeof v}) at ${where}`);
			}
		}

		if (ref.priority !== undefined && (typeof ref.priority !== 'number' || ref.priority < 0)) {
			errors.push(`Invalid priority '${ref.priority}' at ${where}: expected number >= 0`);
		}
		if (ref.cooldown_ms !== undefined && (typeof ref.cooldown_ms !== 'number' || ref.cooldown_ms < 0)) {
			errors.push(`Invalid cooldown_ms '${ref.cooldown_ms}' at ${where}: expected number >= 0`);
		}
	}

	function validateActionSpec(act: any, file: string, eventName: string | undefined, ri: number, sequenceIndex?: number): void {
		const where = `${file}${eventName ? `:${eventName}` : ''}#rule${ri}${sequenceIndex != null ? `.sequence[${sequenceIndex}]` : ''}`;
		if (!act) {
			errors.push(`Missing 'go' action at ${where}`);
			return;
		}
		if (typeof act !== 'object') {
			if (typeof act === 'string') {
				checkAction({ kind: 'action', audio_id: act }, { file, event: eventName, ruleIndex: ri, sequenceIndex });
				return;
			}
			errors.push(`Invalid action at ${where}`);
			return;
		}

		// stop_music: true
		if ((act as { stop_music?: unknown }).stop_music) {
			return;
		}

		// sequence: AudioActionSpec[]
		const seq = (act as { sequence?: unknown }).sequence;
		if (Array.isArray(seq)) {
			seq.forEach((item: any, si: number) => {
				validateActionSpec(item, file, eventName, ri, si);
			});
			return;
		}

		const transition = (act as MusicTransitionSpec).music_transition;
		if (transition) {
			const sync = transition.sync;
			const ruleKey = makeRuleKey(file, eventName, ri);
			const stingerSync = sync as AudioStingerSpec;
			if (stingerSync && (stingerSync.return_to !== undefined || stingerSync.return_to_previous)) {
				musicTransitionsWithFallback.add(ruleKey);
			}
			checkAction({ kind: 'action', audio_id: transition.audio_id }, { file, event: eventName, ruleIndex: ri, sequenceIndex });
			// Basic value checks
			if (transition.fade_ms !== undefined && (!(typeof transition.fade_ms === 'number') || transition.fade_ms < 0)) {
				errors.push(`Invalid fade_ms at ${where}: must be >= 0`);
			}
			if (transition.start_at_loop_start && transition.start_fresh) {
				errors.push(`Ambiguous music_transition at ${where}: start_at_loop_start and start_fresh cannot both be true`);
			}
			if (sync && typeof sync === 'object') {
				const stinger = (sync as AudioStingerSpec).stinger;
				const delay_ms = (sync as AudioDelaySpec).delay_ms;
				const hasStinger = stinger !== undefined;
				const hasDelay = delay_ms !== undefined;
				if (hasStinger && hasDelay) {
					errors.push(`Ambiguous music_transition at ${where}: sync cannot specify both stinger and delay_ms`);
				}
				if (hasStinger) {
					const stingerSync = sync as AudioStingerSpec;
					checkAction({ kind: 'action', audio_id: stingerSync.stinger }, { file, event: eventName, ruleIndex: ri, sequenceIndex });
					if (stingerSync.return_to !== undefined) checkAction({ kind: 'action', audio_id: stingerSync.return_to }, { file, event: eventName, ruleIndex: ri, sequenceIndex });
					if (stingerSync.return_to !== undefined && stingerSync.return_to_previous) {
						errors.push(`Ambiguous music_transition at ${where}: provide either return_to or return_to_previous, not both`);
					}
					if (transition.audio_id !== undefined && stingerSync.return_to !== undefined && stingerSync.return_to !== transition.audio_id) {
						errors.push(`Ambiguous music_transition at ${where}: 'audio_id' (post-stinger target) conflicts with 'return_to' (two targets specified)`);
					} else if (transition.audio_id !== undefined && stingerSync.return_to !== undefined) {
						warnings.push(`Redundant music_transition at ${where}: 'audio_id' and 'return_to' both target '${transition.audio_id}'. Consider removing one.`);
					}
				} else if (!hasDelay) {
					// Unknown object props in sync → error
					errors.push(`Invalid music_transition at ${where}: unknown sync object shape`);
				}
			}
			return;
		}

		const one_of = (act as AudioActionOneOfSpec).one_of;
		if (Array.isArray(one_of)) {
			one_of.forEach((item: any, ci: number) => {
				if (typeof item === 'string') {
					checkAction({ kind: 'action', audio_id: item }, { file, event: eventName, ruleIndex: ri, sequenceIndex, choiceIndex: ci });
				} else if (item && typeof item === 'object') {
					checkAction({ kind: 'action', audio_id: item.audio_id, modulation_preset: item.modulation_preset, priority: item.priority, cooldown_ms: item.cooldown_ms }, { file, event: eventName, ruleIndex: ri, sequenceIndex, choiceIndex: ci });
					const weight = item.weight;
					if (weight !== undefined && (typeof weight !== 'number' || weight < 0)) {
						errors.push(`Invalid weight '${weight}' at ${where}[${ci}]: expected number >= 0`);
					}
				} else {
					errors.push(`Invalid one_of item at ${where}[${ci}]`);
				}
			});
			return;
		}

		const actObj = act as AudioAction;
		checkAction({ kind: 'action', audio_id: actObj.audio_id, modulation_preset: actObj.modulation_preset, priority: actObj.priority, cooldown_ms: actObj.cooldown_ms }, { file, event: eventName, ruleIndex: ri, sequenceIndex });
	}

	function validateRules(rules: AudioEventRule[], file: string, eventName?: string) {
		if (!Array.isArray(rules)) return;
		rules.forEach((rule, ri) => {
			if (!rule || typeof rule !== 'object') return;
			const act = rule.go;
			validateActionSpec(act, file, eventName, ri);
		});
	}

	function validateEventDefinition(ev: unknown, fileTag: string, eventName?: string): void {
		if (Array.isArray(ev)) {
			errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} must be an object with 'rules'.`);
			return;
		}
		if (!ev || typeof ev !== 'object') {
			errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} must be an object.`);
			return;
		}
		const evObj = ev as Record<string, unknown>;
		validateEventMeta(evObj, fileTag, eventName);
		if (!Array.isArray(evObj.rules)) {
			errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} is missing a 'rules' array.`);
			return;
		}
		if (evObj.kind === 'musictransition' && evObj.channel !== 'music') {
			errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} uses music_transition but channel is not 'music'.`);
		}
		validateRules(evObj.rules as AudioEventRule[], fileTag, eventName);
	}

	// Scan all AEM files
	for (const r of resources) {
		if (r.type !== 'aem' || !r.buffer) continue;
		try {
			const raw = r.buffer.toString('utf8');
			const doc = r.datatype === 'yaml' ? yaml.load(raw) : JSON.parse(raw);
			if (!doc || typeof doc !== 'object') continue;
			const obj = doc;
			const fileTag = r.filepath ?? r.name;
			musicTransitionsWithFallback.clear();

			// Prefer explicit 'events' map
			if (obj.events && typeof obj.events === 'object') {
				for (const evName of Object.keys(obj.events)) {
					const ev = obj.events[evName];
					validateEventDefinition(ev, fileTag, evName);
				}
				continue;
			}

			// Otherwise, scan direct entries with 'rules'
			for (const key of Object.keys(obj)) {
				if (key === '$type' || key === 'name' || key === 'channel' || key === 'max_voices' || key === 'policy' || key === 'rules') continue;
				const ev = obj[key];
				validateEventDefinition(ev, fileTag, key);
			}
			// Fallback: if root itself looks like a single entry with 'rules'
			if (Array.isArray((obj as Record<string, unknown>).rules)) {
				validateEventMeta(obj as Record<string, unknown>, fileTag);
				validateRules((obj as Record<string, unknown>).rules as AudioEventRule[], fileTag);
			}
		} catch (e) {
			throw new Error(`Failed to parse AEM file '${r.filepath ?? r.name}': ${e?.message ?? e}`);
		}
	}

	if (warnings.length > 0) {
		for (const w of warnings) console.warn(w);
	}

	if (errors.length > 0) {
		const msg = errors.map(e => ` - ${e}`).join('\n');
		throw new Error(`Audio Event Map validation failed:\n${msg}`);
	}
}
