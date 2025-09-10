import { Registry } from '../core/registry';
import { EventEmitter, subscribesToGlobalEvent } from '../core/eventemitter';
import * as SpritesPipeline from '../render/2d/sprites_pipeline';
import * as MeshPipeline from '../render/3d/mesh_pipeline';
import * as ParticlesPipeline from '../render/3d/particles_pipeline';
import { RegisterablePersistent } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { $ } from 'bmsx/core/game';
import { attachHudPanel, makeHudPanelDraggable } from './hudpanel';

// TODO: FIND A WAY TO NOT INITIALIZE ALL THIS STUFF WHEN THE GAME ROM IS NOT A DEBUG-ROM!
const HUD_ID = 'bmsx-render-hud';

function ensureHudElement(): HTMLElement {
    let el = document.getElementById(HUD_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = HUD_ID;
        el.style.padding = '6px 8px';
        el.style.font = '12px/1.2 monospace';
        el.style.background = 'rgba(0,0,0,0.55)';
        el.style.color = '#cce';
        el.style.pointerEvents = 'auto';
        el.style.zIndex = '9001';
        el.style.borderRadius = '4px';
        el.style.maxWidth = '40vw';
        el.style.whiteSpace = 'pre-wrap';
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.fontWeight = 'bold';
        header.style.marginBottom = '4px';
        header.style.userSelect = 'none';
        const title = document.createElement('span');
        title.textContent = 'Render HUD';
        const buttons = document.createElement('span');
        const btnMin = document.createElement('span');
        btnMin.textContent = '–';
        btnMin.title = 'Minimize';
        btnMin.style.cursor = 'pointer';
        btnMin.style.marginRight = '8px';
        const btnClose = document.createElement('span');
        btnClose.textContent = '×';
        btnClose.title = 'Close';
        btnClose.style.cursor = 'pointer';
        buttons.appendChild(btnMin);
        buttons.appendChild(btnClose);
        const content = document.createElement('div');
        content.id = HUD_ID + '-content';
        const lights = document.createElement('div');
        lights.id = HUD_ID + '-lights';
        lights.style.marginTop = '6px';
        const lightsHeader = document.createElement('div');
        lightsHeader.id = HUD_ID + '-lights-header';
        const lightsDetail = document.createElement('div');
        lightsDetail.id = HUD_ID + '-lights-detail';
        lights.appendChild(lightsHeader);
        lights.appendChild(lightsDetail);
        header.appendChild(title);
        header.appendChild(buttons);
        el.appendChild(header);
        el.appendChild(content);
        el.appendChild(lights);
        attachHudPanel(el, 'top-left');
        makeHudPanelDraggable(el, header);

        // Header controls
        let collapsed = false;
        btnMin.addEventListener('click', (ev) => {
            ev.stopPropagation();
            collapsed = !collapsed;
            (content as HTMLElement).style.display = collapsed ? 'none' : '';
            (lights as HTMLElement).style.display = collapsed ? 'none' : '';
            btnMin.textContent = collapsed ? '+' : '–';
        });
        btnClose.addEventListener('click', (ev) => { ev.stopPropagation(); overlay.disable(); });
        (content as HTMLElement).style.whiteSpace = 'pre-wrap';
        (content as HTMLElement).style.wordBreak = 'break-word';
        (lightsHeader as HTMLElement).style.whiteSpace = 'pre-wrap';
        (lightsDetail as HTMLElement).style.whiteSpace = 'pre-wrap';
        (lightsDetail as HTMLElement).style.wordBreak = 'break-word';
    }
    return el;
}

@excludeclassfromsavegame
export class RenderHUDOverlay implements RegisterablePersistent {
	public get id(): string { return 'render-hud-overlay'; }
	public get registrypersistent(): true { return true; }
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
	private emaMemPerPass: { [key: string]: number } = {};
	private peakMemPerPass: { [key: string]: number } = {};
	private showLightDetail = false;
	private _lightToggleAdded = false;
	private readonly SUMMARY_FREQUENCY = 500; // 500 frames (is 10 seconds, given the strict 50fps)

