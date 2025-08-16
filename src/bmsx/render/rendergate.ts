export type GateCategory = 'scene' | 'texture' | 'audio' | 'model' | 'skybox' | 'other';

export interface GateScope {
    blocking?: boolean;     // default: false → non-blocking
    category?: GateCategory;
    tag?: string;           // vrije tag voor debug
}

type Token = { gen: number; id: number; blocking: boolean; category: GateCategory; tag?: string };

export class RenderGate {
    private gen = 0;
    private nextId = 1;
    private blockingPending = 0;
    private countsByCat = new Map<GateCategory, number>();
    private liveTokens = new Map<number, Token>();

    /** Verhoog de generatie (bijv. bij harde scene switch). Hiermee negeer je late resolves. */
    bump(): number {
        this.gen++;
        this.blockingPending = 0;
        this.countsByCat.clear();
        this.liveTokens.clear();
        return this.gen;
    }

    /** Start een scope. Wordt alleen “blocking” als je dat aangeeft. */
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

    /** Einde van scope. */
    end(token?: Token): void {
        if (!token || token.gen !== this.gen) return; // late resolve → negeren
        const existed = this.liveTokens.delete(token.id);
        if (!existed) return;

        const catCount = (this.countsByCat.get(token.category) ?? 1) - 1;
        if (catCount > 0) this.countsByCat.set(token.category, catCount);
        else this.countsByCat.delete(token.category);
        if (token.blocking && this.blockingPending > 0) this.blockingPending--;
    }

    /** Non-blocking ontwerp: renderer checkt dit alleen wanneer jij een blocking scope gebruikt. */
    get ready(): boolean { return this.blockingPending === 0; }

    /** Telemetrie/debug */
    snapshot() {
        return {
            gen: this.gen,
            blockingPending: this.blockingPending,
            countsByCat: Object.fromEntries(this.countsByCat.entries()),
            live: Array.from(this.liveTokens.values()).map(v => ({ id: v.id, cat: v.category, blocking: v.blocking, tag: v.tag }))
        };
    }
}

export const GlobalRenderGate = new RenderGate();
