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
// $.emit('combat.hit', { result: 'hit', material: 'barrier', weaponClass: 'heavy', actorId, targetId });

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

	init(maps: id2audioevent[], handlers: AudioHandler[]): void {
		this.handlers = handlers;
		this.merged = this.mergeMaps(maps);
		this.anyListener = (event_name, emitter, ...args) => {
			this.onEvent(event_name, { ...args } as AudioEventPayload, emitter);
		};
		$.event_emitter.onAny(this.anyListener);
	}

	dispose(): void {
		if (this.anyListener) $.event_emitter.offAny(this.anyListener);
		this.anyListener = undefined;
	}

	private onEvent(name: string, payload: AudioEventPayload = {}, emitter: Identifiable): void {
		// 1) allow complex handlers to preempt
		for (const h of this.handlers) {
			const handled = h({ name, payload, emitter: emitter.id, play: this.play.bind(this) });
			if (handled) return;
		}

		// 2) data-driven resolution
		const entry = this.merged.get(name);
		if (!entry) return;

		const action = this.pickAction(entry.rules, payload);
		if (!action) return;

		// cooldown
		const key = `${name}:${action.audioId}`;
		const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
		if (action.cooldownMs) {
			const last = this.lastPlayedAt.get(key) || 0;
			if ((now - last) < action.cooldownMs) return;
			this.lastPlayedAt.set(key, now);
		}

		// voice policy / priority (single SFX lane behavior)
		const pr = action.priority ?? 0;
		if (entry.channel !== 'music') {
			const currentTrackMeta = $.sndmaster.currentTrackMetaByType('sfx');
			if (currentTrackMeta) {
				if (entry.policy === 'ignore') {
					if (pr <= currentTrackMeta.priority) return;
				}
				// replace or higher priority: stop current SFX
				$.stopEffect();
			}
		}

		this.play(action.audioId, { payload: { modulationPreset: action.modulationPreset } });
	}

	private play(audioId: asset_id, ctx?: Partial<AudioHandleContext>): void {
		const presetKey = ctx?.payload?.modulationPreset;
		this.play(audioId, $.rompack.data[presetKey]);
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
		for (const m of maps) {
			for (const [k, v] of Object.entries(m)) {
				if (!out.has(k)) {
					out.set(k, { ...v, rules: [...(v.rules || [])] });
				} else {
					const cur = out.get(k)!;
					out.set(k, {
						...cur,
						...v,
						rules: [...(v.rules || []), ...(cur.rules || [])], // ROM overlay rules prepend
					});
				}
			}
		}
		return out;
	}
}
