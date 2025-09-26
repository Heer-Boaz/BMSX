type Anchor = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type Flow = 'row' | 'column';

const ROOT_ID = 'bmsx-hud-root';

function ensureRoot(): HTMLElement {
	let root = document.getElementById(ROOT_ID);
	if (!root) {
		root = document.createElement('div');
		root.id = ROOT_ID;
		root.style.position = 'absolute';
		root.style.left = '0';
		root.style.top = '0';
		root.style.width = '100%';
		root.style.height = '100%';
		root.style.pointerEvents = 'none';
		root.style.zIndex = '9000';
		document.body.appendChild(root);
	}
	return root;
}

function anchorToStyle(anchor: Anchor, el: HTMLElement): void {
	el.style.position = 'absolute';
	el.style.pointerEvents = 'auto';
	const pad = 8;
	el.style.display = 'flex';
	el.style.gap = '8px';
	switch (anchor) {
		case 'top-left':
			el.style.left = pad + 'px';
			el.style.top = pad + 'px';
			break;
		case 'top-right':
			el.style.right = pad + 'px';
			el.style.top = pad + 'px';
			break;
		case 'bottom-left':
			el.style.left = pad + 'px';
			el.style.bottom = pad + 'px';
			break;
		case 'bottom-right':
			el.style.right = pad + 'px';
			el.style.bottom = pad + 'px';
			break;
	}
}

const docks: Record<string, HTMLElement> = {};
const flows: Record<string, Flow> = { 'top-left': 'row', 'top-right': 'row', 'bottom-left': 'row', 'bottom-right': 'row' };
const placeholders: Record<string, HTMLElement> = {};
const dragState: { panelId: string | null; panelHeight: number; panelWidth: number } = { panelId: null, panelHeight: 48, panelWidth: 160 };

let panelIdCounter = 0;

export function ensureHudDock(anchor: Anchor = 'top-left'): HTMLElement {
	const key = anchor;
	if (docks[key]) return docks[key];
	const root = ensureRoot();
	const dock = document.createElement('div');
	anchorToStyle(anchor, dock);
	dock.style.flexDirection = flows[key] === 'column' ? 'column' : 'row';
	dock.dataset.anchor = anchor;
	dock.id = dock.id || `hud-dock-${anchor}`;
	// Drag/drop support for relocating panels
	dock.addEventListener('dragover', (e) => {
		e.preventDefault();
		const dataTransfer = (e as DragEvent).dataTransfer;
		if (!dataTransfer) throw new Error('[HUDPanel] Drag event is missing dataTransfer payload.');
		dataTransfer.dropEffect = 'move';
		// compute insertion position and show placeholder
		const ph = getPlaceholderForDock(dock);
		const flow = flows[key] || 'row';
		const children = Array.from(dock.children).filter(ch => ch !== ph && (ch as HTMLElement).id !== dragState.panelId) as HTMLElement[];
		const { clientX: ptX, clientY: ptY } = e as DragEvent;
		let insertBefore: Element | null = null;
		for (let i = 0; i < children.length; i++) {
			const r = children[i].getBoundingClientRect();
			const cmp = (flow === 'row') ? ptX - (r.left + r.width / 2) : ptY - (r.top + r.height / 2);
			if (cmp < 0) { insertBefore = children[i]; break; }
		}
		// Fix placeholder size to dragged panel dimensions to avoid layout growth
		ph.style.height = `${dragState.panelHeight}px`;
		ph.style.width = `${dragState.panelWidth}px`;
		if (insertBefore) dock.insertBefore(ph, insertBefore); else dock.appendChild(ph);
	});
	dock.addEventListener('dragenter', () => { dock.style.outline = '2px dashed #88f'; dock.style.outlineOffset = '2px'; });
	dock.addEventListener('dragleave', (e) => {
		// Only clear if leaving the dock (not moving between children)
		const rel = e.relatedTarget as Node | null;
		if (rel && dock.contains(rel)) return;
		dock.style.outline = ''; dock.style.outlineOffset = '';
		clearPlaceholder(dock);
	});
	dock.addEventListener('drop', (e) => {
		e.preventDefault();
		const dataTransfer = e.dataTransfer;
		if (!dataTransfer) throw new Error('[HUDPanel] Drop event is missing dataTransfer payload.');
		const id = dataTransfer.getData('text/hudpanel') || dataTransfer.getData('text/plain');
		if (!id) throw new Error('[HUDPanel] Dropped panel id not found.');
		const panel = document.getElementById(id);
		const baseAnchorDock = dock; // hovered dock
		const targetAnchor = resolveAnchorFromModifiers(baseAnchorDock, e as DragEvent);
		const targetDock = targetAnchor === (dock.dataset.anchor as Anchor) ? dock : ensureHudDock(targetAnchor);
		const ph = placeholders[targetDock.id];
		if (!panel) throw new Error(`[HUDPanel] Dropped panel '${id}' could not be located in the DOM.`);
		if (ph && ph.parentElement === targetDock) targetDock.insertBefore(panel, ph);
		else targetDock.appendChild(panel);
		persistPanelLayout(panel, targetDock);
		baseAnchorDock.style.outline = '';
		baseAnchorDock.style.outlineOffset = '';
		clearPlaceholder(baseAnchorDock);
		if (targetDock !== baseAnchorDock) { clearPlaceholder(targetDock); }
	});
	root.appendChild(dock);
	docks[key] = dock;
	return dock;
}

