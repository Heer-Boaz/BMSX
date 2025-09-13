import { $ } from '../core/game';
import { Serializer } from '../serializer/gameserializer';
import { FloatingDialog } from './bmsxdebugger';

// --- Accordion/Harmonica state for property expansion ---
// Key: object id (string) -> Set of expanded property paths
export const harmonicaExpandedStateById: Map<string, Set<string>> = new Map();
// Key: object instance -> Set of expanded property paths (for current dialog instance)
export const harmonicaExpandedState = new WeakMap<object, Set<string>>();

function getObjectAccordionKey(obj: any, objName: string): string {
	return (obj && obj.id != null) ? String(obj.id) : objName;
}

function getAccordionSet(obj: any, objName: string): Set<string> {
	let set = harmonicaExpandedState.get(obj);
	if (!set) {
		const key = getObjectAccordionKey(obj, objName);
		set = harmonicaExpandedStateById.get(key);
		if (!set) set = new Set();
		harmonicaExpandedState.set(obj, set);
	}
	return set;
}

function isExpanded(obj: any, objName: string, path: string, depth: number): boolean {
	const set = getAccordionSet(obj, objName);
	if (set.has(path)) return true;
	if (depth <= 1 && !set.has('!' + path)) return true;
	return false;
}

function setExpanded(obj: any, objName: string, path: string, expanded: boolean, depth: number) {
	const set = getAccordionSet(obj, objName);
	// Use depth to control expansion behavior
	if (depth > 1) {
		if (expanded) {
			set.add(path);
			set.delete('!' + path);
		} else {
			set.delete(path);
			set.add('!' + path);
		}
	} else {
		if (expanded) {
			set.add(path);
		} else {
			set.delete(path);
		}
	}

	const key = getObjectAccordionKey(obj, objName);
	harmonicaExpandedStateById.set(key, set);
}

function shouldPropertyBeExcluded(propName: string, parent_obj: Object): boolean {
	let parent_obj_name = parent_obj?.constructor?.name;
	if (!parent_obj_name || !propName) return false;
	let exclude = Serializer.excludedProperties[parent_obj_name]?.[propName];
	return exclude ?? false;
}

function addContent(parent: HTMLElement, type: string, content: string | null, depth: number = 0): HTMLElement {
	const element = document.createElement(type);
	if (content !== null) element.textContent = content;
	for (let i = 0; i < depth; i++) {
		const spacer = document.createElement('td');
		parent.appendChild(spacer);
	}
	parent.appendChild(element);
	return element;
}

// --- Heuristic: use horizontal harmonica for small objects/arrays, vertical for large ---
function useHorizontalHarmonica(value: any): boolean {
	if (Array.isArray(value)) return value.length > 0 && value.length <= 4;
	if (typeof value === 'object' && value !== null) {
		const keys = Object.keys(value);
		return keys.length > 0 && keys.length <= 4;
	}
	return false;
}

