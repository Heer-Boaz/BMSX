export type GateCategory = string;

export interface GateScope {
    blocking?: boolean;          // telt mee voor ready() in de groep
    category?: GateCategory;     // 'texture' | 'audio' | 'model' | ...
    tag?: string;                // debug label
}

/**
 * Represents a unique token for a specific scope within a gate.
 * This token is used to track the state of the scope and its relationship
 * with the gate's lifecycle.
 */
type Token = { gen: number; id: number; blocking: boolean; category: GateCategory; tag?: string };

type Bucket = {
    gen: number;
    nextId: number;
    blockingPending: number;
    countsByCat: Map<GateCategory, number>;
    live: Map<number, Token>;
};

export class TaskGate {
    private buckets = new Map<string, Bucket>();

    /** Maak of haal een bucket (groep/handle). */
    group(name: string): GateGroup {
        if (!this.buckets.has(name)) {
            this.buckets.set(name, { gen: 0, nextId: 1, blockingPending: 0, countsByCat: new Map(), live: new Map() });
        }
        return new GateGroup(name, this);
    }

    /** (optioneel) globale snapshot over alle groepen. */
    snapshotAll() {
        const out: Record<string, ReturnType<GateGroup["snapshot"]>> = {};
        for (const [k, _] of this.buckets) out[k] = this.group(k).snapshot();
        return out;
    }

    // --- interne helpers voor GateGroup ---
    _bucket(name: string): Bucket {
        const b = this.buckets.get(name);
        if (!b) throw new Error(`TaskGate bucket "${name}" not found`);
        return b;
    }
}

export class GateGroup {
    constructor(private name: string, private gate: TaskGate) { }

    /** Reset this group; invalidate late resolves. */
    bump(): number {
        const b = this.gate._bucket(this.name);
        b.gen++; b.blockingPending = 0; b.countsByCat.clear(); b.live.clear();
        return b.gen;
    }

    /** Start scope in this group. */
    begin(scope: GateScope = {}): Token {
        const b = this.gate._bucket(this.name);
        const t: Token = {
            gen: b.gen,
            id: b.nextId++,
            blocking: !!scope.blocking,
            category: scope.category ?? "other",
            tag: scope.tag,
        };
        b.live.set(t.id, t);
        b.countsByCat.set(t.category, (b.countsByCat.get(t.category) ?? 0) + 1);
        if (t.blocking) b.blockingPending++;
        return t;
    }

    /** End of scope. Late/other gen → ignored. */
    end(token: Token): void {
        if (!token) console.error('[GateGroup] GateGroup.end() called without token');
        const b = this.gate._bucket(this.name);
        if (token.gen !== b.gen) return; // Late/other gen → ignored
        if (!b.live.delete(token.id)) return; // Unknown token or token already deleted → ignored

        const n = (b.countsByCat.get(token.category) ?? 1) - 1;
        if (n > 0) b.countsByCat.set(token.category, n); else b.countsByCat.delete(token.category);
        if (token.blocking && b.blockingPending > 0) b.blockingPending--;
    }

    public endCategory(category: GateCategory): void {
        const b = this.gate._bucket(this.name);
        for (const token of b.live.values()) {
            if (token.category === category) this.end(token);
        }
    }

    /** Is this group ready with respect to blocking scopes? */
    get ready(): boolean { return this.gate._bucket(this.name).blockingPending === 0; }

    get liveCount(): number { return this.gate._bucket(this.name).live.size; }

    /** Is this group ready for a specific category? */
    readyFor(category: GateCategory): boolean {
        const b = this.gate._bucket(this.name);
        return (b.countsByCat.get(category) ?? 0) === 0;
    }

    /** Telemetry. */
    snapshot() {
        const b = this.gate._bucket(this.name);
        return {
            gen: b.gen,
            blockingPending: b.blockingPending,
            countsByCat: Object.fromEntries(b.countsByCat.entries()),
            live: Array.from(b.live.values()).map(v => ({ id: v.id, cat: v.category, blocking: v.blocking, tag: v.tag })),
        };
    }

    /** Convenience: track a Promise as scope (auto begin/end). */
    async track<T>(p: Promise<T>, scope: GateScope): Promise<T> {
        const token = this.begin(scope);
        return p.finally(() => this.end(token));
    }
}

// Eén globale poortwachter; je maakt groepen per operatie/subsysteem.
export const taskGate = new TaskGate();
