import { AudioAction, AudioActionOneOfSpec, AudioEventRule } from '../../src/bmsx';
import type { Resource } from './rompacker.rompack';
// @ts-ignore
const yaml = require('js-yaml');

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
	const audioById = new Set<number>();
	for (const r of resources) {
		if (r.type === 'audio') {
			if (typeof r.name === 'string') audioByName.add(r.name);
			if (typeof r.id === 'number') audioById.add(r.id);
		}
	}

	// Build lookup of data assets (any data file). We only verify that a referenced modulation preset
	// points to a known data asset (by name or id), not a specific preset collection.
	const dataByName = new Set<string>();
	const dataById = new Set<number>();
	const dataTopLevelKeys = new Set<string>();
	for (const r of resources) {
		if (r.type === 'data') {
			if (typeof r.name === 'string') dataByName.add(r.name);
			if (typeof r.id === 'number') dataById.add(r.id);
			// Also collect top-level keys from JSON/YAML objects for convenience (e.g., modulationparams.attacksfx)
			if (r.buffer && (r.datatype === 'yaml' || r.datatype === 'json')) {
				try {
					const raw = r.buffer.toString('utf8');
					const obj = r.datatype === 'yaml' ? yaml.load(raw) : JSON.parse(raw);
					if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
						for (const k of Object.keys(obj as Record<string, unknown>)) dataTopLevelKeys.add(k);
					}
				} catch { /* ignore parse errors here; data file validity will be enforced elsewhere */ }
			}
		}
	}

	const errors: string[] = [];

	function checkAction(ref: AudioAction, ctx: { file: string; event?: string; ruleIndex?: number; choiceIndex?: number }): void {
		const where = `${ctx.file}${ctx.event ? `:${ctx.event}` : ''}${ctx.ruleIndex != null ? `#rule${ctx.ruleIndex}` : ''}${ctx.choiceIndex != null ? `[${ctx.choiceIndex}]` : ''}`;
		// audioId: string (name) or number (id)
		if (ref.audioId === undefined || ref.audioId === null) {
			errors.push(`Missing audioId at ${where}`);
		} else if (typeof ref.audioId === 'string') {
			if (!audioByName.has(ref.audioId)) errors.push(`Unknown audioId '${ref.audioId}' at ${where}`);
		} else if (typeof ref.audioId === 'number') {
			if (!audioById.has(ref.audioId)) errors.push(`Unknown audioId #${ref.audioId} at ${where}`);
		} else {
			errors.push(`Invalid audioId type (${typeof ref.audioId}) at ${where}`);
		}

		// modulationPreset: if present, must reference a known data asset (name or id)
		if (ref.modulationPreset !== undefined) {
			const v = ref.modulationPreset;
			if (typeof v === 'string') {
				if (!dataByName.has(v) && !dataTopLevelKeys.has(v)) errors.push(`Unknown data asset or key for modulationPreset '${v}' at ${where}`);
			} else if (typeof v === 'number') {
				if (!dataById.has(v)) errors.push(`Unknown data asset id for modulationPreset #${v} at ${where}`);
			} else {
				errors.push(`Invalid modulationPreset type (${typeof v}) at ${where}`);
			}
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
				checkAction({ audioId: mt.audioId }, { file, event: eventName, ruleIndex: ri });
				// Basic value checks
				if (mt.fadeMs !== undefined && (!(typeof mt.fadeMs === 'number') || mt.fadeMs < 0)) {
					errors.push(`Invalid fadeMs at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: must be >= 0`);
				}
				if (mt.startAtLoopStart && mt.startFresh) {
					errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: startAtLoopStart and startFresh cannot both be true`);
				}
				const sync = mt.sync;
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
						if (sync.returnTo !== undefined && sync.returnTo !== mt.audioId) {
							errors.push(`Ambiguous musicTransition at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}: 'audioId' (post-stinger target) conflicts with 'returnTo' (two targets specified)`);
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
					if (typeof item === 'string' || typeof item === 'number') {
						checkAction({ audioId: item }, { file, event: eventName, ruleIndex: ri, choiceIndex: ci });
					} else if (item && typeof item === 'object') {
						checkAction({ audioId: item.audioId, modulationPreset: item.modulationPreset }, { file, event: eventName, ruleIndex: ri, choiceIndex: ci });
					} else {
						errors.push(`Invalid oneOf item at ${file}${eventName ? `:${eventName}` : ''}#rule${ri}[${ci}]`);
					}
				});
			} else {
				checkAction({ audioId: (act as AudioAction).audioId, modulationPreset: (act as AudioAction).modulationPreset }, { file, event: eventName, ruleIndex: ri });
			}
		});
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

			// Prefer explicit 'events' map
			if (obj.events && typeof obj.events === 'object') {
				for (const evName of Object.keys(obj.events)) {
					const ev = obj.events[evName];
					if (ev && typeof ev === 'object' && Array.isArray(ev.rules)) {
						validateRules(ev.rules, fileTag, evName);
					}
				}
				continue;
			}

			// Otherwise, scan direct entries with 'rules'
			for (const key of Object.keys(obj)) {
				if (key === '$type' || key === 'name' || key === 'channel' || key === 'maxVoices' || key === 'policy' || key === 'rules') continue;
				const ev = obj[key];
				if (ev && typeof ev === 'object' && Array.isArray(ev.rules)) {
					validateRules(ev.rules, fileTag, key);
				}
			}
			// Fallback: if root itself looks like a single entry with 'rules'
			if (Array.isArray((obj.rules))) {
				validateRules(obj.rules, fileTag);
			}
		} catch (e) {
			throw new Error(`Failed to parse AEM file '${r.filepath ?? r.name}': ${e?.message ?? e}`);
		}
	}

	if (errors.length > 0) {
		const msg = errors.map(e => ` - ${e}`).join('\n');
		throw new Error(`Audio Event Map validation failed:\n${msg}`);
	}
}
