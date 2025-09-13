import { $ } from '../core/game';
import { FloatingDialog } from './bmsxdebugger';

// Track expanded/collapsed state per dialog instance
class PropertyTreeState {
	expanded: Set<string> = new Set();
	// Returns true if a property path should be expanded by default
	static shouldAutoExpand(value: any): boolean {
		if (value === null || value === undefined) return false;
		if (typeof value !== 'object') return true;
		if (Array.isArray(value) && value.length === 0) return false;
		if (Array.isArray(value) && value.length <= 3) return true;
		if (!Array.isArray(value) && Object.keys(value).length <= 3) return true;
		// Expand if all children are primitives
		if (!Array.isArray(value) && Object.values(value).every(v => v == null || typeof v !== 'object')) return true;
		return false;
	}
}

function buildObjectTreePersistent(
	obj: any,
	ignoreProps: string[] | undefined,
	state: PropertyTreeState,
	parentPath: string = '',
	visitedObjs?: WeakSet<object>,
): HTMLDivElement | undefined {
	// Use a WeakSet of object references to detect cycles rather than path strings
	if (!visitedObjs) visitedObjs = new WeakSet<object>();

	if (obj && typeof obj === 'object') {
		if (visitedObjs.has(obj)) return undefined; // Skip already visited object to avoid cycles
		visitedObjs.add(obj);
	}

	const container = document.createElement('div');
	container.className = 'object-tree';
	const entries = Array.isArray(obj)
		? obj.map((v, i) => [String(i), v])
		: Object.entries(obj);
	for (const [key, value] of entries) {
		if (ignoreProps && ignoreProps.includes(key)) continue;
		const isObj = typeof value === 'object' && value !== null;
		const path = parentPath ? parentPath + '.' + key : key;
		if (isObj) {
			const childTree = buildObjectTreePersistent(value, ignoreProps, state, path, visitedObjs);
			if (!childTree) {
				// Already visited object (cycle) — show collapsed indicator to avoid overflowing recursion
				const details = document.createElement('details');
				const summary = document.createElement('summary');
				summary.textContent = `${key}: ${Array.isArray(value) ? 'Array[' + value.length + ']' : 'Object'} (circular)`;
				details.appendChild(summary);
				container.appendChild(details);
				continue;
			}

			const details = document.createElement('details');
			// Use state or auto-expand
			details.open = state.expanded.has(path) || PropertyTreeState.shouldAutoExpand(value);
			details.addEventListener('toggle', () => {
				if (details.open) state.expanded.add(path);
				else state.expanded.delete(path);
			});
			const summary = document.createElement('summary');
			summary.textContent = `${key}: ${Array.isArray(value) ? 'Array[' + value.length + ']' : 'Object'}`;
			details.appendChild(summary);
			details.appendChild(childTree);
			container.appendChild(details);
		} else {
			const row = document.createElement('div');
			row.className = 'tree-row';
			const keySpan = document.createElement('span');
			keySpan.className = 'tree-key';
			keySpan.textContent = key;
			const valueSpan = document.createElement('span');
			valueSpan.className = 'tree-value';
			valueSpan.textContent = String(value);
			valueSpan.setAttribute('data-path', parentPath ? parentPath + '.' + key : key);
			row.appendChild(keySpan);
			row.appendChild(valueSpan);
			container.appendChild(row);
		}
	}
	return container;
}

function updateObjectTreeValues(
	container: HTMLElement,
	obj: any,
	parentPath: string = ''
) {
	const entries = Array.isArray(obj)
		? obj.map((v, i) => [String(i), v])
		: Object.entries(obj);
	for (const [key, value] of entries) {
		const path = parentPath ? parentPath + '.' + key : key;
		if (typeof value === 'object' && value !== null) {
			// Find <details> for this path
			const details = Array.from(container.children).find(
				el => el.tagName === 'DETAILS' && (el.querySelector('summary')?.textContent?.startsWith(key + ':'))
			) as HTMLDetailsElement | undefined;
			if (details) {
				// Recurse into child
				updateObjectTreeValues(details.lastElementChild as HTMLElement, value, path);
			}
		} else {
			// Find .tree-value for this path
			const valueSpan = container.querySelector(`.tree-value[data-path="${path}"]`);
			if (valueSpan) valueSpan.textContent = String(value);
		}
	}
}

export class ObjectPropertyDialog {
	private static openDialogs: Map<string, ObjectPropertyDialog> = new Map();
	private dialog: FloatingDialog;
	private objectId: string;
	private contentDiv: HTMLElement;
	private ignoreProps?: string[];
	private treeState: PropertyTreeState;
	private treeRoot: HTMLDivElement;

	constructor(objectId: string, title: string, ignoreProps?: string[]) {
		this.objectId = objectId;
		this.ignoreProps = ignoreProps;
		this.dialog = new FloatingDialog(title);
		this.contentDiv = this.dialog.getContentElement();
		this.treeState = new PropertyTreeState();
		// Build tree once
		const obj = $.get(this.objectId);
		if (!obj) {
			this.contentDiv.textContent = 'Object not found.';
			return; // Object might have been deleted or not available yet
		}
		this.contentDiv.innerHTML = '';
		this.contentDiv.classList.add('object-dialog-scrollable');
		this.treeRoot = buildObjectTreePersistent(obj, this.ignoreProps, this.treeState);
		this.contentDiv.appendChild(this.treeRoot);
		this.dialog.updateSize();
		ObjectPropertyDialog.openDialogs.set(objectId, this);
	}
	private renderTable(): void {
		// Only update values, not structure or expanded/collapsed state
		const obj = $.get(this.objectId);
		if (!obj) {
			// this.contentDiv.textContent = 'Object not found.';
			// TODO: Update the dialog titleSpan to indicate that the object is currently not available
			return; // Object might have been deleted or not available yet
		}
		updateObjectTreeValues(this.treeRoot, obj);
		// this.dialog.updateSize();
	}
	public frameUpdate(): void {
		this.renderTable();
	}
	public close(): void {
		this.dialog.close();
		ObjectPropertyDialog.openDialogs.delete(this.objectId);
	}
	public static refreshAll(): void {
		for (const [id, dlg] of Array.from(this.openDialogs.entries())) {
			if (!dlg.dialog.getDialogElement().parentElement) {
				this.openDialogs.delete(id);
			} else {
				dlg.frameUpdate();
			}
		}
	}
	public static openDialogById(objectId: string, title?: string, ignoreProps?: string[]): ObjectPropertyDialog {
		let dlg = this.openDialogs.get(objectId);
		if (!dlg) {
			dlg = new ObjectPropertyDialog(objectId, title || `Object [${objectId}]`, ignoreProps);
		} else {
			dlg.dialog.minimize();
		}
		return dlg;
	}
}

export function refreshAllObjectPropertyDialogs() {
	ObjectPropertyDialog.refreshAll();
}
export function openObjectPropertyDialogById(objId: string, objName: string, ignoreProps?: string[]) {
	return ObjectPropertyDialog.openDialogById(objId, objName, ignoreProps);
}