    constructor() {
        this.enabled = false;
        this.useEMA = true;
        // derive EMA alpha from SUMMARY_FREQUENCY: alpha = 2 / (N + 1)
        this.emaAlpha = 2 / (this.SUMMARY_FREQUENCY + 1);
        // Register for lifecycle-aware event processing
        Registry.instance.register(this);
    }

	// Implement Disposable for Registry/Registerable compatibility
	public dispose(): void {
		// Unsubscribe from all events for this instance
		EventEmitter.instance.removeSubscriber(this);
		// Remove DOM overlay if present
		const el = document.getElementById(HUD_ID);
		if (el && el.parentElement) el.parentElement.removeChild(el);
		this.enabled = false;
	}

    @subscribesToGlobalEvent('frameend', true)
    updateNow(): void {
        if (!this.enabled) return;
		const el = ensureHudElement();
		const contentEl = document.getElementById(HUD_ID + '-content')!;
		const lightsHeaderEl = document.getElementById(HUD_ID + '-lights-header')!;
		const lightsDetailEl = document.getElementById(HUD_ID + '-lights-detail')!;
		// Click/hover only on header (expanded detail stays non-clickable/non-underlined)
		if (!this._lightToggleAdded) {
			lightsHeaderEl.addEventListener('click', (ev) => { this.showLightDetail = !this.showLightDetail; this.updateNow(); ev.stopPropagation(); });
			lightsHeaderEl.addEventListener('mouseenter', () => { lightsHeaderEl.style.textDecoration = 'underline'; lightsHeaderEl.style.cursor = 'pointer'; });
			lightsHeaderEl.addEventListener('mouseleave', () => { lightsHeaderEl.style.textDecoration = 'none'; lightsHeaderEl.style.cursor = 'default'; });
			this._lightToggleAdded = true;
		}

		const gv = $.view;
		const rg = gv.renderGraph;
		if (!rg) { el.textContent = 'Render HUD: no graph'; return; }
		const stats = rg.getPassStats();
		const memInfo = rg.getPassTextureMemoryInfo?.();
		const frameMem = rg.getTotalTextureMemoryInfo?.();
		if (!stats || stats.length === 0) { el.textContent = 'Render HUD: no stats'; return; }
		const lines: string[] = [];
		const lightLines: string[] = [];
		let total = 0;
		for (const s of stats) total += s.ms;
		// Backend draw call counters (if backend exposes them)
		const b = gv.backend;
		const fs = b?.getFrameStats?.();
		if (fs) {
			const toKB = (n?: number) => ((n ?? 0) / 1024).toFixed(1);
			const anyFs = fs as unknown as { vertexBytes?: number; indexBytes?: number; uniformBytes?: number; textureBytes?: number };
			lines.push(
				`draws:${fs.draws} idx:${fs.drawIndexed} inst:${fs.drawsInstanced} idxInst:${fs.drawIndexedInstanced} ` +
				`upload:${toKB(fs.bytesUploaded)}KB (v:${toKB(anyFs.vertexBytes)}KB i:${toKB(anyFs.indexBytes)}KB u:${toKB(anyFs.uniformBytes)}KB t:${toKB(anyFs.textureBytes)}KB)`
			);
			// Lights summary (build separately)
			const dCount = MeshPipeline.getDirectionalLightCount?.() ?? 0;
			const pCount = MeshPipeline.getPointLightCount?.() ?? 0;
			const amb = $.world?.ambientLight?.light;
			const ambColor = amb?.color ?? [0, 0, 0];
			const ambI = amb?.intensity ?? 0;
			const r = Math.max(0, Math.min(255, Math.round((ambColor[0]) * 255)));
			const g = Math.max(0, Math.min(255, Math.round((ambColor[1]) * 255)));
			const b = Math.max(0, Math.min(255, Math.round((ambColor[2]) * 255)));
			const ambChip = `<span style=\"display:inline-block;width:10px;height:10px;background:rgb(${r},${g},${b});border:1px solid #222;margin-right:6px;vertical-align:middle;\"></span>`;
			// Header text (human-friendly labels)
			const header = `${ambChip}<strong>Ambient</strong> (intensity ${ambI.toFixed(2)})   |   Directional lights: ${dCount}   Point lights: ${pCount}   [${this.showLightDetail ? 'details shown' : 'click to show details'}]`;
			(lightsHeaderEl as HTMLElement).innerHTML = header;
			const dirs = MeshPipeline.getDirectionalLights?.() ?? [];
			const pts = MeshPipeline.getPointLightsAll?.() ?? [];
			const topDir = dirs.slice(0, 2).map((l: any) => l.intensity.toFixed(2)).join(', ');
			const topPt = pts.slice(0, 2).map((l: any) => l.intensity.toFixed(2)).join(', ');
			if (dCount || pCount) lightLines.push(`  Directional intensities: [${topDir}]   Point intensities: [${topPt}]`);
			if (this.showLightDetail) {
				for (let i = 0; i < dirs.length; i++) {
					const L = dirs[i]; lightLines.push(`  Directional #${i}  Intensity:${L.intensity.toFixed(2)}  Color:[${L.color.map((c: number) => c.toFixed(2)).join(',')}]  Direction:[${L.orientation.map((c: number) => c.toFixed(2)).join(',')}]`);
				}
				for (let i = 0; i < pts.length; i++) {
					const L = pts[i]; lightLines.push(`  Point #${i}  Intensity:${L.intensity.toFixed(2)}  Range:${(L.range ?? 0).toFixed(2)}  Color:[${L.color.map((c: number) => c.toFixed(2)).join(',')}]  Position:[${(L.pos ?? [0, 0, 0]).map((c: number) => c.toFixed(2)).join(',')}]`);
				}
			}
			const mu = MeshPipeline.getMorphTextureUsage();
			if (mu && (mu.pos || mu.norm)) lines.push(`morphTex pos:${mu.pos} norm:${mu.norm}`);
		}

		// Compute averages depending on mode (EMA or fixed sliding window)
		const modeStr = this.useEMA ? 'EMA' : 'Window';
		// Feature queue sizes (front/back)
		const sq = (SpritesPipeline).getSpriteQueueDebug();
		const mq = (MeshPipeline).getMeshQueueDebug();
		const pq = (ParticlesPipeline).getQueuedParticleCount();
		if (sq || mq || pq) {
			const s = sq ? `S f:${sq.front} b:${sq.back}` : 'S n/a';
			const m = mq ? `M f:${mq.front} b:${mq.back}` : 'M n/a';
			const p = pq ? `P f:${pq} b:n/a` : 'P n/a';
			lines.push(`queues ${s} | ${m} | ${p}`);
		}
		if (this.useEMA) {
			// Update EMA for frame average
			if (this.emaFrameAvg === null) this.emaFrameAvg = total;
			else this.emaFrameAvg = this.emaAlpha * total + (1 - this.emaAlpha) * this.emaFrameAvg;
			lines.push(`Frame ${Math.floor(performance.now())} time:${total.toFixed(2)}ms avg:${this.emaFrameAvg.toFixed(2)}ms mode=${modeStr}`);

			if (frameMem) {
				lines.push(`frame tex mem: ${(frameMem.total / (1024 * 1024)).toFixed(2)} MB (color ${(frameMem.color / (1024 * 1024)).toFixed(2)} + depth ${(frameMem.depth / (1024 * 1024)).toFixed(2)})`);
			}
			// Update per-pass EMAs
			for (const s of stats) {
				const prev = this.emaPerPass[s.name];
				if (prev === undefined) this.emaPerPass[s.name] = s.ms;
				else this.emaPerPass[s.name] = this.emaAlpha * s.ms + (1 - this.emaAlpha) * prev;
				const avg = this.emaPerPass[s.name];
				lines.push(`${s.name.padEnd(18)} ${s.ms.toFixed(3)} ms avg=${avg.toFixed(3)}`);
			}
			// Update per-pass memory EMAs + peak
			if (Array.isArray(memInfo)) {
				for (const m of memInfo) {
					const prev = this.emaMemPerPass[m.name] ?? 0;
					this.emaMemPerPass[m.name] = prev === 0 ? m.bytes : (this.emaAlpha * m.bytes + (1 - this.emaAlpha) * prev);
					const peak = this.peakMemPerPass[m.name] ?? 0;
					this.peakMemPerPass[m.name] = Math.max(peak, m.bytes);
					if (m.bytes > 0) lines.push(`${(m.name + ' mem').padEnd(18)} ${(m.bytes / (1024 * 1024)).toFixed(2)}MB avg=${(this.emaMemPerPass[m.name] / (1024 * 1024)).toFixed(2)}MB peak=${(this.peakMemPerPass[m.name] / (1024 * 1024)).toFixed(2)}MB`);
				}
			}
		} else {
			// Windowed averages
			this.frameWindow.push(total);
			if (this.frameWindow.length > this.SUMMARY_FREQUENCY) this.frameWindow.shift();
			const frameAvg = (this.frameWindow.reduce((a, b) => a + b, 0) / this.frameWindow.length) || 0;
			lines.push(`Frame ${Math.floor(performance.now())} time:${total.toFixed(2)}ms avg:${frameAvg.toFixed(2)}ms mode=${modeStr}`);

			// Update per-pass sliding windows and show per-pass averages
			for (const s of stats) {
				const passWindow = this.slidingWindowStats[s.name] || [];
				passWindow.push(s.ms);
				if (passWindow.length > this.SUMMARY_FREQUENCY) passWindow.shift();
				this.slidingWindowStats[s.name] = passWindow;
				const avg = (passWindow.reduce((a, b) => a + b, 0) / passWindow.length) || 0;
				lines.push(`${s.name.padEnd(18)} time:${s.ms.toFixed(3)}ms avg:${avg.toFixed(3)}ms`);
			}
			if (frameMem) {
				lines.push(`frame tex mem: ${(frameMem.total / (1024 * 1024)).toFixed(2)} MB (color ${(frameMem.color / (1024 * 1024)).toFixed(2)} + depth ${(frameMem.depth / (1024 * 1024)).toFixed(2)})`);
			}
			// Memory windows: we’ll just show current + peak for windowed mode for brevity
			if (Array.isArray(memInfo)) {
				for (const m of memInfo) {
					const peak = this.peakMemPerPass[m.name] ?? 0;
					this.peakMemPerPass[m.name] = Math.max(peak, m.bytes);
					if (m.bytes > 0) lines.push(`${(m.name + ' mem').padEnd(18)} ${(m.bytes / (1024 * 1024)).toFixed(2)}MB avg=${(this.emaMemPerPass[m.name] / (1024 * 1024)).toFixed(2)}MB peak=${(this.peakMemPerPass[m.name] / (1024 * 1024)).toFixed(2)}MB`);
				}
			}
		}
		// Render non-light metrics
		contentEl.textContent = lines.join('\n');
		// Render detailed lights section (color chips); keep header separate & the only clickable part
		lightsDetailEl.innerHTML = lightLines
			.map(line => line
				.replace(/C:\[(.*?)\]/g, (_m, g1) => {
					const comps = String(g1).split(',').map((s: string) => parseFloat(s));
					const r = Math.max(0, Math.min(255, Math.round((comps[0] || 0) * 255)));
					const g = Math.max(0, Math.min(255, Math.round((comps[1] || 0) * 255)));
					const b = Math.max(0, Math.min(255, Math.round((comps[2] || 0) * 255)));
					const chip = `<span style=\"display:inline-block;width:10px;height:10px;background:rgb(${r},${g},${b});border:1px solid #222;margin-right:4px;vertical-align:middle;\"></span>`;
					return `${chip}C:[${g1}]`;
				})
			)
			.join('<br>');
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

    /** Wire decorator-declared subscriptions for this overlay. */
    public bind(): void {
        EventEmitter.instance.initClassBoundEventSubscriptions(this);
    }

    /** Unwire overlay subscriptions. */
    public unbind(): void {
        EventEmitter.instance.removeSubscriber(this);
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
