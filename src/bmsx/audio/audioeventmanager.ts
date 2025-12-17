import { EventEmitter, EventHandler } from '../core/eventemitter';
import type { GameEvent } from '../core/game_event';
import { $ } from '../core/game';
import { Registry } from '../core/registry';
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
	modulationPreset?: asset_id;
	modulationParams?: RandomModulationParams | ModulationParams;
	[k: string]: unknown;
}

export interface AudioCaseMatcher {
	// Basic comparisons
	equals?: Record<string, unknown>;
	/**
	 * Value must be in provided list per key. Alias: `in`.
	 */
	anyOf?: Record<string, unknown[]>;
	/**
	 * Synonym for `anyOf` for readability in YAML (IN operator).
	 */
	in?: Record<string, unknown[]>;
	/**
	 * All tags listed must be present in payload `tags: string[]`.
	 */
	hasTag?: string[];

	// Logical composition
	/** All nested matchers must match in addition to this node */
	and?: AudioCaseMatcher[];
	/** Any nested matcher may match (OR) in addition to this node */
	or?: AudioCaseMatcher[];
	/** Nested matcher must NOT match. */
	not?: AudioCaseMatcher;
}

export interface AudioAction {
	audioId: AudioId;
	modulationPreset?: asset_id;
	priority?: number;
	cooldownMs?: number;
}

export interface AudioActionWeighted extends AudioAction {
	/** Relative probability when using weighted selection */
	weight?: number;
}

export type AudioActionPickStrategy = 'uniform' | 'weighted';
/**
 * Randomized action spec: choose one action from a list.
 * - If any item specifies a `weight` or `pick: 'weighted'`, weighted selection is used.
 * - `avoidRepeat`: prevent immediate repeat of the last choice for this rule.
 */

export interface AudioActionOneOfSpec {
	oneOf: (AudioActionWeighted | AudioId)[];
	pick?: AudioActionPickStrategy;
	avoidRepeat?: boolean;
}

export type AudioStingerSpec = { stinger: AudioId; returnTo?: AudioId; returnToPrevious?: boolean; };
export type AudioDelaySpec = { delayMs: number; };
export type AudioSyncMode = 'immediate' | 'loop' | AudioDelaySpec | AudioStingerSpec;
// Music transition (engine-level) — no BPM required

export interface MusicTransitionSpec {
	musicTransition: {
		audioId: AudioId;
		/**
			 * How to schedule the transition:
			 * - 'immediate': switch now
			 * - 'loop': switch at next loop boundary of current track (uses audiometa.loop)
			 * - { delayMs }: switch after delay
		 * - { stinger, returnTo?: AudioId, returnToPrevious?: boolean }: play stinger immediately, then switch to either a specific id (returnTo) or the previously playing music (returnToPrevious). Specify at most one of these follow-up targets.
			 */
			sync?: AudioSyncMode;
			fadeMs?: number;
			/** If true and target has a loop point, start at its loopStart (skip intro) */
			startAtLoopStart?: boolean;
		/** If true, start target at t=0 (fresh) instead of resuming an offset */
		startFresh?: boolean;
	};
}

export type AudioActionSpec = AudioAction | AudioActionOneOfSpec | MusicTransitionSpec;

export interface AudioEventRule {
	when?: AudioCaseMatcher;
	go: AudioActionSpec;
}

export type AudioPlaybackMode = 'replace' | 'ignore' | 'queue' | 'stop' | 'pause';

export interface AudioEventMapEntry {
	name: string;
	channel?: AudioType;
	maxVoices?: number;
	policy?: AudioPlaybackMode;
	rules: AudioEventRule[];
}

export interface AudioHandleContext {
	name: string;
	payload: AudioEventPayload;
	emitter: Identifier;
	play: (audioId: asset_id, ctx?: Partial<AudioHandleContext>, opts?: { priority?: number }) => void;
}

export type AudioHandler = (ctx: AudioHandleContext) => boolean;

