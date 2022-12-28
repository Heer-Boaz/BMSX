import { MachineDefinitions } from './bfsm';
import { area2size, copy_vec2, new_vec2, vec3, vec2_translate, trunc_vec2, vec2 } from './bmsx';
import { GameObject } from './gameobject';
import { Serializer } from './gamereviver';
import { SpriteObject } from './sprite';
import { Color, paintImage } from './view';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let draggedObj: GameObject | null;
let draggedObjCursorOffset: vec2;
let dragSrcEl: HTMLElement;
let shiftX: number;
let shiftY: number;
let prevPausedState: boolean; // Remember the paused-state before a dialog was opened. This allows to return to the original "paused" state after closing debug dialogs

class ObjectHighlighter extends SpriteObject {
    #highlighted_obj: GameObject;
    static readonly #mijnkleur: Color = { r: 0, g: 0, b: 1, a: .5 };

    public constructor() {
        super('debug_highlighter');
        this.imgid = 'whitepixel'; // ! FIXME: HARDCODED
        this.visible = false;
        this.#highlighted_obj = null;
        this.z = Math.pow(10, 9);
        this.sprite.colorize = ObjectHighlighter.#mijnkleur;
    }

    public get target() {
        return this.#highlighted_obj;
    }

    public set target(o: GameObject) {
        if (!o) {
            this.#highlighted_obj = null;
            this.x = this.y = this.sx = this.sy = 0;
            this.visible = false;
            return;
        }

        this.#highlighted_obj = o;
        if (o.hitarea) {
            this.pos = vec2_translate(o.pos, o.hitarea.start);
            this.size = area2size(o.hitarea);
        }
        else {
            this.pos = copy_vec2(o.pos);
            this.size = copy_vec2(o.size);
        }
        // this.size = divPoint(this.size, 4);
        this.pos = trunc_vec2(this.pos);
        this.size = trunc_vec2(this.size);
        this.sprite.sx = this.size.x + 1;
        this.sprite.sy = this.size.y + 1;
        this.visible = true;
    }
}

export function handleDebugMouseDown(e: MouseEvent): void {
    if (!e.shiftKey) return; // Only start dragging when shift is pressed

    if (!draggedObj) {
        let { objUnderCursor, offsetToCursor } = getGameObjectAtCursor(e);
        if (objUnderCursor && offsetToCursor) {
            startDragGameObject(objUnderCursor!, offsetToCursor!);
        }
    }
    else {
        handleDebugMouseMove(e);
    }
}

export function handleDebugMouseMove(e: MouseEvent): void {
    if (draggedObj) {
        // Drag dragged object around
        let x = e.offsetX / global.view.scale;
        let y = e.offsetY / global.view.scale;

        if (draggedObj.pos) {
            draggedObj.pos.x = Math.trunc(x) - draggedObjCursorOffset.x;
            draggedObj.pos.y = Math.trunc(y) - draggedObjCursorOffset.y;
        }
    }
    else {
        // Highlight mouse-overed objects
        let { objUnderCursor, offsetToCursor } = getGameObjectAtCursor(e);
        highlight_object(objUnderCursor);

    }
}

function highlight_object(o: GameObject) {
    let model = global.model;
    let highlighter = model.get<ObjectHighlighter>('debug_highlighter');
    if (o) {
        if (!highlighter) {
            highlighter = new ObjectHighlighter();
            model.spawn(highlighter);
        }
        else if (!model.is_obj_in_current_space('debug_highlighter')) {
            model.move_obj_to_space('debug_highlighter', model.current_space_id);
        }
        highlighter.target = o;
    }
    else {
        highlighter && (highlighter.target = null);
    }

}

export function handleDebugMouseDragEnd(e: MouseEvent): void {
    if (e.button !== 0) return; // Only stop dragging when primary button is released
    draggedObj = null;
}

export function handleDebugMouseOut(e: MouseEvent): void {
    draggedObj = null;
}

