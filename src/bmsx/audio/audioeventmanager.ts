import { EventHandler } from '../core/eventemitter';
import { $ } from '../core/game';
import { Registry } from '../core/registry';
import type {
	asset_id,
	AudioEventMapEntry,
	AudioEventPayload,
	AudioEventRule,
	id2audioevent,
	Identifiable,
	Identifier,
	RegisterablePersistent
} from '../rompack/rompack';

export interface AudioHandleContext {
	name: string;
	payload: AudioEventPayload;
	emitter: Identifier;
	// changed: play used to be typed as typeof SoundMaster.playAudio which doesn't exist / doesn't match.
	// Provide a callable signature that handlers can use.
	play: (audioId: asset_id, ctx?: Partial<AudioHandleContext>) => void;
}

export type AudioHandler = (ctx: AudioHandleContext) => boolean;

// Example usage
// $.emit('combat.hit', this, { result: 'hit', material: 'barrier', weaponClass: 'heavy', actorId, targetId });

// Example handler
// export function makeBarrierCommentary(): AudioHandler {
// 	const windowMs = 6000, needed = 3;
// 	const buckets = new Map<string, number[]>(); // key = actorId:bossId

// 	return ({ name, payload, emitter, play }) => {
// 		if (name !== 'combat.hit') return false;
// 		if (payload.result !== 'hit' || payload.material !== 'barrier') return false;
//		if (payload.actorId !== 'barret') return false;

// 		const key = `${payload.actorId}:${payload.targetId}`;
// 		const now = performance.now();
// 		const arr = (buckets.get(key) ?? []).filter(t => now - t < windowMs);
// 		arr.push(now); buckets.set(key, arr);

// 		if (arr.length >= needed) {
// 			play('VO_Barret_EnoughBarriers', { payload: { modulationPreset: 'vo' } });
// 		}
// 		buckets.set(key, []); // reset cooldown
// 		return true; // consume so data rules don't also fire
// 	}
// }

export class AudioEventManager implements RegisterablePersistent {
	public get registrypersistent(): true {
		return true;
	}

	public get id(): 'amg' {
		return 'amg';
	}

	private handlers: AudioHandler[] = [];

	/**
	* The singleton instance of the AudioManager class.
	*/
	private static _instance: AudioEventManager;

	public static get instance(): AudioEventManager {
		if (!AudioEventManager._instance) {
			AudioEventManager._instance = new AudioEventManager();
		}
		return AudioEventManager._instance;
	}

	constructor() {
		Registry.instance.register(this);
	}

	private merged: Map<string, AudioEventMapEntry> = new Map();
	private lastPlayedAt = new Map<string, number>();
	private anyListener?: EventHandler;

	init(maps: id2audioevent[], handlers?: AudioHandler[]): void {
		this.handlers = handlers ?? [];
		this.merged = this.mergeMaps(maps);
		this.anyListener = (event_name, emitter, payload) => {
			switch (emitter.id) {
				case 'view':
				case 'amg':
					// Ignore events from these emitters
					return;
			}
			this.onEvent(event_name, payload as AudioEventPayload, emitter);
		};
		$.event_emitter.onAny(this.anyListener);

		// Debug: list registered audio events and handlers
		try {
			const eventsSummary = Array.from(this.merged.entries()).map(([key, v]) => {
				const rlen = (v.rules?.length) ?? 0;
				const ch = v.channel ? `, ${v.channel}` : '';
				const pol = v.policy ? `, ${v.policy}` : '';
				const rules = v.rules?.map(r => {
					const when = r.when ? `when: ${JSON.stringify(r.when)}` : '';
					const doAction = r.do ? `do: ${JSON.stringify(r.do)}` : '';
					return `{ ${when}, ${doAction} }\n`;
				}).join(', ');
				return `${key} (${rlen} rules${ch}${pol}:\n${rules})`;
			});
			console.info('[AudioEventManager] events:', eventsSummary.length, eventsSummary);
			const handlerNames = this.handlers.map(h => h.name && h.name.length > 0 ? h.name : '(anonymous)');
			console.info('[AudioEventManager] handlers:', handlerNames.length, handlerNames);
		} catch { }
	}

	addHandler(handler: AudioHandler): void {
		this.handlers.push(handler);
	}

	removeHandler(handler: AudioHandler): void {
		this.handlers = this.handlers.filter(h => h !== handler);
	}

	dispose(): void {
		if (this.anyListener) $.event_emitter.offAny(this.anyListener);
		this.handlers = [];
		this.anyListener = undefined;
	}

