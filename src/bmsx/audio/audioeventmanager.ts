import { EventEmitter, EventHandler } from '../core/eventemitter';
import type { GameEvent } from '../core/game_event';
import { $ } from '../core/engine_core';
import { Registry } from '../core/registry';
import { Runtime } from '../emulator/runtime';
import type {
	asset_id,
	AudioId,
	AudioType,
	id2audioevent,
	Identifiable,
	Identifier,
	RegisterablePersistent,
} from '../rompack/rompack';
import type { ActiveVoiceInfo, ModulationParams, RandomModulationParams, SoundMasterPlayRequest } from './soundmaster';

export interface AudioEventPayload {
	actorId?: Identifier;
	targetId?: Identifier;
	modulation_preset?: asset_id;
	modulation_params?: RandomModulationParams | ModulationParams;
	[k: string]: unknown;
}

export interface AudioCaseMatcher {
	// Basic comparisons
	equals?: Record<string, unknown>;
	/**
	 * Value must be in provided list per key. Alias: `in`.
	 */
	any_of?: Record<string, unknown[]>;
	/**
	 * Synonym for `any_of` for readability in YAML (IN operator).
	 */
	in?: Record<string, unknown[]>;
	/**
	 * All tags listed must be present in payload `tags: string[]`.
	 */
	has_tag?: string[];

	// Logical composition
	/** All nested matchers must match in addition to this node */
	and?: AudioCaseMatcher[];
	/** Any nested matcher may match (OR) in addition to this node */
	or?: AudioCaseMatcher[];
	/** Nested matcher must NOT match. */
	not?: AudioCaseMatcher;
}

export interface AudioAction {
	kind: 'action';
	audio_id: AudioId;
	modulation_preset?: asset_id;
	priority?: number;
	cooldown_ms?: number;
}

export interface AudioActionWeighted extends AudioAction {
	/** Relative probability when using weighted selection */
	weight?: number;
}

export type AudioActionPickStrategy = 'uniform' | 'weighted';
/**
 * Randomized action spec: choose one action from a list.
 * - If any item specifies a `weight` or `pick: 'weighted'`, weighted selection is used.
 * - `avoid_repeat`: prevent immediate repeat of the last choice for this rule.
 */

export interface AudioActionOneOfSpec {
	kind: 'oneof';
	one_of: (AudioActionWeighted | AudioId)[];
	pick?: AudioActionPickStrategy;
	avoid_repeat?: boolean;
}

export type AudioStingerSpec = {
	kind: 'stinger';
	stinger: AudioId;
	return_to?: AudioId;
	return_to_previous?: boolean;
};

export type AudioDelaySpec = {
	kind: 'delay';
	delay_ms: number;
};

export type AudioSyncMode = 'immediate' | 'loop' | AudioDelaySpec | AudioStingerSpec;
// Music transition (engine-level) — no BPM required

export interface MusicTransitionSpec {
	kind: 'musictransition';
	music_transition: {
		audio_id: AudioId;
		/**
		 * How to schedule the transition:
		 * - 'immediate': switch now
		 * - 'loop': switch at next loop boundary of current track (uses audiometa.loop)
		 * - { delay_ms }: switch after delay
		 * - { stinger, return_to?: AudioId, return_to_previous?: boolean }: play stinger immediately, then switch to either a specific id (return_to) or the previously playing music (return_to_previous). Specify at most one of these follow-up targets.
		 */
		sync?: AudioSyncMode;
		/**
		 * Pure fade-out of current music, then start next track (no overlap).
		 */
		fade_ms?: number;
		/**
		 * Crossfade duration (overlap old/new tracks). Mutually exclusive with fade_ms.
		 */
		crossfade_ms?: number;
		/** If true and target has a loop point, start at its loopStart (skip intro) */
		start_at_loop_start?: boolean;
		/** If true, start target at t=0 (fresh) instead of resuming an offset */
		start_fresh?: boolean;
	}
}

export type AudioActionSpec = AudioAction | AudioActionOneOfSpec | MusicTransitionSpec;

export interface AudioEventRule {
	kind: 'rule';
	when?: AudioCaseMatcher;
	go: AudioActionSpec;
}

export type AudioPlaybackMode = 'replace' | 'ignore' | 'queue' | 'stop' | 'pause';

export interface AudioEventMapEntry {
	name: string;
	channel?: AudioType;
	max_voices?: number;
	policy?: AudioPlaybackMode;
	rules: AudioEventRule[];
}