function startDragGameObject(gameobject_at_cursor: GameObject, offsetToCursor: vec2): void {
    draggedObj = gameobject_at_cursor;
    draggedObjCursorOffset = new_vec2(Math.trunc(offsetToCursor.x), Math.trunc(offsetToCursor.y));
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

function addContent(addContentTo: HTMLElement, elementType: keyof HTMLElementTagNameMap, content: string | null): HTMLElement {
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

    function addTableRowForProperty(key: string, value: any, parent_obj: Object): void {
        let row = addContent(table, 'tr', null);
        addContent(row, 'td', `${key}`);
        let type = typeof value;
        if (type === 'object') {
            let newObjName = `${objName}.${key}`;
            if (!value) {
                let valueCell = addContent(row, 'td', value === undefined ? 'undefined' : 'null');
                valueCell.classList.add('empty-propvalue');
            }
            else if (shouldPropertyBeExcluded(key, parent_obj)) {
                let valueCell = addContent(row, 'td', 'Excluded!');
                valueCell.classList.add('excluded-propvalue');
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
                if (Object.keys(value)?.length ?? 0 > 0) {
                    addElement(row, createObjectTableElement(dialog, row, value, newObjName, ignoreProps));
                }
                else {
                    let valueCell = addContent(row, 'td', 'Empty like your ❤️');
                    valueCell.classList.add('empty-propvalue');
                }
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
                case 'undefined':
                    if (type === 'undefined') {
                        valueCell.classList.add('undefined-propvalue');
                    }
                    else {
                        valueCell.classList.add('propvalue');
                    }
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

            addTableRowForProperty(key, value, obj);
        }
    }
    else {
        let arr = obj as [];
        for (let i = 0; i < arr.length; i++) {
            addTableRowForProperty(`${i}`, arr[i], obj);
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

function createDebugDialog(title?: string, previousDialog?: HTMLElement): [dialogDiv: HTMLDivElement, contentDiv: HTMLDivElement] {
    const theDialogDiv = document.createElement('div');
    theDialogDiv.className = 'modal-dialog';
    theDialogDiv.id = DEBUG_ELEMENT_ID;
    theDialogDiv.draggable = true;
    if (previousDialog) {
        previousDialog.style.display = 'none';
        (theDialogDiv as any).previous = previousDialog;
    }

    function dialogMouseDownHandler(this: typeof theDialogDiv, ev: MouseEvent) {
        shiftX = ev.clientX - this.getBoundingClientRect().left;
        shiftY = ev.clientY - this.getBoundingClientRect().top;
    };

    function dialogDragStartHandler(this: typeof theDialogDiv, ev: DragEvent) {
        dragSrcEl = this;

        ev.dataTransfer!.effectAllowed = 'move';
        ev.dataTransfer!.setData('text/html', this.innerHTML);
    };

    function dialogDragEndHandler(this: typeof theDialogDiv, ev: DragEvent) {
        this.style.left = ev.pageX - shiftX + 'px';
        this.style.top = ev.pageY - shiftY + 'px';
    };

    function dialogDropHandler(this: typeof theDialogDiv, ev: DragEvent) {
        ev.stopPropagation();

        if (dragSrcEl !== this) {
            dragSrcEl.innerHTML = this.innerHTML;
            this.innerHTML = ev.dataTransfer!.getData('text/html');
        }

        return false;
    };

    theDialogDiv.onmousedown = dialogMouseDownHandler as (this: GlobalEventHandlers, ev: MouseEvent) => any;
    theDialogDiv.ondragstart = dialogDragStartHandler as (this: GlobalEventHandlers, ev: DragEvent) => any;
    theDialogDiv.ondragend = dialogDragEndHandler as (this: GlobalEventHandlers, ev: DragEvent) => any;
    theDialogDiv.ondrop = dialogDropHandler as (this: GlobalEventHandlers, ev: DragEvent) => any;

    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'modal-title-wrapper';
    wrapperDiv.ondblclick = (e) => {
        toggleFullscreenOnElement(theDialogDiv);
    };

    const titleSpan = document.createElement('span');
    titleSpan.className = 'modal-title';
    title && (titleSpan.innerHTML = title);

    let backSpan: HTMLSpanElement | undefined = undefined;
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

export function handleOpenObjectMenu(e: UIEvent | null, previous?: HTMLElement): void {
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
        row.onmouseenter = (_) => {
            highlight_object(o);
        };
        row.onmouseleave = (_) => {
            highlight_object(null);
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

export function handleOpenModelMenu(e: UIEvent | null, previous: HTMLElement): void {
    if (e && e.type !== 'keydown') return;
    if (!previous) {
        prevPausedState = global.game.paused; // Remember the original paused-state so that we can return to that state
        global.game.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
        draggedObj = null; // Make sure that we stop dragging any object
    }

    openObjectDetailMenu(global.model, 'The Model', previous);
}

function openObjectDetailMenu(obj: any, title: string, previous?: HTMLElement): void {
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
            openObjectDetailMenu(objUnderCursor, objUnderCursor.id);
        }
    }
}

function getGameObjectAtCursor(e: MouseEvent): { objUnderCursor: GameObject | null; offsetToCursor: vec2 | null; } {
    let x = e.offsetX;
    let y = e.offsetY;
    let p = new_vec2(x, y);

    let objsUnderCursor: GameObject[] = global.model.objects.filter(o => o.id !== 'debug_highlighter' && o.insideScaled(p));
    if (objsUnderCursor && objsUnderCursor.length > 0) {
        // Choose obj with highest z-value
        let objUnderCursorWithHighestZ = objsUnderCursor.reduce((o1, o2) => o1.z > o2.z ? o1 : o2);
        return { objUnderCursor: objUnderCursorWithHighestZ, offsetToCursor: objUnderCursorWithHighestZ.insideScaled(p) };
    }
    return { objUnderCursor: null, offsetToCursor: null };;
}
