import { AudioAction, AudioActionOneOfSpec, AudioEventRule } from '../../src/bmsx';
import type { Resource } from './rompacker.rompack';
// @ts-ignore
const yaml = require('js-yaml');

const VALID_CHANNELS = new Set(['sfx', 'music', 'ui']);
const VALID_POLICIES = new Set(['replace', 'ignore', 'queue', 'stop', 'pause']);

/**
 * Validates cross-references in Audio Event Maps (AEM):
 * - Ensures each referenced `audioId` exists among loaded audio resources.
 * - Ensures each referenced `modulationPreset` exists in `modulationparams` data.
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
		if (ev['maxVoices'] !== undefined) {
			const maxVoices = ev['maxVoices'];
			if (typeof maxVoices !== 'number' || !Number.isInteger(maxVoices) || maxVoices < 1) {
				errors.push(`Invalid maxVoices '${maxVoices}' at ${where}: expected integer >= 1`);
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

	function makeRuleKey(file: string, event: string | undefined, ruleIndex: number): string {
		return `${file}:${event ?? '<root>'}#rule${ruleIndex}`;
	}

	function eventHasMusicTransition(ev: Record<string, unknown>): boolean {
		const rules = ev.rules;
		if (!Array.isArray(rules)) return false;
		return rules.some(rule => {
			const action = rule.do;
			return action && typeof action === 'object' && 'musicTransition' in action;
		});
	}

	function checkAction(ref: AudioAction, ctx: { file: string; event?: string; ruleIndex?: number; choiceIndex?: number }): void {
		const where = `${ctx.file}${ctx.event ? `:${ctx.event}` : ''}${ctx.ruleIndex != null ? `#rule${ctx.ruleIndex}` : ''}${ctx.choiceIndex != null ? `[${ctx.choiceIndex}]` : ''}`;
		const ruleKey = ctx.ruleIndex != null ? makeRuleKey(ctx.file, ctx.event, ctx.ruleIndex) : undefined;
		// audioId: string (name) or number (id)
		if (ref.audioId === undefined || ref.audioId === null) {
			const hasStingerFallback = ruleKey ? musicTransitionsWithFallback.has(ruleKey) : false;
			if (!hasStingerFallback) errors.push(`Missing audioId at ${where}`);
		} else if (typeof ref.audioId === 'string') {
			if (!audioByName.has(ref.audioId)) errors.push(`Unknown audioId '${ref.audioId}' at ${where}`);
		} else {
			errors.push(`Invalid audioId type (${typeof ref.audioId}) at ${where}`);
		}

		// modulationPreset: if present, must reference a known data asset (name or id)
		if (ref.modulationPreset !== undefined) {
			const v = ref.modulationPreset;
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
					errors.push(`Unknown data asset or key for modulationPreset '${v}' at ${where}${hint}`);
				}
			} else {
				errors.push(`Invalid modulationPreset type (${typeof v}) at ${where}`);
			}
		}

		if (ref.priority !== undefined && (typeof ref.priority !== 'number' || ref.priority < 0)) {
			errors.push(`Invalid priority '${ref.priority}' at ${where}: expected number >= 0`);
		}
		if (ref.cooldownMs !== undefined && (typeof ref.cooldownMs !== 'number' || ref.cooldownMs < 0)) {
			errors.push(`Invalid cooldownMs '${ref.cooldownMs}' at ${where}: expected number >= 0`);
		}
	}

	function validateRules(rules: AudioEventRule[], file: string, eventName?: string) {
		if (!Array.isArray(rules)) return;
		rules.forEach((rule, ri) => {
			if (!rule || typeof rule !== 'object') return;
			const act = rule.do;
			if (!act) { errors.push(`Missing 'do' action at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}`); return; }
			if (typeof act === 'object' && 'musicTransition' in act && act.musicTransition) {
				const mt = act.musicTransition;
				const sync = mt.sync;
				const ruleKey = makeRuleKey(file, eventName, ri);
				if (sync && typeof sync === 'object' && 'stinger' in sync && (sync.returnTo !== undefined || sync.returnToPrevious)) {
					musicTransitionsWithFallback.add(ruleKey);
				}
				checkAction({ audioId: mt.audioId }, { file, event: eventName, ruleIndex: ri });
				// Basic value checks
				if (mt.fadeMs !== undefined && (!(typeof mt.fadeMs === 'number') || mt.fadeMs < 0)) {
					errors.push(`Invalid fadeMs at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: must be >= 0`);
				}
				if (mt.startAtLoopStart && mt.startFresh) {
					errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: startAtLoopStart and startFresh cannot both be true`);
				}
				if (sync && typeof sync === 'object') {
					const hasStinger = 'stinger' in sync;
					const hasDelay = 'delayMs' in sync;
					if (hasStinger && hasDelay) {
						errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: sync cannot specify both stinger and delayMs`);
					}
					if (hasStinger) {
						checkAction({ audioId: sync.stinger }, { file, event: eventName, ruleIndex: ri });
						if (sync.returnTo !== undefined) checkAction({ audioId: sync.returnTo }, { file, event: eventName, ruleIndex: ri });
						if (sync.returnTo !== undefined && sync.returnToPrevious) {
							errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: provide either returnTo or returnToPrevious, not both`);
						}
						if (mt.audioId !== undefined && sync.returnTo !== undefined && sync.returnTo !== mt.audioId) {
							errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: 'audioId' (post-stinger target) conflicts with 'returnTo' (two targets specified)`);
						} else if (mt.audioId !== undefined && sync.returnTo !== undefined) {
							warnings.push(`Redundant musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: 'audioId' and 'returnTo' both target '${mt.audioId}'. Consider removing one.`);
						}
					} else if (!hasDelay) {
						// Unknown object props in sync → error
						errors.push(`Invalid musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: unknown sync object shape`);
					}
				}
				return;
			}
			if (typeof act === 'object' && (act as AudioActionOneOfSpec).oneOf && Array.isArray((act as AudioActionOneOfSpec).oneOf)) {
				(act as AudioActionOneOfSpec).oneOf.forEach((item: any, ci: number) => {
					if (typeof item === 'string') {
						checkAction({ audioId: item }, { file, event: eventName, ruleIndex: ri, choiceIndex: ci });
					} else if (item && typeof item === 'object') {
						checkAction({ audioId: item.audioId, modulationPreset: item.modulationPreset, priority: item.priority, cooldownMs: item.cooldownMs }, { file, event: eventName, ruleIndex: ri, choiceIndex: ci });
						const weight = (item as { weight?: unknown }).weight;
						if (weight !== undefined && (typeof weight !== 'number' || weight < 0)) {
							errors.push(`Invalid weight '${weight}' at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}[${ci}]: expected number >= 0`);
						}
					} else {
						errors.push(`Invalid oneOf item at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}[${ci}]`);
					}
				});
			} else {
				checkAction({ audioId: (act as AudioAction).audioId, modulationPreset: (act as AudioAction).modulationPreset, priority: (act as AudioAction).priority, cooldownMs: (act as AudioAction).cooldownMs }, { file, event: eventName, ruleIndex: ri });
			}
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
		if (eventHasMusicTransition(evObj) && evObj.channel !== 'music') {
			errors.push(`Event '${eventName ?? '<root>'}' in ${fileTag} uses musicTransition but channel is not 'music'.`);
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
				if (key === '$type' || key === 'name' || key === 'channel' || key === 'maxVoices' || key === 'policy' || key === 'rules') continue;
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