export interface AudioHandleContext {
	name: string;
	payload: AudioEventPayload;
	emitter: Identifier;
	play: (audio_id: asset_id, ctx?: Partial<AudioHandleContext>, opts?: { priority?: number }) => void;
}

export type AudioHandler = (ctx: AudioHandleContext) => boolean;

export type AudioEventQueueItem = {
	name: string;
	audio_id: asset_id;
	modulation_preset?: asset_id;
	modulation_params?: RandomModulationParams | ModulationParams;
	priority?: number;
	cooldown_ms?: number;
	enqueued_at?: number;
	payload_actor_id?: Identifier
};

export type AudioEventQueue = AudioEventQueueItem[];
export type AudioEventQueuePartialForDeserialization = Partial<AudioEventQueueItem>[];

type CompiledAudioEventRule = AudioEventRule & { __predicate: (payload: AudioEventPayload) => boolean };
type CompiledAudioEventEntry = Omit<AudioEventMapEntry, 'rules'> & { rules: CompiledAudioEventRule[] };

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
// 		const now = $.platform.clock.now();
// 		const arr = (buckets.get(key) ?? []).filter(t => now - t < windowMs);
// 		arr.push(now); buckets.set(key, arr);

// 		if (arr.length >= needed) {
// 			play('VO_Barret_EnoughBarriers', { payload: { modulation_preset: 'vo' } });
// 		}
// 		buckets.set(key, []); // reset cooldown
// 		return true; // consume so data rules don't also fire
// 	}
// }

export class AudioEventManager implements RegisterablePersistent {
	/**
	 * The singleton instance of the AudioManager class.
	 */
	public static readonly instance: AudioEventManager = new AudioEventManager();

	public get registrypersistent(): true {
		return true;
	}

	public get id(): 'aem' {
		return 'aem';
	}

	private handlers: AudioHandler[] = [];

	constructor() {
		Registry.instance.register(this);
	}

	public setRandomGenerator(rand: () => number): void {
		this.rand = rand || Math.random;
	}

	private merged: Map<string, CompiledAudioEventEntry> = new Map();
	private lastPlayedAt = new Map<string, number>();
	private lastRandomPickByRule = new Map<string, number>();
	private anyListener?: EventHandler;
	private endUnsubByType: Partial<Record<AudioType, () => void>> = {};
	private queuesByType: Record<AudioType, AudioEventQueue> = { sfx: [], music: [], ui: [] };
	private resumeOnNextEndByType: Record<AudioType, boolean> = { sfx: false, music: false, ui: false };
	private rand: () => number = Math.random;
	private weightedScratch: number[] = [];

	init(map: id2audioevent, handlers?: AudioHandler[]): void {
		this.dispose();
		this.handlers = handlers ?? [];
		this.merged = this.mergeEvents(map);
		this.anyListener = (event: GameEvent) => {
			const emitter = event.emitter;
			if (!emitter) return false;
			switch (emitter.id) {
				case 'view':
				case 'amg':
					// Ignore events from these emitters
					return false;
			}
			return this.onEvent(event.type, event as AudioEventPayload, emitter);
		};
		// Wiring subscription is performed via bind(bus) to centralize lifecycle

		// subscribe to voice end events for sfx and ui to manage queue/pause
		this.endUnsubByType['sfx'] = $.sndmaster.addEndedListener('sfx', _info => this.onChannelEnded('sfx'));
		this.endUnsubByType['ui'] = $.sndmaster.addEndedListener('ui', _info => this.onChannelEnded('ui'));

		this.bind();

		// Debug: list registered audio events and handlers
		// try {
		// 	const eventsSummary = Array.from(this.merged.entries()).map(([key, v]) => {
		// 		const rlen = (v.rules?.length) ?? 0;
		// 		const ch = v.channel ? `, ${v.channel}` : '';
		// 		const pol = v.policy ? `, ${v.policy}` : '';
		// 		const rules = v.rules?.map(r => {
		// 			const when = r.when ? `when: ${JSON.stringify(r.when)}` : '';
		// 			const doAction = r.do ? `do: ${JSON.stringify(r.do)}` : '';
		// 			return `{ ${when}, ${doAction} }\n`;
		// 		}).join(', ');
		// 		return `${key} (${rlen} rules${ch}${pol}:\n${rules})`;
		// 	});
		// 	console.info('[AudioEventManager] events:', eventsSummary.length, eventsSummary);
		// 	const handlerNames = this.handlers.map(h => h.name);
		// 	console.info('[AudioEventManager] handlers:', handlerNames.length, handlerNames);
		// } catch { }
	}