export function createObjectTableElement(
	dialog: HTMLElement,
	addContentTo: HTMLElement,
	obj: any,
	objName: string,
	ignoreProps?: string[],
	parentPath: string = '',
	depth: number = 0
): HTMLElement {
	addContentTo.classList.add('object-dialog-scrollable');
	const table = addContent(addContentTo, 'table', null) as HTMLTableElement;
	table.classList.add('object-table');

	function addTableRowForProperty(key: string, value: any, parent_obj: any, path: string, depth: number): void {
		const row = addContent(table, 'tr', null);
		for (let i = 0; i < depth; i++) {
			const spacer = document.createElement('td');
			spacer.className = 'accordion-spacer';
			row.appendChild(spacer);
		}
		const type = typeof value;
		const isObj = type === 'object' && value !== null;
		const isExpandable = isObj && Object.keys(value).length > 0 && !shouldPropertyBeExcluded(key, parent_obj);
		// Collapse by default if depth > 0 or object is large
		const expanded = isExpandable ? isExpanded(obj, objName, path, depth) : false;
		const useHorizontal = isExpandable && useHorizontalHarmonica(value);

		// Accordion toggle
		const toggleCell = document.createElement('td');
		if (isExpandable) {
			const toggle = document.createElement('span');
			toggle.className = 'accordion-toggle';
			toggle.textContent = expanded ? '▼' : '▶';
			toggle.style.cursor = 'pointer';
			toggle.onclick = () => {
				setExpanded(obj, objName, path, !expanded, depth);
				while (addContentTo.firstChild) addContentTo.removeChild(addContentTo.firstChild);
				createObjectTableElement(dialog, addContentTo, obj, objName, ignoreProps, parentPath, depth);
			};
			toggleCell.appendChild(toggle);
		} else {
			toggleCell.textContent = '';
		}
		row.appendChild(toggleCell);

		// Property key
		const keyCell = document.createElement('td');
		keyCell.textContent = key;
		row.appendChild(keyCell);

		// Property value
		let valueCell: HTMLElement;
		if (isObj) {
			if (value === undefined || value === null) {
				valueCell = addContent(row, 'td', value === undefined ? 'undefined' : 'null');
				valueCell.classList.add('empty-propvalue');
			} else if (shouldPropertyBeExcluded(key, parent_obj)) {
				valueCell = addContent(row, 'td', 'Excluded!');
				valueCell.classList.add('excluded-propvalue');
			} else if (isExpandable) {
				if (useHorizontal) {
					valueCell = addContent(row, 'td', expanded ? '' : '[...]');
					valueCell.classList.add('expandable-propvalue');
					if (expanded) {
						const nestedDiv = document.createElement('div');
						nestedDiv.className = 'horizontal-harmonica';
						createObjectTableElement(dialog, nestedDiv, value, objName + '.' + key, ignoreProps, path, depth + 1);
						valueCell.appendChild(nestedDiv);
					}
				} else {
					valueCell = addContent(row, 'td', '[...]');
					valueCell.classList.add('expandable-propvalue');
					// If expanded, add a new row below for the nested table (vertical harmonica)
					if (expanded) {
						const verticalRow = document.createElement('tr');
						verticalRow.className = 'vertical-harmonica-row';
						// Spacer cells to align
						for (let i = 0; i < depth + 2; i++) {
							verticalRow.appendChild(document.createElement('td'));
						}
						const nestedCell = document.createElement('td');
						nestedCell.colSpan = 2;
						nestedCell.style.padding = '0';
						nestedCell.style.background = '#23232a';
						const nestedDiv = document.createElement('div');
						nestedDiv.className = 'object-dialog-scrollable';
						createObjectTableElement(dialog, nestedDiv, value, objName + '.' + key, ignoreProps, path, depth + 1);
						nestedCell.appendChild(nestedDiv);
						verticalRow.appendChild(nestedCell);
						table.appendChild(verticalRow);
					}
				}
			} else {
				valueCell = addContent(row, 'td', 'Empty');
				valueCell.classList.add('empty-propvalue');
			}
		} else {
			let currentValueAsString = String(value);
			if (type === 'boolean') {
				valueCell = document.createElement('td');
				valueCell.classList.add('propvalue');
				const selectElement = document.createElement('select');
				const trueOption = document.createElement('option');
				trueOption.value = 'true';
				trueOption.textContent = 'true';
				const falseOption = document.createElement('option');
				falseOption.value = 'false';
				falseOption.textContent = 'false';
				selectElement.appendChild(trueOption);
				selectElement.appendChild(falseOption);
				selectElement.value = currentValueAsString;
				selectElement.onchange = () => {
					const newValue = selectElement.value;
					if (newValue !== currentValueAsString) {
						parent_obj[key] = newValue === 'true';
						valueCell.classList.remove('propvalue');
						valueCell.classList.add('mutated-propvalue');
					} else {
						parent_obj[key] = value;
						valueCell.classList.remove('mutated-propvalue');
						valueCell.classList.add('propvalue');
					}
				};
				valueCell.appendChild(selectElement);
				row.appendChild(valueCell);
			} else if (type === 'string' || type === 'number' || type === 'bigint') {
				valueCell = addContent(row, 'td', `${currentValueAsString}`);
				valueCell.contentEditable = 'true';
				valueCell.classList.add('propvalue');
				valueCell.onblur = () => {
					let newValue = valueCell.innerText;
					if (newValue !== currentValueAsString) {
						try {
							let convertedNewValue: any = null;
							switch (type) {
								case 'string': convertedNewValue = newValue; break;
								case 'bigint': convertedNewValue = BigInt(newValue); break;
								case 'number': convertedNewValue = Number(newValue); break;
								default: console.warn(`Property ${key} cannot be updated, because Boaz still needs to develop an update solution for type '${type}'.`);
							}
							if (convertedNewValue !== null) {
								if (convertedNewValue !== value) {
									parent_obj[key] = convertedNewValue;
									valueCell.classList.remove('propvalue');
									valueCell.classList.add('mutated-propvalue');
									currentValueAsString = newValue;
								} else {
									parent_obj[key] = value;
									valueCell.classList.remove('mutated-propvalue');
									valueCell.classList.add('propvalue');
								}
							}
						} catch (e) {
							console.warn(`Updating property ${key} to value '${newValue}' (type '${type}') failed.`);
						}
					}
				};
			} else {
				valueCell = addContent(row, 'td', `${currentValueAsString}`);
				valueCell.classList.add('immutable-propvalue');
			}
		}
		row.appendChild(valueCell);
	}

	if (!Array.isArray(obj)) {
		for (const [key, value] of Object.entries(obj).sort()) {
			if (ignoreProps && ignoreProps.length > 0 && ignoreProps.includes(key)) continue;
			addTableRowForProperty(key, value, obj, parentPath ? parentPath + '.' + key : key, depth);
		}
	} else {
		for (let i = 0; i < obj.length; i++) {
			addTableRowForProperty(`${i}`, obj[i], obj, parentPath ? parentPath + '.' + i : String(i), depth);
		}
	}
	return table;
}

