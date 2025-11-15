import { Registry } from '../core/registry';
import { EventEmitter, subscribesToGlobalEvent } from '../core/eventemitter';
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { attachHudPanel, makeHudPanelDraggable } from './hudpanel';
import { $ } from '../core/game';
import { AbilitySystemComponent, type AbilityTagSnapshot } from '../component/abilitysystemcomponent';
import type { Identifier } from '../rompack/rompack';

const HUD_ID = 'bmsx-ability-tag-hud';
const CONTENT_ID = HUD_ID + '-content';
const TARGET_LABEL_ID = HUD_ID + '-target-label';

function ensureHudElement(): { root: HTMLElement; content: HTMLElement; targetLabel: HTMLElement } {
	let root = document.getElementById(HUD_ID);
	if (!root) {
		root = document.createElement('div');
		root.id = HUD_ID;
		root.style.padding = '6px 8px';
		root.style.font = '12px/1.4 monospace';
		root.style.background = 'rgba(0,0,0,0.6)';
		root.style.color = '#dfe3ff';
		root.style.pointerEvents = 'auto';
		root.style.zIndex = '9001';
		root.style.borderRadius = '4px';
		root.style.minWidth = '220px';
		root.style.maxWidth = '46vw';
		root.style.whiteSpace = 'pre';
		const header = document.createElement('div');
		header.style.display = 'flex';
		header.style.justifyContent = 'space-between';
		header.style.alignItems = 'center';
		header.style.fontWeight = 'bold';
		header.style.marginBottom = '4px';
		header.style.userSelect = 'none';
		const titleWrap = document.createElement('div');
		titleWrap.style.display = 'flex';
		titleWrap.style.alignItems = 'baseline';
		titleWrap.style.gap = '6px';
		const title = document.createElement('span');
		title.textContent = 'Ability Tags';
		const targetLabel = document.createElement('span');
		targetLabel.id = TARGET_LABEL_ID;
		targetLabel.style.fontSize = '11px';
		targetLabel.style.fontWeight = 'normal';
		targetLabel.style.opacity = '0.85';
		targetLabel.textContent = '(no target)';
		titleWrap.appendChild(title);
		titleWrap.appendChild(targetLabel);
		const buttons = document.createElement('div');
		buttons.style.display = 'flex';
		buttons.style.gap = '10px';
		buttons.style.alignItems = 'center';
		const btnMin = document.createElement('span');
		btnMin.textContent = '-';
		btnMin.title = 'Minimize';
		btnMin.style.cursor = 'pointer';
		const btnClear = document.createElement('span');
		btnClear.textContent = 'Clr';
		btnClear.title = 'Clear selection';
		btnClear.style.cursor = 'pointer';
		const btnClose = document.createElement('span');
		btnClose.textContent = 'X';
		btnClose.title = 'Close';
		btnClose.style.cursor = 'pointer';
		buttons.appendChild(btnMin);
		buttons.appendChild(btnClear);
		buttons.appendChild(btnClose);
		header.appendChild(titleWrap);
		header.appendChild(buttons);
		const content = document.createElement('div');
		content.id = CONTENT_ID;
		content.style.whiteSpace = 'pre';
		content.style.lineHeight = '1.3';
		root.appendChild(header);
		root.appendChild(content);
		attachHudPanel(root, 'top-right');
		makeHudPanelDraggable(root, header);
		let collapsed = false;
		btnMin.addEventListener('click', (ev) => {
			ev.stopPropagation();
			collapsed = !collapsed;
			content.style.display = collapsed ? 'none' : '';
			btnMin.textContent = collapsed ? '+' : '-';
		});
		btnClear.addEventListener('click', (ev) => {
			ev.stopPropagation();
			overlay?.clearTarget();
		});
		btnClose.addEventListener('click', (ev) => {
			ev.stopPropagation();
			overlay?.disable();
		});
	}
	const content = document.getElementById(CONTENT_ID);
	if (!content) throw new Error('[AbilityTagHUD] Content element is missing.');
	const targetLabel = document.getElementById(TARGET_LABEL_ID);
	if (!targetLabel) throw new Error('[AbilityTagHUD] Target label element is missing.');
	return { root, content, targetLabel };
}

function describeSnapshot(snapshot: AbilityTagSnapshot): string[] {
	const lines: string[] = [];
	lines.push('Combined Tags');
	if (snapshot.combined.length === 0) {
		lines.push('  (none)');
	} else {
		for (const tag of snapshot.combined) {
			lines.push('  - ' + tag);
		}
	}
	lines.push('');
	lines.push('Explicit Tags');
	if (snapshot.explicit.length === 0) {
		lines.push('  (none)');
	} else {
		for (const tag of snapshot.explicit) {
			lines.push('  - ' + tag);
		}
	}
	lines.push('');
	lines.push('Granted Tags');
	if (snapshot.granted.length === 0) {
		lines.push('  (none)');
	} else {
		for (const entry of snapshot.granted) {
			lines.push('  - ' + entry.tag + ' x' + entry.stacks);
		}
	}
	return lines;
}