	// Direct play entrypoint so game code can route through AEM (policies/awareness)
	public playDirect(id: asset_id, options?: RandomModulationParams | ModulationParams | string | SoundMasterPlayRequest): void {
		const request = this.toPlayRequest(options);
		void $.sndmaster.play(id, request);
	}

	private toPlayRequest(options?: RandomModulationParams | ModulationParams | string | SoundMasterPlayRequest): SoundMasterPlayRequest {
		if (!options) return {};
		if (typeof options === 'string') {
			return { modulation_preset: options };
		}
		if (typeof options === 'object') {
			const maybe = options as SoundMasterPlayRequest;
			if ('params' in maybe || 'modulation_preset' in maybe || 'priority' in maybe) {
				return maybe;
			}
		}
		return { params: options as (RandomModulationParams | ModulationParams) };
	}

	public getQueues(): { sfx: AudioEventQueue; ui: AudioEventQueue } {
		return {
			sfx: this.queuesByType.sfx.map(q => ({ name: q.name, audio_id: q.audio_id, modulation_preset: q.modulation_preset, modulation_params: q.modulation_params, priority: q.priority, cooldown_ms: q.cooldown_ms, payload_actor_id: q.payload_actor_id })),
			ui: this.queuesByType.ui.map(q => ({ name: q.name, audio_id: q.audio_id, modulation_preset: q.modulation_preset, modulation_params: q.modulation_params, priority: q.priority, cooldown_ms: q.cooldown_ms, payload_actor_id: q.payload_actor_id })),
		};
	}

	public resetPlaybackState(): void {
		this.queuesByType = { sfx: [], music: [], ui: [] };
		this.resumeOnNextEndByType = { sfx: false, music: false, ui: false };
	}

	public restoreQueues(qs: { sfx: AudioEventQueuePartialForDeserialization; ui: AudioEventQueuePartialForDeserialization }): void {
		const now = this.nowMs();
		this.queuesByType.sfx = (qs.sfx || []).map(it => ({ name: it.name ?? 'restored.sfx', audio_id: it.audio_id, modulation_preset: it.modulation_preset, modulation_params: it.modulation_params, priority: it.priority, cooldown_ms: it.cooldown_ms, payload_actor_id: it.payload_actor_id, enqueued_at: now }));
		this.queuesByType.ui = (qs.ui || []).map(it => ({ name: it.name ?? 'restored.ui', audio_id: it.audio_id, modulation_preset: it.modulation_preset, modulation_params: it.modulation_params, priority: it.priority, cooldown_ms: it.cooldown_ms, payload_actor_id: it.payload_actor_id, enqueued_at: now }));
	}

	addHandler(handler: AudioHandler): void {
		this.handlers.push(handler);
	}

	removeHandler(handler: AudioHandler): void {
		this.handlers = this.handlers.filter(h => h !== handler);
	}

	dispose(): void {
		EventEmitter.instance.offAny(this.anyListener, true);
		this.handlers = [];
		if (this.endUnsubByType['sfx']) this.endUnsubByType['sfx']();
		if (this.endUnsubByType['ui']) this.endUnsubByType['ui']();
	}

