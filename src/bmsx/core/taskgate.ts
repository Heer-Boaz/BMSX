/**
 * Allowed categories for scopes started via TaskGate.begin.
 *
 * Use these to classify tokens for telemetry and debugging.
 */
export type GateCategory = 'scene' | 'texture' | 'audio' | 'model' | 'skybox' | 'fsm' | 'other';

/**
 * Scope descriptor for TaskGate.begin.
 *
 * @property blocking - When true the started scope is considered "blocking" and will
 *   affect the TaskGate.ready state. Default: false.
 * @property category - Optional category for telemetry/debug grouping. Default: "other".
 * @property tag - Optional free-form tag for additional debug information.
 */
export interface GateScope {
    blocking?: boolean; // When true the scope is considered "blocking"
    category?: GateCategory;
    tag?: string; // optional tag for additional debug information
}

/**
 * Internal token returned by TaskGate.begin and consumed by TaskGate.end.
 *
 * @internal
 */
type Token = { gen: number; id: number; blocking: boolean; category: GateCategory; tag?: string };

/**
 * A lightweight gate for tracking asynchronous "scopes" (tokens).
 *
 * Use TaskGate to mark work that begins and ends when asynchronous operations
 * start/finish. Scopes can be marked as "blocking" so callers can test the
 * gate's readiness (via the `ready` getter). The gate also supports simple
 * telemetry by counting live tokens per category.
 *
 * Typical usage:
 * ```ts
 * const token = taskGate.begin({ blocking: true, category: 'scene' });
 * // ... async work ...
 * taskGate.end(token);
 * ```
 */
export class TaskGate {
    /**
     * Generation counter for the gate.
     *
     * Each started token captures the current generation in its `gen` field.
     * When `bump()` is called the generation is incremented, causing late/obsolete
     * tokens (with an older generation) to be ignored by `end()`.
     *
     * Default: 0
     *
     * @internal
     */
    private gen = 0;
    /**
     * Unique ID counter for tokens.
     *
     * Each started token receives a unique ID in its `id` field.
     *
     * Default: 1
     *
     * @internal
     */
    private nextId = 1;
    /**
     * Counter for blocking scopes that are still pending.
     *
     * This is incremented when a blocking scope is started and decremented
     * when it is ended. It is used to determine if the gate is "ready".
     *
     * Default: 0
     *
     * @internal
     */
    private blockingPending = 0;
    /**
     * Map of live token counts by category.
     *
     * This is used to track how many tokens are currently active in each category.
     *
     * @internal
     */
    private countsByCat = new Map<GateCategory, number>();
    /**
     * Map of live tokens by ID.
     *
     * This is used to track all currently active tokens.
     *
     * @internal
     */
    private liveTokens = new Map<number, Token>();

    /**
     * Increase the generation counter for the gate.
     *
     * Each token records the generation at creation time; calling `bump()` advances
     * the generation and causes any tokens from previous generations to be ignored
     * (useful to avoid acting on late/obsolete async completions, e.g. after a
     * hard scene switch). Calling this also clears pending/blocking counters and
     * live token bookkeeping.
     *
     * Returns the new generation number.
     */
    bump(): number {
        this.gen++;
        this.blockingPending = 0;
        this.countsByCat.clear();
        this.liveTokens.clear();
        return this.gen;
    }

    /**
     * Begin a new scope and return a token representing it.
     *
     * The returned Token must be passed to `end()` when the scope finishes.
     * If `scope.blocking` is true the token counts toward gate readiness; `scope.category`
     * can be used for telemetry grouping and `scope.tag` for free-form debugging info.
     */
    begin(scope: GateScope = {}): Token {
        const t: Token = {
            gen: this.gen,
            id: this.nextId++,
            blocking: !!scope.blocking,
            category: scope.category ?? 'other',
            tag: scope.tag
        };
        this.liveTokens.set(t.id, t);

        // tel voor telemetrie
        this.countsByCat.set(t.category, (this.countsByCat.get(t.category) ?? 0) + 1);
        if (t.blocking) this.blockingPending++;
        return t;
    }

    /**
     * End a previously started scope.
     *
     * If `token` is omitted or belongs to an older generation (i.e. `token.gen !== this.gen`)
     * the call is ignored. When a valid token is ended it is removed from live bookkeeping
     * and per-category/ blocking counters are updated.
     */
    end(token?: Token): void {
        if (!token || token.gen !== this.gen) return; // late resolve → negeren
        const existed = this.liveTokens.delete(token.id);
        if (!existed) return;

        const catCount = (this.countsByCat.get(token.category) ?? 1) - 1;
        if (catCount > 0) this.countsByCat.set(token.category, catCount);
        else this.countsByCat.delete(token.category);
        if (token.blocking && this.blockingPending > 0) this.blockingPending--;
    }

    /**
     * True when there are no blocking scopes pending.
     *
     * Consumers that create blocking scopes can check this property to determine whether
     * the gate is currently "ready".
     */
    get ready(): boolean { return this.blockingPending === 0; }

    public isReady(category: GateCategory): boolean {
        // Filter the blocks by this scope only
        let ready = true;
        this.countsByCat.forEach((count, cat) => {
            if (cat === category && count > 0) {
                // If this category is blocked by this scope, it's not ready
                ready = false;
            }
        });
        return ready;
    }

    /**
     * Return a compact snapshot useful for telemetry and debugging.
     *
     * The snapshot includes:
     * - gen: current generation
     * - blockingPending: number of blocking scopes still pending
     * - countsByCat: counts of live tokens per category
     * - live: compact list of live tokens (id, cat, blocking, tag)
     */
    snapshot() {
        return {
            gen: this.gen,
            blockingPending: this.blockingPending,
            countsByCat: Object.fromEntries(this.countsByCat.entries()),
            live: Array.from(this.liveTokens.values()).map(v => ({ id: v.id, cat: v.category, blocking: v.blocking, tag: v.tag }))
        };
    }
}

/**
 * Shared singleton TaskGate instance intended for application-wide use.
 *
 * Import and use this instance to coordinate scopes across modules.
 */
export const taskGate = new TaskGate();