export function setHudDockFlow(anchor: Anchor, flow: Flow): void {
	flows[anchor] = flow;
	const dock = docks[anchor];
	if (dock) dock.style.flexDirection = flow === 'column' ? 'column' : 'row';
}

export function attachHudPanel(panel: HTMLElement, anchor: Anchor = 'top-left'): void {
	const dock = ensureHudDock(anchor);
	panel.style.pointerEvents = 'auto';
	panel.style.margin = '0';
	panel.classList.add('hud-panel');
	dock.appendChild(panel);
}

export function makeHudPanelDraggable(panel: HTMLElement & { __prevOpacity?: string }, handle?: HTMLElement): void {
	if (!panel.id) panel.id = `hudpanel-${++panelIdCounter}`;
	panel.draggable = true;
	if (handle) handle.style.cursor = 'move';
	// Gate drag to handle press if a handle is provided
	let allowDrag = !handle;
	if (handle) {
		const allow = () => { allowDrag = true; };
		const disallow = () => { allowDrag = false; };
		handle.addEventListener('pointerdown', allow);
		handle.addEventListener('mousedown', allow);
		handle.addEventListener('pointerup', disallow);
		handle.addEventListener('mouseup', disallow);
		handle.addEventListener('mouseleave', disallow);
	}
	panel.addEventListener('dragstart', (e: DragEvent) => {
		if (!allowDrag) {
			e.preventDefault();
			return;
		}
		allowDrag = !handle; // consume one-time allowance
		const dataTransfer = e.dataTransfer;
		if (!dataTransfer) throw new Error('[HUDPanel] Dragstart missing dataTransfer payload.');
		dataTransfer.setData('text/hudpanel', panel.id);
		dataTransfer.setData('text/plain', panel.id);
		dataTransfer.effectAllowed = 'move';
		const r = panel.getBoundingClientRect();
		dragState.panelId = panel.id;
		dragState.panelHeight = r.height;
		dragState.panelWidth = r.width;
		// Hide the original panel visually (but keep layout slot) so drag continues reliably
		panel.__prevOpacity = panel.style.opacity;
		panel.style.opacity = '0';
		// Provide a minimal drag image to avoid default ghost
		const ghost = document.createElement('canvas');
		ghost.width = 1;
		ghost.height = 1;
		dataTransfer.setDragImage(ghost, 0, 0);
	});
	panel.addEventListener('dragend', () => {
		for (const key of Object.keys(docks)) { docks[key].style.outline = ''; docks[key].style.outlineOffset = ''; clearPlaceholder(docks[key]); }
		dragState.panelId = null;
		// Restore panel visibility
		const prevOp = panel.__prevOpacity as string | undefined;
		panel.style.opacity = prevOp ?? '';
		delete panel.__prevOpacity;
	});
	// Apply saved layout after ID is known
	applySavedPanelLayout(panel);
}