	/** Wire global audio event listener. */
	public bind(): void {
		EventEmitter.instance.onAny(this.anyListener, true);
	}
	/** Unwire global audio event listener. */
	public unbind(): void {
		EventEmitter.instance.offAny(this.anyListener, true);
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

		// First, check for music transitions in matching rules
		for (let i = 0; i < entry.rules.length; i++) {
			const r = entry.rules[i];
			if (!this.ruleMatches(r, payload)) continue;
			const d = r.go;
			const transition = (d as MusicTransitionSpec).music_transition;
			if (transition) {
				if (transition.fade_ms !== undefined && transition.crossfade_ms !== undefined) {
					throw new Error('[AudioEventManager] music_transition cannot specify both fade_ms and crossfade_ms.');
				}
				$.sndmaster.requestMusicTransition({
					to: transition.audio_id,
					sync: transition.sync,
					fade_ms: transition.fade_ms,
					crossfade_ms: transition.crossfade_ms,
					start_at_loop_start: transition.start_at_loop_start,
					start_fresh: transition.start_fresh,
				});
				return true;
			}
		}

		const action = this.pickAction(name, entry.rules, payload);
		if (!action) return false;

		// voice policy / priority handling per channel
		const channel = entry.channel ?? 'sfx';
		const runtime = Runtime.instance;
		const assetEntry = runtime.getAssetEntry(action.audio_id);
		if (assetEntry.type !== 'audio') {
			throw new Error(`[AudioEventManager] Asset '${action.audio_id}' is not audio.`);
		}
		const audioMeta = runtime.getAudioMeta(action.audio_id);
		const fallbackPriority = audioMeta.priority;
		const pr = action.priority ?? fallbackPriority;
		const max_voices = entry.max_voices ?? 1;
		const active = $.sndmaster.activeCountByType(channel);
		const policy = entry.policy ?? 'replace';

		// stop
		switch (policy) {
			case 'stop':
				$.sndmaster.stop(channel, 'all');
				this.queuesByType[channel] = [];
				return true;
		}

		if (active >= max_voices) {
			switch (policy) {
				case 'ignore':
					return true;
				case 'replace': {
					const infos: ActiveVoiceInfo[] = $.sndmaster.getActiveVoiceInfosByType(channel);
					if (infos.length === 0) {
						throw new Error(`[AudioEventManager] No active voices returned for channel '${channel}' despite active count.`);
					}
					let minIdx = 0;
					let minPr = infos[0].priority;
					let oldestStart = infos[0].startedAt;
					for (let i = 1; i < infos.length; i++) {
						const inf = infos[i];
						if (inf.priority < minPr || (inf.priority === minPr && inf.startedAt < oldestStart)) {
							minPr = inf.priority;
							minIdx = i;
							oldestStart = inf.startedAt;
						}
					}
					if (pr < minPr) return true; // lower priority: drop
					const victim = infos[minIdx];
					if (victim) $.sndmaster.stop(channel, 'byvoice', victim.voiceId);
					break;
				}
				case 'pause': {
					// Pause existing voices; new voice will play; resume when it ends
					$.sndmaster.pause(channel);
					this.resumeOnNextEndByType[channel] = true;
					break;
				}
				case 'queue': {
					this.enqueue(channel, { name, audio_id: action.audio_id, modulation_preset: action.modulation_preset, priority: pr, cooldown_ms: action.cooldown_ms, payload_actor_id: payload.actorId });
					return true;
				}
			}
		}

		// set cooldown stamp only when actually playing now (not when queuing)
		if (action.cooldown_ms) {
			const actorKey = payload.actorId ?? 'global';
			const key = `${name}:${actorKey}:${action.audio_id}`;
			const now = this.nowMs();
			const last = this.lastPlayedAt.get(key) || 0;
			if ((now - last) < action.cooldown_ms) return true;
			this.lastPlayedAt.set(key, now);
		}

		this.play(action.audio_id, { payload: { modulation_preset: action.modulation_preset } }, { priority: pr });

		return true;
	}

	private enqueue(type: AudioType, item: AudioEventQueueItem): void {
		const q = this.queuesByType[type];
		q.push({ ...item, enqueued_at: this.nowMs() });
	}

	private onChannelEnded(type: AudioType): void {
		// Resume paused voices if requested
		if (this.resumeOnNextEndByType[type]) {
			this.resumeOnNextEndByType[type] = false;
			const snaps = $.sndmaster.drainPausedSnapshots(type);
			for (const s of snaps) {
				const resumeParams: ModulationParams = { ...s.params, offset: s.offset };
				void $.sndmaster.play(s.id, { params: resumeParams, priority: s.priority });
			}
			return; // Give priority to resuming before dequeuing
		}

		// Dequeue next if capacity available
		const q = this.queuesByType[type];
		if (q.length === 0) return;
		const now = this.nowMs();
		while (q.length > 0) {
			const peek = q[0];
			if (!peek) break;
			const entry = this.merged.get(peek.name);
			if (!entry) {
				throw new Error(`[AudioEventManager] Queued audio event '${peek.name}' no longer exists.`);
			}
			const maxVoicesForItem = entry.max_voices ?? 1;
			if ($.sndmaster.activeCountByType(type) >= maxVoicesForItem) return;
			const item = q.shift();
			if (!item) break;
			const actorKey = item.payload_actor_id ?? 'global';
			const key = `${item.name}:${actorKey}:${item.audio_id}`;
			const last = this.lastPlayedAt.get(key) || 0;
			const cooldown_ms = item.cooldown_ms ?? 0;
			if (cooldown_ms > 0 && (now - last) < cooldown_ms) {
				continue;
			}
			if (cooldown_ms > 0) this.lastPlayedAt.set(key, now);
			const req: SoundMasterPlayRequest = item.modulation_params
				? { params: item.modulation_params, priority: item.priority }
				: { modulation_preset: item.modulation_preset, priority: item.priority };
			void $.sndmaster.play(item.audio_id, req);
		}
	}