export class ObjectPropertyDialogOld {
	private static openDialogs: Map<string, ObjectPropertyDialogOld> = new Map();
	private dialog: FloatingDialog;
	private objectId: string;
	private title: string;
	private ignoreProps?: string[];
	private contentDiv: HTMLElement;
	private tableRoot: HTMLTableElement | null = null;
	private valueCellMap: Map<string, HTMLElement> = new Map(); // path -> cell
	private lastKeys: string[] = [];

	constructor(objectId: string, title: string, ignoreProps?: string[]) {
		this.objectId = objectId;
		this.title = title;
		this.ignoreProps = ignoreProps;
		this.dialog = new FloatingDialog(title);
		this.contentDiv = this.dialog.getContentElement();
		ObjectPropertyDialogOld.openDialogs.set(objectId, this);
		this.renderTable();
		this.dialog.updateSize();
	}

	private renderTable(): void {
		// Fetch the object by ID from the global model
		const obj = ($.world.activeObjects || []).find((o: any) => String(o.id) === this.objectId);
		if (!obj) {
			this.contentDiv.textContent = 'Object not found.';
			this.tableRoot = null;
			this.valueCellMap.clear();
			return;
		}
		while (this.contentDiv.firstChild) this.contentDiv.removeChild(this.contentDiv.firstChild);
		this.valueCellMap.clear();
		this.tableRoot = document.createElement('table');
		this.tableRoot.className = 'object-table';
		this.contentDiv.appendChild(this.tableRoot);
		this.lastKeys = [];
		this.buildTableRows(obj, this.title, '', 0);
		// Snapshot removed (unused)
	}

	private buildTableRows(obj: any, objName: string, parentPath: string, depth: number): void {
		if (!Array.isArray(obj)) {
			for (const [key, value] of Object.entries(obj).sort()) {
				if (this.ignoreProps && this.ignoreProps.length > 0 && this.ignoreProps.includes(key)) continue;
				const path = parentPath ? parentPath + '.' + key : key;
				this.addTableRow(key, value, obj, objName, path, depth);
				this.lastKeys.push(path);
			}
		} else {
			for (let i = 0; i < obj.length; i++) {
				const path = parentPath ? parentPath + '.' + i : String(i);
				this.addTableRow(`${i}`, obj[i], obj, objName, path, depth);
				this.lastKeys.push(path);
			}
		}
	}

