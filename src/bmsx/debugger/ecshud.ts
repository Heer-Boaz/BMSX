import { Registry } from '../core/registry';
import { EventEmitter, subscribesToGlobalEvent } from '../core/eventemitter';
import { excludeclassfromsavegame } from 'bmsx/serializer/serializationhooks';
import { DefaultECSPipelineRegistry as ECSReg } from '../ecs/pipeline';
import { attachHudPanel, makeHudPanelDraggable } from './hudpanel';
import { $ } from 'bmsx/core/game';

const HUD_ID = 'bmsx-ecs-hud';

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
		title.textContent = 'ECS HUD';
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
		header.appendChild(title);
		header.appendChild(buttons);
		el.appendChild(header);
		el.appendChild(content);
		attachHudPanel(el, 'top-left');
		makeHudPanelDraggable(el, header);
		// Header controls
		let collapsed = false;
		btnMin.addEventListener('click', (ev) => {
			ev.stopPropagation();
			collapsed = !collapsed;
			(content as HTMLElement).style.display = collapsed ? 'none' : '';
			btnMin.textContent = collapsed ? '+' : '–';
		});
		btnClose.addEventListener('click', (ev) => { ev.stopPropagation(); overlay.disable(); });
	}
	return el;
}

@excludeclassfromsavegame
export class ECSHUDOverlay {
	public get id(): string { return 'ecs-hud-overlay'; }
	public get registrypersistent(): true { return true; }
	public enabled = false;
	// EMA timing per-system id
	private useEMA = true;
	private readonly emaAlpha: number = 2 / (500 + 1); // mirror render HUD smoothing (~10s window at 50fps)
	private emaPerSystem: { [id: string]: number } = {};
	private emaGroup: { [g: number]: number } = {};

	constructor() {
		this.enabled = false;
		Registry.instance.register(this);
	}

	public dispose(): void {
		EventEmitter.instance.removeSubscriber(this);
		const el = document.getElementById(HUD_ID);
		if (el && el.parentElement) el.parentElement.removeChild(el);
		this.enabled = false;
	}

	@subscribesToGlobalEvent('frameend', true)
	updateNow(): void {
		if (!this.enabled) return;
		const el = ensureHudElement();
		const contentEl = document.getElementById(HUD_ID + '-content')!;
		const diag = ECSReg.getLastDiagnostics();
		if (!diag) { el.textContent = 'ECS HUD: no diagnostics'; return; }
		const sysStats = $.world.systems.getStats() ?? [];
		const lines: string[] = [];
		lines.push('ECS Pipeline');
		lines.push(`build: ${diag.buildMs.toFixed(2)} ms  systems: ${diag.finalOrder.length}`);
		// Timing summary per group
		const groupTotals: Record<number, number> = {};
		for (const s of sysStats) groupTotals[s.group] = (groupTotals[s.group] ?? 0) + s.ms;
		const groupsLine: string[] = [];
		for (const g of Object.keys(groupTotals).map(k => +k).sort((a, b) => a - b)) {
			const total = groupTotals[g] ?? 0;
			// EMA per group
			const prev = this.emaGroup[g] ?? total;
			const ema = this.useEMA ? (this.emaGroup[g] = this.emaAlpha * total + (1 - this.emaAlpha) * prev) : total;
			groupsLine.push(`${String(g)}:${total.toFixed(2)}ms avg=${ema.toFixed(2)}ms`);
		}
		if (groupsLine.length) lines.push('Groups: ' + groupsLine.join('  |  '));
		// Per-system breakdown in current order
		if (sysStats.length) {
			lines.push('Systems:');
			for (const s of sysStats) {
				const key = s.id || s.name;
				const prev = this.emaPerSystem[key] ?? s.ms;
				const ema = this.useEMA ? (this.emaPerSystem[key] = this.emaAlpha * s.ms + (1 - this.emaAlpha) * prev) : s.ms;
				lines.push(`  [${String(s.group)}] ${key.padEnd(24)} ${s.ms.toFixed(3)} ms avg=${ema.toFixed(3)}`);
			}
		}
		lines.push('');
		// World metrics snapshot
		const world = $.world;
		if (world) {
			const spaces = world.spaces?.length ?? 0;
			const activeSpace = world.activeSpaceId ?? 'n/a';
			const objCount = world.countFilteredObjects(() => true);
			const cams = world.activeCameras.length;
			const lights = world.activeLights.length;
			lines.push(`World: spaces=${spaces} active='${activeSpace}' objs=${objCount} cams=${cams} lights=${lights}`);
		}
		if (diag.cyclesDetected) {
			lines.push('');
			lines.push('Warning: cycle(s) detected; priority order used.');
			for (const g of diag.cycleGroups ?? []) lines.push(`  group=${String(g.group)}: [${g.refs.join(', ')}]`);
		}
		contentEl.textContent = lines.join('\n');
	}

	enable(): void { this.enabled = true; ensureHudElement().style.display = 'block'; this.updateNow(); }
	disable(): void { this.enabled = false; const el = document.getElementById(HUD_ID); if (el) el.style.display = 'none'; }

	/** Wire decorator-declared subscriptions. */
	public bind(): void { EventEmitter.instance.initClassBoundEventSubscriptions(this); }
	public unbind(): void { EventEmitter.instance.removeSubscriber(this); }
}

const overlay = new ECSHUDOverlay();
overlay.bind();

export function toggleECSHUD(): void {
	if (overlay.enabled) overlay.disable();
	else overlay.enable();
}