	private play(audio_id: asset_id, ctx?: Partial<AudioHandleContext>, opts?: { priority?: number }): void {
		const presetKey = ctx?.payload?.modulation_preset;
		const params = ctx?.payload?.modulation_params as (RandomModulationParams | ModulationParams);
		const request: SoundMasterPlayRequest = {};
		if (opts?.priority !== undefined) {
			request.priority = opts.priority;
		}
		if (params) {
			request.params = params;
		} else if (presetKey !== undefined) {
			request.modulation_preset = presetKey;
		}
		void $.sndmaster.play(audio_id, request);
	}

	private nowMs(): number {
		const audioTime = $.sndmaster.getCurrentTimeSec();
		if (!Number.isNaN(audioTime)) return audioTime * 1000;
		return $.platform.clock.now();
	}

	private pickAction(eventName: string, rules: CompiledAudioEventRule[], payload: AudioEventPayload): AudioAction {
		for (let i = 0; i < rules.length; i++) {
			const r = rules[i];
			if (!this.ruleMatches(r, payload)) continue;
			const resolved = this.resolveActionSpec(eventName, i, r.go, payload);
			if (resolved) return resolved;
		}
		return undefined;
	}

	private ruleMatches(rule: CompiledAudioEventRule, payload: AudioEventPayload): boolean {
		if (!rule.__predicate) {
			rule.__predicate = this.compileMatcher(rule.when);
		}
		return rule.__predicate(payload);
	}

	private isOneOfSpec(spec: AudioActionSpec): spec is AudioActionOneOfSpec {
		return Array.isArray((spec as AudioActionOneOfSpec).one_of);
	}

	private resolveActionSpec(eventName: string, ruleIndex: number, spec: AudioActionSpec, payload: AudioEventPayload): AudioAction {
		if (!this.isOneOfSpec(spec)) {
			return spec as AudioAction;
		}

		const items = spec.one_of;
		if (items.length === 0) return undefined;

		// Build parallel arrays of actions and weights based on the original items
		const actions: AudioAction[] = [];
		const weights: number[] = [];
		for (const it of items) {
			if (typeof it === 'string' || typeof it === 'number') {
				actions.push({ kind: 'action', audio_id: it });
				weights.push(1);
			} else {
				actions.push({ kind: 'action', audio_id: it.audio_id, modulation_preset: it.modulation_preset, priority: it.priority, cooldown_ms: it.cooldown_ms });
				const w = (it as { weight?: number }).weight;
				weights.push(w != null ? Math.max(0, Number(w)) : 1);
			}
		}

		const hasWeights = weights.some(w => w !== 1);
		const pickMode = spec.pick ?? (hasWeights ? 'weighted' : 'uniform');

		const actorKey = payload.actorId ?? 'global';
		const ruleKey = `${eventName}#${ruleIndex}#${actorKey}`;
		const lastIdx = this.lastRandomPickByRule.get(ruleKey);

		let idx = 0;
		if (pickMode === 'weighted') {
			const total = weights.reduce((a, b) => a + b, 0);
			if (total <= 0) {
				idx = this.pickUniformIndex(actions.length, spec.avoid_repeat ? lastIdx : undefined);
			} else {
				idx = this.pickWeightedIndex(weights, spec.avoid_repeat ? lastIdx : undefined);
			}
		} else {
			idx = this.pickUniformIndex(actions.length, spec.avoid_repeat ? lastIdx : undefined);
		}

		this.lastRandomPickByRule.set(ruleKey, idx);
		return actions[idx];
	}

	private compileRules(rules?: AudioEventRule[]): CompiledAudioEventRule[] {
		if (!rules || rules.length === 0) return [];
		return rules.map(rule => ({ ...rule, __predicate: this.compileMatcher(rule.when) }));
	}