@excludeclassfromsavegame
class AbilityTagHUDOverlay {
	public get id(): string { return 'ability-tag-hud-overlay'; }
	public get registrypersistent(): true { return true; }
	public enabled = false;
	private targetId: Identifier | null = null;

	constructor() {
		Registry.instance.register(this);
	}

	public dispose(): void {
		EventEmitter.instance.removeSubscriber(this);
		const el = document.getElementById(HUD_ID);
		if (el && el.parentElement) {
			el.parentElement.removeChild(el);
		}
		this.enabled = false;
		this.targetId = null;
	}

	@subscribesToGlobalEvent('frameend', true)
	updateNow(): void {
		if (!this.enabled) return;
		const elements = ensureHudElement();
		const hud = elements.root;
		hud.style.display = 'block';
		const content = elements.content;
		const targetLabel = elements.targetLabel;
		if (!this.targetId) {
			targetLabel.textContent = '(no target)';
			content.textContent = 'Select an object to inspect ability tags. Use Ctrl+Right-Click in the viewport.';
			return;
		}
		const world = $.world;
		if (!world) {
			targetLabel.textContent = '(world unavailable)';
			content.textContent = 'World is not initialised.';
			return;
		}
		const obj = world.getWorldObject(this.targetId);
		if (!obj) {
			targetLabel.textContent = this.targetId + ' (missing)';
			content.textContent = 'Selected object no longer exists.';
			return;
		}
		const ctor = obj.constructor as { name?: string } | undefined;
		const ctorName = ctor && typeof ctor.name === 'string' ? ctor.name : 'WorldObject';
		targetLabel.textContent = this.targetId + ' [' + ctorName + ']';
		const asc = obj.get_unique_component(AbilitySystemComponent);
		if (!asc) {
			content.textContent = 'AbilitySystemComponent not found on this object.';
			return;
		}
		const snapshot = asc.snapshot_tags();
		const lines = describeSnapshot(snapshot);
		if (asc.effects.length > 0) {
			lines.push('');
			lines.push('Active Effects: ' + asc.effects.length);
			for (const entry of asc.effects) {
				const effect = entry.effect;
				const effectLineParts: string[] = [];
				effectLineParts.push(effect.id);
				if (effect.grantedTags && effect.grantedTags.length > 0) {
					effectLineParts.push('tags=' + effect.grantedTags.join(','));
				}
				if (effect.durationMs !== undefined) {
					effectLineParts.push('duration=' + effect.durationMs + 'ms');
				}
				lines.push('  - ' + effectLineParts.join(' | '));
			}
		}
		content.textContent = lines.join('\n');
	}

	enable(): void {
		this.enabled = true;
		const elements = ensureHudElement();
		elements.root.style.display = 'block';
		this.updateNow();
	}

	disable(): void {
		this.enabled = false;
		const el = document.getElementById(HUD_ID);
		if (el) {
			el.style.display = 'none';
		}
	}

	public setTarget(id: Identifier | null): void {
		this.targetId = id;
		if (this.enabled) this.updateNow();
	}

	public clearTarget(): void {
		this.setTarget(null);
	}

	public getTarget(): Identifier | null {
		return this.targetId;
	}

	public bind(): void {
		EventEmitter.instance.initClassBoundEventSubscriptions(this);
	}

	public unbind(): void {
		EventEmitter.instance.removeSubscriber(this);
	}
}

const overlay: AbilityTagHUDOverlay | null = typeof document === 'undefined' ? null : new AbilityTagHUDOverlay();
if (overlay) overlay.bind();

export function toggleAbilityTagHUD(): void {
	if (!overlay) return;
	if (overlay.enabled) overlay.disable();
	else overlay.enable();
}

export function setAbilityTagHudTarget(id: Identifier | null): void {
	if (!overlay) return;
	overlay.setTarget(id);
	if (!overlay.enabled) {
		overlay.enable();
	}
}

export function clearAbilityTagHudTarget(): void {
	if (!overlay) return;
	overlay.clearTarget();
}

export function getAbilityTagHudTarget(): Identifier | null {
	return overlay ? overlay.getTarget() : null;
}

export function isAbilityTagHudEnabled(): boolean {
	return overlay ? overlay.enabled : false;
}
