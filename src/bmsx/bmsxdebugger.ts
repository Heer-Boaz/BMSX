import { MachineDefinitions } from './bfsm';
import { GameObject, newPoint, Point } from './bmsx';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let draggedObj: GameObject;
let draggedObjCursorOffset: Point;
let dragSrcEl: HTMLElement;
let shiftX: number;
let shiftY: number;
let prevPausedState: boolean; // Remember the paused-state before a dialog was opened. This allows to return to the original "paused" state after closing debug dialogs

export function handleDebugMouseDown(e: MouseEvent): void {
	if (!e.shiftKey) return; // Only start dragging when shift is pressed

	if (!draggedObj) {
		let { objUnderCursor, offsetToCursor } = getGameObjectAtCursor(e);
		if (objUnderCursor) {
			startDragGameObject(objUnderCursor, offsetToCursor);
		}
	}
	else {
		handleDebugMouseMove(e);
	}
}

export function handleDebugMouseMove(e: MouseEvent): void {
	if (draggedObj) {
		let x = e.offsetX / global.view.scale;
		let y = e.offsetY / global.view.scale;

		if (draggedObj.pos) {
			draggedObj.pos.x = Math.trunc(x) - draggedObjCursorOffset.x;
			draggedObj.pos.y = Math.trunc(y) - draggedObjCursorOffset.y;
		}
	}
}

export function handleDebugMouseDragEnd(e: MouseEvent): void {
	if (e.button !== 0) return; // Only stop dragging when primary button is released
	draggedObj = null;
}

export function handleDebugMouseOut(e: MouseEvent): void {
	draggedObj = null;
}

function startDragGameObject(gameobject_at_cursor: GameObject, offsetToCursor: Point): void {
	draggedObj = gameobject_at_cursor;
	draggedObjCursorOffset = newPoint(Math.trunc(offsetToCursor.x), Math.trunc(offsetToCursor.y));
}

export function handleContextMenu(e: MouseEvent): void {
	e.preventDefault();
	e.stopPropagation();

	if (e.shiftKey) {
		// Unpause game
		global.game.debug_runSingleFrameAndPause = false;
		global.game.paused = false;
	}
	else {
		// Pause game for debugging, and only compute a single frame
		if (global.game.paused) {
			global.game.debug_runSingleFrameAndPause = true;
			global.game.paused = false;
		}
		else {
			global.game.paused = true;
			global.game.debug_runSingleFrameAndPause = false;
		}
	}
}

function addContent(addContentTo: HTMLElement, elementType: keyof HTMLElementTagNameMap, content: string): HTMLElement {
	let newElement = document.createElement(elementType);
	content && (newElement.innerHTML = content);
	addContentTo.insertBefore(newElement, null);

	return newElement;
}

function addElement(addElementTo: HTMLElement, contentAsElement: HTMLElement) {
	addElementTo.insertBefore(contentAsElement, null);
}

const OBJECT_TABLE_PROPS_TO_REDIRECT_NAMES = ['state', 'objects', 'spaces'];
const OBJECT_TABLE_REDIRECT_BY_INNER_OBJECT = false;

function shouldPropertyValueBeRedirectedToSubDialog(propName: string, propValue: any): boolean {
	if (OBJECT_TABLE_REDIRECT_BY_INNER_OBJECT) {
		let valuesInSubobject = Object.values(propValue);
		return valuesInSubobject.some((v: any) => typeof v === 'object');
	}
	else {
		return OBJECT_TABLE_PROPS_TO_REDIRECT_NAMES.some(p => p == propName);
	}
}