	private compileMatcher(m?: AudioCaseMatcher): (payload: AudioEventPayload) => boolean {
		if (!m) return () => true;
		const equalsEntries = m.equals ? Object.entries(m.equals) : undefined;
		const anyOfEntries: Array<[string, unknown[]]> = [];
		if (m.any_of) {
			for (const key of Object.keys(m.any_of)) {
				anyOfEntries.push([key, m.any_of[key]]);
			}
		}
		if (m.in) {
			for (const key of Object.keys(m.in)) {
				anyOfEntries.push([key, m.in[key]]);
			}
		}
		const requiredTags = m.has_tag ? [...m.has_tag] : undefined;
		const andPredicates = m.and ? m.and.map(sub => this.compileMatcher(sub)) : undefined;
		const orPredicates = m.or ? m.or.map(sub => this.compileMatcher(sub)) : undefined;
		const notPredicate = m.not ? this.compileMatcher(m.not) : undefined;

		return (payload: AudioEventPayload) => {
			const rec = payload as Record<string, unknown>;
			if (equalsEntries) {
				for (const [key, value] of equalsEntries) {
					if (rec[key] !== value) return false;
				}
			}
			if (anyOfEntries.length > 0) {
				for (const [key, list] of anyOfEntries) {
					if (!Array.isArray(list)) return false;
					const val = rec[key];
					if (Array.isArray(val)) {
						if (!val.some(item => list.includes(item))) return false;
					} else if (!list.includes(val)) {
						return false;
					}
				}
			}
			if (requiredTags && requiredTags.length > 0) {
				const tagsVal = rec['tags'];
				if (!Array.isArray(tagsVal)) return false;
				for (const tag of requiredTags) if (!tagsVal.includes(tag)) return false;
			}
			if (andPredicates) {
				for (const predicate of andPredicates) if (!predicate(payload)) return false;
			}
			if (notPredicate && notPredicate(payload)) return false;
			if (orPredicates && orPredicates.length > 0) {
				let any = false;
				for (const predicate of orPredicates) {
					if (predicate(payload)) { any = true; break; }
				}
				if (!any) return false;
			}
			return true;
		};
	}

	private pickUniformIndex(n: number, avoidIndex?: number): number {
		if (n <= 1) return 0;
		let idx = Math.floor(this.rand() * n);
		if (avoidIndex != null && n > 1 && idx === avoidIndex) {
			// pick a different index
			idx = (idx + 1 + Math.floor(this.rand() * (n - 1))) % n;
		}
		return idx;
	}

	private pickWeightedIndex(weights: number[], avoidIndex?: number): number {
		const n = weights.length;
		if (n <= 1) return 0;
		// If avoiding immediate repeat, temporarily zero out the avoided index
		let total = 0;
		const ws = this.weightedScratch;
		if (ws.length < n) ws.length = n;
		for (let i = 0; i < n; i++) {
			const w = Math.max(0, weights[i] ?? 0);
			const wAdj = (avoidIndex != null && i === avoidIndex && n > 1) ? 0 : w;
			ws[i] = wAdj;
			total += wAdj;
		}
		if (total <= 0) {
			return this.pickUniformIndex(n, avoidIndex);
		}
		let r = this.rand() * total;
		for (let i = 0; i < n; i++) {
			r -= ws[i];
			if (r <= 0) return i;
		}
		return n - 1;
	}

	private mergeEvents(map: id2audioevent): Map<string, CompiledAudioEventEntry> {
		// Keep merge logic aligned with Lua audio_router.lua.
		const out = new Map<string, CompiledAudioEventEntry>();

		// Helper to add or merge a single event entry by name
		const addOrMerge = (eventName: string, entry: AudioEventMapEntry) => {
			if (!eventName) return; // guard against malformed input
			const cur = out.get(eventName);
			const { rules: entryRules, ...rest } = entry;
			const compiledRules = this.compileRules(entryRules);
			const restEntry = rest as Omit<AudioEventMapEntry, 'rules'>;
			if (!cur) {
				out.set(eventName, { ...restEntry, name: eventName, rules: compiledRules });
			} else {
				// ROM overlay rules prepend; entry props override cur (except rules)
				out.set(eventName, { ...cur, ...restEntry, name: eventName, rules: compiledRules.concat(cur.rules) });
			}
		};

		for (const asset_id in map) {
			const v: any = map[asset_id];
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
				if (key === '$type' || key === 'events' || key === 'name' || key === 'channel' || key === 'max_voices' || key === 'policy' || key === 'rules') continue;
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
		return out;
	}
}
