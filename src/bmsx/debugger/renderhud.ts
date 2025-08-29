import { EventEmitter, subscribesToGlobalEvent } from '../core/eventemitter';
import { $ } from '../core/game';
import { Identifiable } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';

// TODO: FIND A WAY TO NOT INITIALIZE ALL THIS STUFF WHEN THE GAME ROM IS NOT A DEBUG-ROM!
const HUD_ID = 'bmsx-render-hud';

function ensureHudElement(): HTMLElement {
    let el = document.getElementById(HUD_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = HUD_ID;
        el.style.position = 'absolute';
        el.style.left = '8px';
        el.style.top = '8px';
        el.style.padding = '6px 8px';
        el.style.font = '12px/1.2 monospace';
        el.style.background = 'rgba(0,0,0,0.55)';
        el.style.color = '#cce';
        el.style.pointerEvents = 'auto';
        el.style.zIndex = '9001';
        el.style.borderRadius = '4px';
        el.style.maxWidth = '40vw';
        el.style.whiteSpace = 'pre';
        document.body.appendChild(el);
    }
    return el;
}

@excludeclassfromsavegame
export class RenderHUDOverlay implements Identifiable { // Note that it is *not* required to implement Identifiable interface, but it can be useful for certain features later
    public get id(): string { return 'render-hud-overlay'; }
    public enabled = false;
    // sliding window buffers keyed by pass name; also keep a global frame totals window
    private slidingWindowStats: { [key: string]: number[] } = {};
    private frameWindow: number[] = [];
    // Exponential moving average (EMA) mode
    private useEMA = false;
    // EMA smoothing factor (alpha). Will be initialized in constructor.
    private readonly emaAlpha: number;
    private emaFrameAvg: number | null = null;
    private emaPerPass: { [key: string]: number } = {};
    private readonly SUMMARY_FREQUENCY = 500; // 500 frames (is 10 seconds, given the strict 50fps)

    constructor() {
        this.enabled = false;
        this.useEMA = true;
        // derive EMA alpha from SUMMARY_FREQUENCY: alpha = 2 / (N + 1)
        this.emaAlpha = 2 / (this.SUMMARY_FREQUENCY + 1);
        EventEmitter.instance.initClassBoundEventSubscriptions(this);
    }

    @subscribesToGlobalEvent('frameend', true)
    update(): void {
        this.updateNow();
    }
    updateNow(): void {
        if (!this.enabled) return;
        const el = ensureHudElement();
        const gv = $.view;
        const rg = gv.renderGraph;
        if (!rg) { el.textContent = 'Render HUD: no graph'; return; }
        const stats = rg.getPassStats();
        if (!stats || stats.length === 0) { el.textContent = 'Render HUD: no stats'; return; }
        const lines: string[] = [];
        let total = 0;
        for (const s of stats) total += s.ms;
        // Backend draw call counters (if backend exposes them)
        try {
            const b = gv.getBackend?.();
            const fs = b?.getFrameStats?.();
            if (fs) {
                const toKB = (n: number | undefined) => ((n ?? 0) / 1024).toFixed(1);
                lines.push(
                    `draws:${fs.draws} idx:${fs.drawIndexed} inst:${fs.drawsInstanced} idxInst:${fs.drawIndexedInstanced} ` +
                    `upload:${toKB(fs.bytesUploaded)}KB (v:${toKB((fs as any).vertexBytes)}K i:${toKB((fs as any).indexBytes)}K u:${toKB((fs as any).uniformBytes)}K t:${toKB((fs as any).textureBytes)}K)`
                );
            }
        } catch { /* ignore */ }

        // Compute averages depending on mode (EMA or fixed sliding window)
        const modeStr = this.useEMA ? 'EMA' : 'Window';
        if (this.useEMA) {
            // Update EMA for frame average
            if (this.emaFrameAvg === null) this.emaFrameAvg = total;
            else this.emaFrameAvg = this.emaAlpha * total + (1 - this.emaAlpha) * this.emaFrameAvg;
            lines.push(`Frame ${Math.floor(performance.now())} ms=${total.toFixed(2)} avg=${this.emaFrameAvg.toFixed(2)} mode=${modeStr}`);

            // Update per-pass EMAs
            for (const s of stats) {
                const prev = this.emaPerPass[s.name];
                if (prev === undefined) this.emaPerPass[s.name] = s.ms;
                else this.emaPerPass[s.name] = this.emaAlpha * s.ms + (1 - this.emaAlpha) * prev;
                const avg = this.emaPerPass[s.name];
                lines.push(`${s.name.padEnd(18)} ${s.ms.toFixed(3)} ms avg=${avg.toFixed(3)}`);
            }
        } else {
            // Windowed averages
            this.frameWindow.push(total);
            if (this.frameWindow.length > this.SUMMARY_FREQUENCY) this.frameWindow.shift();
            const frameAvg = (this.frameWindow.reduce((a, b) => a + b, 0) / this.frameWindow.length) || 0;
            lines.push(`Frame ${Math.floor(performance.now())} ms=${total.toFixed(2)} avg=${frameAvg.toFixed(2)} mode=${modeStr}`);

            // Update per-pass sliding windows and show per-pass averages
            for (const s of stats) {
                const passWindow = this.slidingWindowStats[s.name] || [];
                passWindow.push(s.ms);
                if (passWindow.length > this.SUMMARY_FREQUENCY) passWindow.shift();
                this.slidingWindowStats[s.name] = passWindow;
                const avg = (passWindow.reduce((a, b) => a + b, 0) / passWindow.length) || 0;
                lines.push(`${s.name.padEnd(18)} ${s.ms.toFixed(3)} ms avg=${avg.toFixed(3)}`);
            }
        }
        el.textContent = lines.join('\n');
    }

    enable(): void {
        this.enabled = true;
        ensureHudElement().style.display = 'block';
        this.updateNow();
    }

    disable(): void {
        this.enabled = false;
        const el = document.getElementById(HUD_ID);
        if (el) el.style.display = 'none';
    }

    // Toggle EMA vs fixed window averaging
    public toggleAverageMode(): void {
        this.useEMA = !this.useEMA;
        // reset EMA state when switching to EMA to avoid jump from empty state
        if (this.useEMA) {
            this.emaFrameAvg = null;
            this.emaPerPass = {};
        }
    }
}

const overlay = new RenderHUDOverlay();

export function toggleRenderHUD(): void { if (overlay?.enabled) overlay.disable(); else overlay?.enable(); }
export function toggleRenderHUDAverageMode(): void { overlay?.toggleAverageMode(); }