function createObjectTableElement(dialog: HTMLElement, addContentTo: HTMLElement, obj: Object, objName: string, ignoreProps?: string[]): HTMLElement {
	let table = addContent(addContentTo, 'table', null);
	let headerRow = addContent(table, 'tr', null);
	addContent(headerRow, 'th', 'Prop');
	addContent(headerRow, 'th', 'Value');

	function addTableRowForProperty(key: string, value: any): void {
		let row = addContent(table, 'tr', null);
		addContent(row, 'td', `${key}`);
		let type = typeof value;
		if (type === 'object') {
			let newObjName = `${objName}.${key}`;
			if (!value) {
				let valueCell = addContent(row, 'td', value === undefined ? 'undefined' : 'null');
				valueCell.classList.add('immutable-propvalue');
			}
			else if (shouldPropertyValueBeRedirectedToSubDialog(key, value)) {
				let valueCell = addContent(row, 'td', `< ... >`);
				valueCell.classList.add('propvalue');
				valueCell.onclick = (e) => {
					const [objDialogDiv, objDialogContentDiv] = createDebugDialog(newObjName, dialog);
					createObjectTableElement(objDialogDiv, objDialogContentDiv, value, newObjName, ignoreProps);
					document.body.insertBefore(objDialogDiv, null);
				};
			}
			else {
				addElement(row, createObjectTableElement(dialog, row, value, newObjName, ignoreProps));
			}
		}
		else {
			let currentValueAsString = String(value);
			let valueCell = addContent(row, 'td', `${currentValueAsString}`);
			switch (type) {
				case 'string':
				case 'boolean':
				case 'bigint':
				case 'number':
					valueCell.classList.add('propvalue');
					valueCell.onclick = (e) => {
						let currentValueAsStringInHandlerScope = String(obj[key]);
						let newValue = prompt(`Edit value for "${key}":`, currentValueAsStringInHandlerScope);
						if (newValue && newValue != currentValueAsStringInHandlerScope) {
							try {
								let convertedNewValue: any = null;
								switch (type) {
									case 'string': convertedNewValue = newValue; break;
									case 'boolean': convertedNewValue = (newValue.toLowerCase() === 'true' || newValue === '1' || newValue.toLowerCase() === 'y'); break;
									case 'bigint': convertedNewValue = BigInt(newValue); break;
									case 'number': convertedNewValue = Number(newValue); break;
									default: console.warn(`Property ${key} cannot be updated, because Boaz still needs to develop an update solution for type '${type}'.`);
								}
								if (convertedNewValue !== null) {
									obj[key] = convertedNewValue;
									valueCell.classList.remove('propvalue');
									valueCell.classList.add('mutated-propvalue');
									valueCell.innerHTML = newValue;
								}
							} catch (e) {
								console.warn(`Updating property ${key} to value '${newValue}' (type '${type}') failed.`);
							}
						}
					};
					break;
				default:
					valueCell.classList.add('immutable-propvalue');
					break;
			}
		}
	}

	if (!Array.isArray(obj)) {
		for (const [key, value] of Object.entries(obj)) {
			if (ignoreProps && ignoreProps.length > 0) {
				if (ignoreProps.includes(key)) continue;
			}

			addTableRowForProperty(key, value);
		}
	}
	else {
		let arr = obj as [];
		for (let i = 0; i < arr.length; i++) {
			addTableRowForProperty(`${i}`, arr[i]);
		}
	}

	return table;
}

function toggleFullscreenOnElement(el: HTMLElement) {
	if (!el.classList.contains('fullscreen')) {
		el.dataset.left = el.style.left;
		el.dataset.top = el.style.top;
		el.style.removeProperty('left');
		el.style.removeProperty('top');
		el.draggable = false;
	}
	else {
		el.dataset.left && (el.style.left = el.dataset.left);
		el.dataset.top && (el.style.top = el.dataset.top);
		el.draggable = true;
	}
	el.classList.toggle('fullscreen');
}

