import { GameObject, newArea, newPoint } from './bmsx';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let draggedObj: GameObject;
let dragSrcEl: HTMLElement;
let shiftX: number;
let shiftY: number;

export function handleDebugMouseDown(e: MouseEvent): void {
	if (!e.shiftKey) return; // Only start dragging when shift is pressed

	if (!draggedObj) {
		let gameobject_at_cursor = getGameObjectAtCursor(e);
		if (gameobject_at_cursor) {
			startDragGameObject(gameobject_at_cursor);
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
			draggedObj.pos.x = Math.trunc(x);
			draggedObj.pos.y = Math.trunc(y);
		}
	}
}

export function handleDebugMouseDragEnd(e: MouseEvent): void {
	if (e.button !== 0) return; // Only stop dragging when primary button is released

	if (draggedObj) {
		// let x = e.offsetX / global.view.scale;
		// let y = e.offsetY / global.view.scale;

		// if (draggedObj.pos) {
		// 	draggedObj.pos.x = x;
		// 	draggedObj.pos.y = y;
		// }

		draggedObj = null;
	}
}

export function handleDebugMouseOut(e: MouseEvent): void {
	if (draggedObj) {
		draggedObj = null;
	}
}

function startDragGameObject(gameobject_at_cursor: GameObject): void {
	draggedObj = gameobject_at_cursor;
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

export function handleDebugClick(e: MouseEvent): void {
	if (e.button === 0 && !e.shiftKey) { // Only open when main button is clicked
		let gameobject_at_cursor = getGameObjectAtCursor(e);

		if (gameobject_at_cursor) {
			global.game.paused = true; // Pause the game automatically if an object was found at this location

			const newDiv = document.createElement('div');
			newDiv.className = 'modal-dialog';
			newDiv.id = DEBUG_ELEMENT_ID;
			newDiv.draggable = true;

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

			newDiv.onmousedown = dialogMouseDownHandler;
			newDiv.ondragstart = dialogDragStartHandler;
			newDiv.ondragend = dialogDragEndHandler;
			newDiv.ondrop = dialogDropHandler;

			const closeSpan = document.createElement('span');
			closeSpan.className = 'modal-close';
			closeSpan.innerHTML = '&times;';
			closeSpan.onclick = (e) => {
				e.preventDefault();
				document.body.removeChild(newDiv);
			};

			const contentDiv = document.createElement('div');
			contentDiv.className = 'modal-content';

			newDiv.insertBefore(closeSpan, null);
			newDiv.insertBefore(contentDiv, null);

			// function checkNested(obj, level, ...rest) {
			// 	if (obj === undefined) return false;
			// 	if (rest.length == 0 && obj.hasOwnProperty(level)) return true;
			// 	return checkNested(obj[level], ...rest);
			// }

			function addContent(addContentTo: HTMLElement, elementType: keyof HTMLElementTagNameMap, content: string): HTMLElement {
				let newElement = document.createElement(elementType);
				content && (newElement.innerHTML = content);
				addContentTo.insertBefore(newElement, null);

				return newElement;
			}

			function addElement(addElementTo: HTMLElement, contentAsElement: HTMLElement) {
				addElementTo.insertBefore(contentAsElement, null);
			}

			function addTableForObject(addContentTo: HTMLElement, obj: Object): HTMLElement {
				let table = addContent(contentDiv, 'table', null);
				let headerRow = addContent(table, 'tr', null);
				addContent(headerRow, 'th', 'Prop');
				addContent(headerRow, 'th', 'Value');
				for (const [key, value] of Object.entries(obj)) {
					let row = addContent(table, 'tr', null);
					addContent(row, 'td', `${key}`);
					let type = typeof value;
					if (type === 'object') {
						addElement(row, addTableForObject(row, value));
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
												case 'boolean': convertedNewValue = (newValue.toLowerCase() === 'true'); break;
												case 'bigint': convertedNewValue = BigInt(newValue); break;
												case 'number': convertedNewValue = Number(newValue); break;
												// case 'function':
												// 	let stringToEval = `() => { eval('${newValue}').call(obj); }`;
												// 	convertedNewValue = eval(stringToEval);
												// 	break;
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

						// valueCell.contentEditable = 'true';
					}
				}

				return table;
			}

			addTableForObject(contentDiv, gameobject_at_cursor);

			document.body.insertBefore(newDiv, null);
		}
	}
	// else {
	// 	console.log(`Debugger - No object @${x}, ${y}.`);
	// }
}

function getGameObjectAtCursor(e: MouseEvent) {
	let x = e.offsetX;// / global.view.scale;
	let y = e.offsetY;// / global.view.scale;
	let p = newPoint(x, y);

	return global.model.objects.find(o => o.hitarea && o.insideScaled(p));
}