export type AudioEventQueueItem = { name: string; audioId: asset_id; modulationPreset?: asset_id; modulationParams?: RandomModulationParams | ModulationParams; priority?: number; cooldownMs?: number; enqueuedAt?: number; payloadActorId?: Identifier };
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
// 			play('VO_Barret_EnoughBarriers', { payload: { modulationPreset: 'vo' } });
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
			return { modulationPreset: options };
		}
		if (typeof options === 'object') {
			const maybe = options as SoundMasterPlayRequest;
			if ('params' in maybe || 'modulationPreset' in maybe || 'priority' in maybe) {
				return maybe;
			}
		}
		return { params: options as (RandomModulationParams | ModulationParams) };
	}

	public getQueues(): { sfx: AudioEventQueue; ui: AudioEventQueue } {
		return {
			sfx: this.queuesByType.sfx.map(q => ({ name: q.name, audioId: q.audioId, modulationPreset: q.modulationPreset, modulationParams: q.modulationParams, priority: q.priority, cooldownMs: q.cooldownMs, payloadActorId: q.payloadActorId })),
			ui: this.queuesByType.ui.map(q => ({ name: q.name, audioId: q.audioId, modulationPreset: q.modulationPreset, modulationParams: q.modulationParams, priority: q.priority, cooldownMs: q.cooldownMs, payloadActorId: q.payloadActorId })),
		};
	}

	public resetPlaybackState(): void {
		this.queuesByType = { sfx: [], music: [], ui: [] };
		this.resumeOnNextEndByType = { sfx: false, music: false, ui: false };
	}

	public restoreQueues(qs: { sfx: AudioEventQueuePartialForDeserialization; ui: AudioEventQueuePartialForDeserialization }): void {
		const now = this.nowMs();
		this.queuesByType.sfx = (qs.sfx || []).map(it => ({ name: it.name ?? 'restored.sfx', audioId: it.audioId, modulationPreset: it.modulationPreset, modulationParams: it.modulationParams, priority: it.priority, cooldownMs: it.cooldownMs, payloadActorId: it.payloadActorId, enqueuedAt: now }));
		this.queuesByType.ui = (qs.ui || []).map(it => ({ name: it.name ?? 'restored.ui', audioId: it.audioId, modulationPreset: it.modulationPreset, modulationParams: it.modulationParams, priority: it.priority, cooldownMs: it.cooldownMs, payloadActorId: it.payloadActorId, enqueuedAt: now }));
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
			if (d && typeof d === 'object' && 'musicTransition' in d && d.musicTransition) {
				const mt = d.musicTransition;
				$.sndmaster.requestMusicTransition({
					to: mt.audioId,
					sync: mt.sync,
					fadeMs: mt.fadeMs,
					startAtLoopStart: mt.startAtLoopStart,
					startFresh: mt.startFresh,
				});
				return true;
			}
		}

		const action = this.pickAction(name, entry.rules, payload);
		if (!action) return false;

		// voice policy / priority handling per channel
		const channel = entry.channel ?? 'sfx';
		const audioAsset = $.rompack.audio[action.audioId];
		if (!audioAsset) {
			throw new Error(`[AudioEventManager] Audio asset '${action.audioId}' not found.`);
		}
		const fallbackPriority = audioAsset.audiometa ? audioAsset.audiometa.priority : 0;
		const pr = action.priority ?? fallbackPriority;
		const maxVoices = entry.maxVoices ?? 1;
		const active = $.sndmaster.activeCountByType(channel);
		const policy = entry.policy ?? 'replace';

		// stop
		switch (policy) {
			case 'stop':
				$.sndmaster.stop(channel, 'all');
				this.queuesByType[channel] = [];
				return true;
		}

		if (active >= maxVoices) {
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
					this.enqueue(channel, { name, audioId: action.audioId, modulationPreset: action.modulationPreset, priority: pr, cooldownMs: action.cooldownMs, payloadActorId: payload.actorId });
					return true;
				}
			}
		}

		// set cooldown stamp only when actually playing now (not when queuing)
		if (action.cooldownMs) {
			const actorKey = payload.actorId ?? 'global';
			const key = `${name}:${actorKey}:${action.audioId}`;
			const now = this.nowMs();
			const last = this.lastPlayedAt.get(key) || 0;
			if ((now - last) < action.cooldownMs) return true;
			this.lastPlayedAt.set(key, now);
		}

		this.play(action.audioId, { payload: { modulationPreset: action.modulationPreset } }, { priority: pr });

		return true;
	}

	private enqueue(type: AudioType, item: AudioEventQueueItem): void {
		const q = this.queuesByType[type];
		q.push({ ...item, enqueuedAt: this.nowMs() });
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
			const maxVoicesForItem = entry.maxVoices ?? 1;
			if ($.sndmaster.activeCountByType(type) >= maxVoicesForItem) return;
			const item = q.shift();
			if (!item) break;
			const actorKey = item.payloadActorId ?? 'global';
			const key = `${item.name}:${actorKey}:${item.audioId}`;
			const last = this.lastPlayedAt.get(key) || 0;
			const cooldownMs = item.cooldownMs ?? 0;
			if (cooldownMs > 0 && (now - last) < cooldownMs) {
				continue;
			}
			if (cooldownMs > 0) this.lastPlayedAt.set(key, now);
			const req: SoundMasterPlayRequest = item.modulationParams
				? { params: item.modulationParams, priority: item.priority }
				: { modulationPreset: item.modulationPreset, priority: item.priority };
			void $.sndmaster.play(item.audioId, req);
		}
	}

	private play(audioId: asset_id, ctx?: Partial<AudioHandleContext>, opts?: { priority?: number }): void {
		const presetKey = ctx?.payload?.modulationPreset;
		const params = ctx?.payload?.modulationParams as (RandomModulationParams | ModulationParams);
		const request: SoundMasterPlayRequest = {};
		if (opts?.priority !== undefined) {
			request.priority = opts.priority;
		}
		if (params) {
			request.params = params;
		} else if (presetKey !== undefined) {
			request.modulationPreset = presetKey;
		}
		void $.sndmaster.play(audioId, request);
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
		const maybe = spec as unknown;
		return typeof maybe === 'object' && maybe !== null && 'oneOf' in (maybe as Record<string, unknown>) && Array.isArray((maybe as AudioActionOneOfSpec).oneOf);
	}

	private resolveActionSpec(eventName: string, ruleIndex: number, spec: AudioActionSpec, payload: AudioEventPayload): AudioAction {
		if (!this.isOneOfSpec(spec)) {
			return spec as AudioAction;
		}

		const items = spec.oneOf;
		if (items.length === 0) return undefined;

		// Build parallel arrays of actions and weights based on the original items
		const actions: AudioAction[] = [];
		const weights: number[] = [];
		for (const it of items) {
			if (typeof it === 'string' || typeof it === 'number') {
				actions.push({ audioId: it });
				weights.push(1);
			} else {
				actions.push({ audioId: it.audioId, modulationPreset: it.modulationPreset, priority: it.priority, cooldownMs: it.cooldownMs });
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
				idx = this.pickUniformIndex(actions.length, spec.avoidRepeat ? lastIdx : undefined);
			} else {
				idx = this.pickWeightedIndex(weights, spec.avoidRepeat ? lastIdx : undefined);
			}
		} else {
			idx = this.pickUniformIndex(actions.length, spec.avoidRepeat ? lastIdx : undefined);
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
		if (m.anyOf) {
			for (const key of Object.keys(m.anyOf)) {
				anyOfEntries.push([key, m.anyOf[key]]);
			}
		}
		if (m.in) {
			for (const key of Object.keys(m.in)) {
				anyOfEntries.push([key, m.in[key]]);
			}
		}
		const requiredTags = m.hasTag ? [...m.hasTag] : undefined;
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
		return out;
	}
}