	private onEvent(name: string, payload: AudioEventPayload = {}, emitter: Identifiable): boolean {
		// 1) allow complex handlers to preempt
		for (const h of this.handlers) {
			const handled = h({ name, payload, emitter: emitter.id, play: this.play.bind(this) });
			if (handled) return true;
		}

		// 2) data-driven resolution
		const entry = this.merged.get(name);
		if (!entry) return false;

		const action = this.pickAction(entry.rules, payload);
		if (!action) return true;

		// cooldown
		const key = `${name}:${action.audioId}`;
		const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		if (action.cooldownMs) {
			const last = this.lastPlayedAt.get(key) || 0;
			if ((now - last) < action.cooldownMs) return true;
			this.lastPlayedAt.set(key, now);
		}

		// voice policy / priority (single SFX lane behavior)
		const pr = action.priority ?? $.rompack.audio[action.audioId]?.audiometa.priority ?? 0;
		if (entry.channel !== 'music') {
			const currentTrackMeta = $.sndmaster.currentTrackMetaByType('sfx');
			if (currentTrackMeta) {
				switch (entry.policy) {
					case 'ignore': // If any effect is playing, ignore this one
						return true;
					case 'replace': // If the new effect has equal or higher priority, replace the current one, otherwise we ignore it
						if (pr < currentTrackMeta.priority) return true; // TODO: Also add cooldown handling and also keep track of the priority of the current effect *based on the rule* that started it's playback!
						$.stopEffect();
						break;
					case 'stop': // Stop the current effect
						$.stopEffect();
						return true;
					// TODO: IMPLEMENT!
					case 'pause':
						return true;
					// TODO: IMPLEMENT!
					case 'queue':
						return true;
				}
			}
		}
		this.play(action.audioId, { payload: { modulationPreset: action.modulationPreset } });

		return true;
	}

	private play(audioId: asset_id, ctx?: Partial<AudioHandleContext>): void {
		const presetKey = ctx?.payload?.modulationPreset;
		$.playAudio(audioId, $.rompack.data[presetKey]);
	}

	private pickAction(rules: AudioEventRule[], payload: AudioEventPayload) {
		for (const r of rules) {
			if (this.matches(r.when, payload)) return r.do;
		}
		return undefined;
	}

	private matches(m: AudioEventRule['when'], p: AudioEventPayload): boolean {
		if (!m) return true;
		const rec = p as Record<string, unknown>;
		if (m.equals) {
			for (const k in m.equals) {
				if (rec[k] !== m.equals[k]) return false;
			}
		}
		if (m.anyOf) {
			for (const k in m.anyOf) {
				const list = m.anyOf[k];
				if (!Array.isArray(list) || !list.includes(rec[k] as unknown)) return false;
			}
		}
		if (m.hasTag && m.hasTag.length > 0) {
			const tagsVal = rec['tags'];
			if (!Array.isArray(tagsVal)) return false;
			const tags = tagsVal as string[];
			for (const t of m.hasTag) if (!tags.includes(t)) return false;
		}
		return true;
	}

	private mergeMaps(maps: id2audioevent[]): Map<string, AudioEventMapEntry> {
		const out = new Map<string, AudioEventMapEntry>();

		// Helper to add or merge a single event entry by name
		const addOrMerge = (eventName: string, entry: AudioEventMapEntry) => {
			if (!eventName) return; // guard against malformed input
			const cur = out.get(eventName);
			if (!cur) {
				// Ensure rules is a fresh array
				out.set(eventName, { ...entry, name: eventName, rules: entry.rules ? entry.rules.slice() : [] });
			} else {
				// ROM overlay rules prepend; entry props override cur
				const mergedRules = (entry.rules ? entry.rules : []).concat(cur.rules || []);
				out.set(eventName, { ...cur, ...entry, name: eventName, rules: mergedRules });
			}
		};

		for (const map of maps) {
			for (const assetId in map) {
				const v: any = (map as any)[assetId];
				if (!v || typeof v !== 'object') continue;

				// Case 1: Container with explicit `events` map
				const evtMap = v.events;
				if (evtMap && typeof evtMap === 'object') {
					for (const evName in evtMap) {
						const ev = evtMap[evName] as AudioEventMapEntry;
						if (ev && typeof ev === 'object') addOrMerge(evName, ev);
					}
					continue;
				}

				// Case 2: Events declared directly at top-level (e.g., keys like "combat.hit")
				let foundDirect = false;
				for (const key in v) {
					// Skip known meta or entry fields
					if (key === '$type' || key === 'events' || key === 'name' || key === 'channel' || key === 'maxVoices' || key === 'policy' || key === 'rules') continue;
					const ev = v[key];
					if (ev && typeof ev === 'object' && ('rules' in ev)) {
						foundDirect = true;
						addOrMerge(key, ev as AudioEventMapEntry);
					}
				}
				if (foundDirect) continue;

				// Case 3: Single entry object (fallback). Use its name if available.
				if (v.rules && Array.isArray(v.rules)) {
					const evName = typeof v.name === 'string' && v.name.length > 0 ? v.name : '';
					if (evName) addOrMerge(evName, v as AudioEventMapEntry);
				}
			}
		}
		return out;
	}
}
