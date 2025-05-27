// Object Property Dialog (harmonica/accordion UI) extracted from bmsxdebugger.ts
// Provides: createObjectTableElement, harmonicaExpandedStateById, harmonicaExpandedState, etc.

import { Serializer } from '../gameserializer';

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
    if (expanded) {
        set.add(path);
        set.delete('!' + path);
    } else {
        set.delete(path);
        set.add('!' + path);
    }
    const key = getObjectAccordionKey(obj, objName);
    harmonicaExpandedStateById.set(key, set);
}

const OBJECT_TABLE_PROPS_TO_REDIRECT_NAMES = ['state', 'objects', 'spaces'];
const OBJECT_TABLE_REDIRECT_BY_INNER_OBJECT = true;

function shouldPropertyBeExcluded(propName: string, parent_obj: Object): boolean {
    let parent_obj_name = parent_obj?.constructor?.name;
    if (!parent_obj_name || !propName) return false;
    let exclude = Serializer.excludedProperties[parent_obj_name]?.[propName];
    return exclude ?? false;
}

function shouldPropertyValueBeRedirectedToSubDialog(propName: string, propValue: any): boolean {
    if (OBJECT_TABLE_REDIRECT_BY_INNER_OBJECT) {
        let valuesInSubobject = Object.values(propValue);
        return valuesInSubobject.some((v: any) => typeof v === 'object');
    } else {
        return OBJECT_TABLE_PROPS_TO_REDIRECT_NAMES.some(p => p == propName);
    }
}

function addContent(parent: HTMLElement, type: string, content: string | null, depth: number = 0): HTMLElement {
    let element = document.createElement(type);
    if (content !== null) {
        element.textContent = content;
    }
    for (let i = 0; i < depth; i++) {
        let spacer = document.createElement('td');
        parent.appendChild(spacer);
    }
    parent.appendChild(element);
    return element;
}

export function createObjectTableElement(dialog: HTMLElement, addContentTo: HTMLElement, obj: Object, objName: string, ignoreProps?: string[], parentPath: string = ''): HTMLElement {
    const table = addContent(addContentTo, 'table', null) as HTMLTableElement;
    table.classList.add('object-table');

    function addTableRowForProperty(key: string, value: any, parent_obj: Object, path: string, depth: number): void {
        const row = addContent(table, 'tr', null);
        for (let i = 0; i < depth; i++) {
            const spacer = document.createElement('td');
            spacer.className = 'accordion-spacer';
            row.appendChild(spacer);
        }
        let type = typeof value;
        let isObj = type === 'object' && value !== null;
        let isExpandable = isObj && Object.keys(value).length > 0 && !shouldPropertyValueBeRedirectedToSubDialog(key, value) && !shouldPropertyBeExcluded(key, parent_obj);
        let toggleCell = document.createElement('td');
        if (isExpandable) {
            const expanded = isExpanded(obj, objName, path, depth);
            const toggle = document.createElement('span');
            toggle.className = 'accordion-toggle';
            toggle.textContent = expanded ? '▼' : '▶';
            toggle.style.cursor = 'pointer';
            toggle.onclick = (e) => {
                setExpanded(obj, objName, path, !expanded, depth);
                while (addContentTo.firstChild) addContentTo.removeChild(addContentTo.firstChild);
                createObjectTableElement(dialog, addContentTo, obj, objName, ignoreProps, parentPath);
            };
            toggleCell.appendChild(toggle);
        } else {
            toggleCell.textContent = '';
        }
        row.appendChild(toggleCell);
        const keyCell = document.createElement('td');
        keyCell.textContent = key;
        row.appendChild(keyCell);
        let valueCell: HTMLElement;
        if (isObj) {
            let newObjName = `${objName}.${key}`;
            if (value === undefined || value === null) {
                valueCell = addContent(row, 'td', value === undefined ? 'undefined' : 'null');
                valueCell.classList.add('empty-propvalue');
            } else if (shouldPropertyBeExcluded(key, parent_obj)) {
                valueCell = addContent(row, 'td', 'Excluded!');
                valueCell.classList.add('excluded-propvalue');
            } else if (shouldPropertyValueBeRedirectedToSubDialog(key, value)) {
                valueCell = addContent(row, 'td', `< ... >`);
                valueCell.classList.add('redirected-propvalue');
                valueCell.onclick = (_e) => {
                    // You may want to import createDebugDialog from bmsxdebugger.ts if needed
                };
            } else if (isExpandable) {
                valueCell = addContent(row, 'td', isExpanded(obj, objName, path, depth) ? '' : '[...]');
                valueCell.classList.add('expandable-propvalue');
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
        if (isObj && isExpandable && isExpanded(obj, objName, path, depth)) {
            const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value).sort();
            for (const subkey of keys) {
                addTableRowForProperty(String(subkey), value[subkey], value, path + '.' + subkey, depth + 1);
            }
        }
    }

    if (!Array.isArray(obj)) {
        for (const [key, value] of Object.entries(obj).sort()) {
            if (ignoreProps && ignoreProps.length > 0) {
                if (ignoreProps.includes(key)) continue;
            }
            addTableRowForProperty(key, value, obj, parentPath ? parentPath + '.' + key : key, 0);
        }
    } else {
        let arr = obj as [];
        for (let i = 0; i < arr.length; i++) {
            addTableRowForProperty(`${i}`, arr[i], obj, parentPath ? parentPath + '.' + i : String(i), 0);
        }
    }
    return table;
}