	private addTableRow(key: string, value: any, parent_obj: any, objName: string, path: string, depth: number): void {
		const row = document.createElement('tr');
		for (let i = 0; i < depth; i++) {
			const spacer = document.createElement('td');
			spacer.className = 'accordion-spacer';
			row.appendChild(spacer);
		}
		const type = typeof value;
		const isObj = type === 'object' && value !== null;
		const isExpandable = isObj && Object.keys(value).length > 0 && !shouldPropertyBeExcluded(key, parent_obj);
		const expanded = isExpandable ? isExpanded(parent_obj, objName, path, depth) : false;
		const useHorizontal = isExpandable && useHorizontalHarmonica(value);

		// Accordion toggle
		const toggleCell = document.createElement('td');
		if (isExpandable) {
			const toggle = document.createElement('span');
			toggle.className = 'accordion-toggle';
			toggle.textContent = expanded ? '▼' : '▶';
			toggle.style.cursor = 'pointer';
			toggle.onclick = () => {
				setExpanded(parent_obj, objName, path, !expanded, depth);
				this.renderTable(); // Only rebuild on toggle
			};
			toggleCell.appendChild(toggle);
		} else {
			toggleCell.textContent = '';
		}
		row.appendChild(toggleCell);

		// Property key
		const keyCell = document.createElement('td');
		keyCell.textContent = key;
		row.appendChild(keyCell);

		// Property value
		let valueCell: HTMLElement;
		if (isObj) {
			if (value === undefined || value === null) {
				valueCell = document.createElement('td');
				valueCell.textContent = value === undefined ? 'undefined' : 'null';
				valueCell.classList.add('empty-propvalue');
			} else if (shouldPropertyBeExcluded(key, parent_obj)) {
				valueCell = document.createElement('td');
				valueCell.textContent = 'Excluded!';
				valueCell.classList.add('excluded-propvalue');
			} else if (isExpandable) {
				if (useHorizontal) {
					valueCell = document.createElement('td');
					valueCell.classList.add('expandable-propvalue');
					if (expanded) {
						const nestedDiv = document.createElement('div');
						nestedDiv.className = 'horizontal-harmonica';
						// Recursively build nested table
						this.buildTableRows(value, objName + '.' + key, path, depth + 1);
						valueCell.appendChild(nestedDiv);
					} else {
						valueCell.textContent = '[...]';
					}
				} else {
					valueCell = document.createElement('td');
					valueCell.classList.add('expandable-propvalue');
					valueCell.textContent = '[...]';
				}
			} else {
				valueCell = document.createElement('td');
				valueCell.textContent = 'Empty';
				valueCell.classList.add('empty-propvalue');
			}
		} else {
			let currentValueAsString = String(value);
			valueCell = document.createElement('td');
			if (type === 'boolean') {
				valueCell.classList.add('propvalue');
				const selectElement = document.createElement('select');
				const trueOption = document.createElement('option');
				trueOption.value = 'true';
				trueOption.textContent = 'true';
				const falseOption = document.createElement('option');
				falseOption.value = 'false';
				falseOption.textContent = 'false';
				selectElement.appendChild(trueOption);
				selectElement.appendChild(falseOption);
				selectElement.value = currentValueAsString;
				selectElement.onchange = () => {
					const newValue = selectElement.value;
					if (newValue !== currentValueAsString) {
						parent_obj[key] = newValue === 'true';
						valueCell.classList.remove('propvalue');
						valueCell.classList.add('mutated-propvalue');
					} else {
						parent_obj[key] = value;
						valueCell.classList.remove('mutated-propvalue');
						valueCell.classList.add('propvalue');
					}
				};
				valueCell.appendChild(selectElement);
			} else if (type === 'string' || type === 'number' || type === 'bigint') {
				valueCell.classList.add('propvalue');
				valueCell.contentEditable = 'true';
				valueCell.textContent = currentValueAsString;
				valueCell.onblur = () => {
					let newValue = valueCell.innerText;
					if (newValue !== currentValueAsString) {
						try {
							let convertedNewValue: any = null;
							switch (type) {
								case 'string': convertedNewValue = newValue; break;
								case 'bigint': convertedNewValue = BigInt(newValue); break;
								case 'number': convertedNewValue = Number(newValue); break;
								default: console.warn(`Property ${key} cannot be updated, because Boaz still needs to develop an update solution for type '${type}'.`);
							}
							if (convertedNewValue !== null) {
								if (convertedNewValue !== value) {
									parent_obj[key] = convertedNewValue;
									valueCell.classList.remove('propvalue');
									valueCell.classList.add('mutated-propvalue');
									currentValueAsString = newValue;
								} else {
									parent_obj[key] = value;
									valueCell.classList.remove('mutated-propvalue');
									valueCell.classList.add('propvalue');
								}
							}
						} catch (e) {
							console.warn(`Updating property ${key} to value '${newValue}' (type '${type}') failed.`);
						}
					}
				};
			} else {
				valueCell.classList.add('immutable-propvalue');
				valueCell.textContent = currentValueAsString;
			}
		}
		row.appendChild(valueCell);
		this.valueCellMap.set(path, valueCell);
		this.tableRoot?.appendChild(row);

		// --- Vertical harmonica: insert nested table in a new row immediately after parent row if expanded ---
		if (isObj && isExpandable && !useHorizontal && expanded) {
			const verticalRow = document.createElement('tr');
			// Spacer cells to align
			for (let i = 0; i < depth + 1; i++) {
				verticalRow.appendChild(document.createElement('td'));
			}
			const nestedCell = document.createElement('td');
			nestedCell.colSpan = 2; // key + value columns
			nestedCell.style.padding = '0';
			nestedCell.style.background = '#23232a';
			const nestedTable = document.createElement('table');
			nestedTable.className = 'object-table';
			this.buildTableRows(value, objName + '.' + key, path, depth + 1);
			nestedCell.appendChild(nestedTable);
			verticalRow.appendChild(nestedCell);
			// Insert the verticalRow immediately after the main row
			if (row.parentNode) {
				row.parentNode.insertBefore(verticalRow, row.nextSibling);
			}
		}
	}