function createDebugDialog(title?: string, previousDialog: HTMLElement = null): [dialogDiv: HTMLDivElement, contentDiv: HTMLDivElement] {
	const theDialogDiv = document.createElement('div');
	theDialogDiv.className = 'modal-dialog';
	theDialogDiv.id = DEBUG_ELEMENT_ID;
	theDialogDiv.draggable = true;
	if (previousDialog) {
		previousDialog.style.display = 'none';
		(theDialogDiv as any).previous = previousDialog;
	}

	function dialogMouseDownHandler(e: MouseEvent) {
		shiftX = e.clientX - this.getBoundingClientRect().left;
		shiftY = e.clientY - this.getBoundingClientRect().top;
	};

	function dialogDragStartHandler(e: DragEvent) {
		dragSrcEl = this;

		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/html', this.innerHTML);
	};

	function dialogDragEndHandler(e: DragEvent) {
		this.style.left = e.pageX - shiftX + 'px';
		this.style.top = e.pageY - shiftY + 'px';
	};

	function dialogDropHandler(e: DragEvent) {
		e.stopPropagation();

		if (dragSrcEl !== this) {
			dragSrcEl.innerHTML = this.innerHTML;
			this.innerHTML = e.dataTransfer.getData('text/html');
		}

		return false;
	};

	theDialogDiv.onmousedown = dialogMouseDownHandler;
	theDialogDiv.ondragstart = dialogDragStartHandler;
	theDialogDiv.ondragend = dialogDragEndHandler;
	theDialogDiv.ondrop = dialogDropHandler;

	const wrapperDiv = document.createElement('div');
	wrapperDiv.className = 'modal-title-wrapper';
	wrapperDiv.ondblclick = (e) => {
		toggleFullscreenOnElement(theDialogDiv);
	};

	const titleSpan = document.createElement('span');
	titleSpan.className = 'modal-title';
	title && (titleSpan.innerHTML = title);

	let backSpan: HTMLSpanElement = null;
	if (previousDialog) {
		backSpan = document.createElement('span');
		backSpan.className = 'modal-back';
		backSpan.innerHTML = '&larr;';
		backSpan.onclick = (e) => {
			e.preventDefault();
			document.body.removeChild(theDialogDiv);
			previousDialog.style.left = theDialogDiv.style.left;
			previousDialog.style.top = theDialogDiv.style.top;
			previousDialog.style.width = theDialogDiv.style.width;
			previousDialog.style.height = theDialogDiv.style.height;
			previousDialog.style.display = 'flex';
			let newDivFullscreen = theDialogDiv.classList.contains('fullscreen');
			let previousDialogFullscreen = previousDialog.classList.contains('fullscreen');
			if (newDivFullscreen != previousDialogFullscreen) {
				toggleFullscreenOnElement(previousDialog);
			}
		};
	}

	const closeSpan = document.createElement('span');
	closeSpan.className = 'modal-close';
	closeSpan.innerHTML = '&times;';
	closeSpan.onclick = (e) => {
		e.preventDefault();
		document.body.removeChild(theDialogDiv);

		let previous = previousDialog;
		while (previous) {
			document.body.removeChild(previous);
			previous = (previous as any).previous;
		}
		global.game.paused = prevPausedState; // Return to the original paused state
	};

	const contentDiv = document.createElement('div');
	contentDiv.className = 'modal-content';

	if (previousDialog) {
		theDialogDiv.style.left = previousDialog.style.left;
		theDialogDiv.style.top = previousDialog.style.top;
		theDialogDiv.style.width = previousDialog.style.width;
		theDialogDiv.style.height = previousDialog.style.height;

		let newDivFullscreen = theDialogDiv.classList.contains('fullscreen');
		let previousDialogFullscreen = previousDialog.classList.contains('fullscreen');
		if (newDivFullscreen != previousDialogFullscreen) {
			toggleFullscreenOnElement(theDialogDiv);
		}
	}

	backSpan && wrapperDiv.insertBefore(backSpan, null);
	wrapperDiv.insertBefore(titleSpan, null);
	wrapperDiv.insertBefore(closeSpan, null);
	theDialogDiv.insertBefore(wrapperDiv, null);
	theDialogDiv.insertBefore(contentDiv, null);

	return [theDialogDiv, contentDiv];
}