function getPlaceholderForDock(dock: HTMLElement): HTMLElement {
	const id = dock.id;
	let ph = placeholders[id];
	if (!ph) {
		ph = document.createElement('div');
		ph.style.border = '2px dashed #88f';
		ph.style.borderRadius = '4px';
		ph.style.minWidth = '40px';
		ph.style.minHeight = '24px';
		ph.style.opacity = '0.85';
		ph.style.boxSizing = 'border-box';
		ph.style.flex = '0 0 auto';
		ph.style.pointerEvents = 'none';
		placeholders[id] = ph;
	}
	return ph;
}

function clearPlaceholder(dock: HTMLElement): void {
	const ph = placeholders[dock.id];
	if (ph && ph.parentElement === dock) dock.removeChild(ph);
}

// --- Layout persistence ---
type LayoutEntry = { anchor: Anchor; index: number };
const LS_KEY = 'bmsx.hud.layout';

function loadLayout(): Record<string, LayoutEntry> {
	const raw = localStorage.getItem(LS_KEY);
	if (!raw) return {};
	return JSON.parse(raw) as Record<string, LayoutEntry>;
}

function saveLayout(map: Record<string, LayoutEntry>): void {
	localStorage.setItem(LS_KEY, JSON.stringify(map));
}

function persistPanelLayout(panel: HTMLElement, dock: HTMLElement): void {
	const map = loadLayout();
	const children = Array.from(dock.children).filter(ch => (ch as HTMLElement).classList.contains('hud-panel'));
	const index = children.indexOf(panel);
	const anchor = (dock.dataset.anchor as Anchor) || 'top-left';
	if (index >= 0) { map[panel.id] = { anchor, index }; saveLayout(map); }
}

export function applySavedPanelLayout(panel: HTMLElement): void {
	const map = loadLayout();
	const entry = panel.id ? map[panel.id] : undefined;
	if (!entry) return;
	const dock = ensureHudDock(entry.anchor);
	// Insert at saved index (clamped)
	const panels = Array.from(dock.children).filter(ch => (ch as HTMLElement).classList.contains('hud-panel'));
	const idx = Math.max(0, Math.min(entry.index, panels.length));
	if (idx >= panels.length) dock.appendChild(panel); else dock.insertBefore(panel, panels[idx]);
}

// --- Modifier-based snapping ---
function swapAnchor(base: Anchor, mode: 'h' | 'v' | 'd'): Anchor {
	const mapH: Record<Anchor, Anchor> = { 'top-left': 'top-right', 'top-right': 'top-left', 'bottom-left': 'bottom-right', 'bottom-right': 'bottom-left' };
	const mapV: Record<Anchor, Anchor> = { 'top-left': 'bottom-left', 'top-right': 'bottom-right', 'bottom-left': 'top-left', 'bottom-right': 'top-right' };
	const mapD: Record<Anchor, Anchor> = { 'top-left': 'bottom-right', 'top-right': 'bottom-left', 'bottom-left': 'top-right', 'bottom-right': 'top-left' };
	return mode === 'h' ? mapH[base] : mode === 'v' ? mapV[base] : mapD[base];
}

function resolveAnchorFromModifiers(currentDock: HTMLElement, e: DragEvent): Anchor {
	const base = (currentDock.dataset.anchor as Anchor) || 'top-left';
	if (e.ctrlKey) return swapAnchor(base, 'd');
	if (e.altKey) return swapAnchor(base, 'v');
	if (e.shiftKey) return swapAnchor(base, 'h');
	return base;
}