	public frameUpdate(): void {
		// Fetch the object by ID from the global model
		const obj = ($.world.activeObjects || []).find((o: any) => String(o.id) === this.objectId);
		if (!obj) {
			this.contentDiv.textContent = 'Object not found.';
			this.tableRoot = null;
			this.valueCellMap.clear();
			return;
		}
		// Only update the value cells, not the table structure
		for (const path of this.lastKeys) {
			const valueCell = this.valueCellMap.get(path);
			if (!valueCell) continue;
			let value: unknown = obj as unknown;
			for (const part of path.split('.')) {
				if (value != null && typeof value === 'object') {
					value = (value as Record<string, unknown>)[part];
				} else {
					value = undefined;
					break;
				}
			}
			const type = typeof value;
			if (type === 'boolean') {
				const select = valueCell.querySelector('select');
				if (select) select.value = String(value);
			} else if (type === 'string' || type === 'number' || type === 'bigint') {
				valueCell.textContent = String(value);
			} else if (type === 'object' && value === null) {
				valueCell.textContent = 'null';
			} else if (type === 'object' && value === undefined) {
				valueCell.textContent = 'undefined';
			} else if (type === 'object') {
				// For objects, do not update cell content (structure is static)
			} else {
				valueCell.textContent = String(value);
			}
		}
		// Do NOT call this.dialog.updateSize() here
	}

	public close(): void {
		this.dialog.close();
		ObjectPropertyDialogOld.openDialogs.delete(this.objectId);
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

	public static openDialogById(objectId: string, title?: string, ignoreProps?: string[]): ObjectPropertyDialogOld {
		let dlg = this.openDialogs.get(objectId);
		if (!dlg) {
			dlg = new ObjectPropertyDialogOld(objectId, title || `Object [${objectId}]`, ignoreProps);
		} else {
			dlg.dialog.minimize();
		}
		return dlg;
	}
}

// Live-refresh all open object property dialogs
// export function refreshAllObjectPropertyDialogs() {
//     ObjectPropertyDialog.refreshAll();
// }

// // Utility to open a property dialog for a given object ID
// export function openObjectPropertyDialogById(objId: string, objName: string, ignoreProps?: string[], parentPath?: string) {
//     return ObjectPropertyDialog.openDialogById(objId, objName, ignoreProps);
// }