export function handleOpenObjectMenu(e: UIEvent, previous: HTMLElement = null): void {
	if (e && e.type !== 'keydown') return;
	if (!previous) {
		prevPausedState = global.game.paused; // Remember the original paused-state so that we can return to that state
		global.game.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
	}

	const [dialogDiv, contentDiv] = createDebugDialog('Objects', previous);

	let table = addContent(contentDiv, 'table', null);
	let headerRow = addContent(table, 'tr', null);
	addContent(headerRow, 'th', 'Type');
	addContent(headerRow, 'th', 'ID');

	global.model.objects.forEach(o => {
		let row = addContent(table, 'tr', null);
		row.classList.add('selectableoption');
		addContent(row, 'td', `${o.constructor.name}`);
		addContent(row, 'td', `${o.id}`);

		row.onclick = (_) => {
			openObjectDetailMenu(o, o.id, dialogDiv);
		};
	});

	document.body.insertBefore(dialogDiv, null);
}

export function handleOpenDebugMenu(e: UIEvent): void {
	if (e && e.type !== 'keydown') return;
	prevPausedState = global.game.paused; // Remember the original paused-state so that we can return to that state
	global.game.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!

	const [dialogDiv, contentDiv] = createDebugDialog();

	let table = addContent(contentDiv, 'table', null);
	let headerRow = addContent(table, 'tr', null);
	let headerElement = addContent(headerRow, 'th', '- Debug menu option - ');
	headerElement.style.textAlign = 'center';

	let row = addContent(table, 'tr', null);
	row.classList.add('selectableoption', 'centered-text');
	addContent(row, 'td', `List model properties`);
	row.onclick = (_) => handleOpenModelMenu(null, dialogDiv);

	row = addContent(table, 'tr', null);
	row.classList.add('selectableoption', 'centered-text');
	addContent(row, 'td', `List all objects in current scene`);
	row.onclick = (_) => handleOpenObjectMenu(null, dialogDiv);

	row = addContent(table, 'tr', null);
	row.classList.add('selectableoption', 'centered-text');
	addContent(row, 'td', `List all statemachine definitions`);
	row.onclick = (_) => openObjectDetailMenu(MachineDefinitions, 'Statemachine definitions', dialogDiv);

	document.body.insertBefore(dialogDiv, null);
}

export function handleOpenModelMenu(e: UIEvent, previous: HTMLElement): void {
	if (e && e.type !== 'keydown') return;
	if (!previous) {
		prevPausedState = global.game.paused; // Remember the original paused-state so that we can return to that state
		global.game.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
		draggedObj = null; // Make sure that we stop dragging any object
	}

	openObjectDetailMenu(global.model, 'The Model', previous);
}

function openObjectDetailMenu(obj: any, title: string, previous: HTMLElement): void {
	if (!previous) {
		prevPausedState = global.game.paused; // Remember the original paused-state so that we can return to that state
		global.game.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
	}

	const [dialogDiv, contentDiv] = createDebugDialog(title, previous);

	createObjectTableElement(dialogDiv, contentDiv, obj, title, ['objects']);
	document.body.insertBefore(dialogDiv, null);

}

export function handleDebugClick(e: MouseEvent): void {
	if (e.button === 0 && !e.shiftKey) { // Only open when main button is clicked
		let { objUnderCursor, offsetToCursor } = getGameObjectAtCursor(e);
		if (objUnderCursor) {
			openObjectDetailMenu(objUnderCursor, objUnderCursor.id, null);
		}
	}
}

function getGameObjectAtCursor(e: MouseEvent): { objUnderCursor: GameObject; offsetToCursor: Point; } {
	let x = e.offsetX;
	let y = e.offsetY;
	let p = newPoint(x, y);

	let objsUnderCursor: GameObject[] = global.model.objects.filter(o => o.hitarea && o.insideScaled(p));
	if (objsUnderCursor && objsUnderCursor.length > 0) {
		// Choose obj with highest z-value
		let objUnderCursorWithHighestZ = objsUnderCursor.reduce((o1, o2) => o1.z > o2.z ? o1 : o2);
		return { objUnderCursor: objUnderCursorWithHighestZ, offsetToCursor: objUnderCursorWithHighestZ.insideScaled(p) };
	}
	return { objUnderCursor: undefined, offsetToCursor: undefined };;
}
