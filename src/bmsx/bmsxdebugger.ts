import { MachineDefinitions, bfsm_controller, statecontext } from './bfsm';
import { area2size, copy_vec2, new_vec2, vec3, translate_vec2, trunc_vec2, vec2, trunc_vec3, div_vec2, set_inplace_vec2, GameObjectId } from './bmsx';
import { PositionUpdateAxisComponent } from './collisioncomponents';
import { Component, ComponentUpdateParams, componenttags_postprocessing } from './component';
import { GameObject } from './gameobject';
import { Serializer } from './gameserializer';
import { SpriteObject } from './sprite';
import { Color } from './view';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let draggedObj: GameObject | null;
let draggedObjCursorOffset: vec2;
let dragSrcEl: HTMLElement;
let shiftX: number;
let shiftY: number;
let prevPausedState: boolean; // Remember the paused-state before a dialog was opened. This allows to return to the original "paused" state after closing debug dialogs

export class DebugHighlightComponent extends PositionUpdateAxisComponent { // Note: MUST export this class, otherwise decorator will cause it to be undefined
    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        super.postprocessingUpdate({ params, returnvalue });
        const highlighter = model.get<ObjectHighlighter>('debug_highlighter');
        if (highlighter) {
            highlighter.setHighlightPos(this.parent);
        }
    }
}

@componenttags_postprocessing('render') // Postprocessing update to render the state machine
export class StateMachineVisualizer extends Component {
    private dialog: FloatingDialog;
    private bfsmController: bfsm_controller;
    private machineElements: Map<string, HTMLElement>;
    private stateElements: Map<string, HTMLElement>;

    constructor(_id: GameObjectId) {
        super(_id);
        this.bfsmController = global.model.get(_id).state;
        this.dialog = new FloatingDialog(`FSM: [${_id}]`);
    }

    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        if (!this.machineElements || !this.stateElements) {
            let _contentDiv: HTMLElement;

            [_contentDiv, this.machineElements, this.stateElements] = visualizeStateMachine(this.dialog.getDialogElement(), this.dialog.getContentElement(), this.bfsmController);
            this.dialog.updateSize();
            this.dialog.minimize(); // Minimize the dialog by default
        }

        // Re-visualize the state machine
        highlightCurrentState(this.stateElements, this.machineElements, this.bfsmController);
    }
}

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

    public setHighlightPos(o: GameObject) {
        if (o.hitarea) {
            let translate = translate_vec2(o.pos, o.hitarea.start);
            this.x = translate.x, this.y = translate.y;
            let size = area2size(o.hitarea);
            this.sx = size.x, this.sy = size.y;
        }
        else {
            this.x = o.x, this.y = o.y;
            this.sx = o.sx, this.sy = o.sy;
        }
        // this.size = divPoint(this.size, 4);
        this.pos = trunc_vec3(this.pos);
        this.size = trunc_vec3(this.size);
        this.sprite.sx = this.size.x + 1;
        this.sprite.sy = this.size.y + 1;
    }

    public get target() {
        return this.#highlighted_obj;
    }

    public set target(o: GameObject) {
        if (!o) {
            if (this.#highlighted_obj) {
                this.#highlighted_obj.removeComponent(DebugHighlightComponent);
                this.#highlighted_obj = null;
            }
            this.x = this.y = this.sx = this.sy = 0;
            this.visible = false;
            return;
        }

        this.#highlighted_obj = o;
        if (!o.getComponent(DebugHighlightComponent)) {
            o.addComponent(new DebugHighlightComponent(o.id));
        }
        this.setHighlightPos(o);
        this.visible = true;
    }
}

class FloatingDialog {
    private dialogDiv: HTMLDivElement;
    private contentDiv: HTMLDivElement;
    private minimizeSpan: HTMLSpanElement;
    private titleElement: HTMLSpanElement;
    private wrapperElement: HTMLDivElement;

    constructor(title?: string, previousDialog?: HTMLElement) {
        [this.dialogDiv, this.contentDiv, this.titleElement, this.wrapperElement, this.minimizeSpan] = this.createDialog(title, previousDialog);
        document.body.insertBefore(this.dialogDiv, null);
    }

    private createDialog(title?: string, previousDialog?: HTMLElement): [HTMLDivElement, HTMLDivElement, HTMLSpanElement, HTMLDivElement, HTMLSpanElement] {
        return createDebugDialog(title, previousDialog);
    }

    public clear(): void {
        while (this.contentDiv.firstChild) {
            this.contentDiv.removeChild(this.contentDiv.firstChild);
        }
    }

    public minimize(): void {
        // Check if the dialog is already minimized
        if (this.dialogDiv.classList.contains('minimized')) return;
        this.minimizeSpan.click();
    }

    public close(): void {
        document.body.removeChild(this.dialogDiv);
    }

    public updateSize(): void {
        // Add a CSS class that sets the size automatically
        this.dialogDiv.classList.add('autosize');

        // Force a reflow to ensure the automatic size is applied
        void this.dialogDiv.offsetHeight;

        // Get the automatic size
        const autoHeight = this.dialogDiv.offsetHeight;
        const autoWidth = this.dialogDiv.offsetWidth;

        // Remove the autosize class
        this.dialogDiv.classList.remove('autosize');

        // Set the size manually to the automatic size
        this.dialogDiv.style.height = `${autoHeight}px`;
        this.dialogDiv.style.width = `${autoWidth}px`;
    }

    public getDialogElement(): HTMLDivElement {
        return this.dialogDiv;
    }

    public getContentElement(): HTMLDivElement {
        return this.contentDiv;
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
            draggedObj.x = ~~x - draggedObjCursorOffset.x;
            draggedObj.y = ~~y - draggedObjCursorOffset.y;
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
    global.view.drawgame();
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
    draggedObjCursorOffset = new_vec2(~~offsetToCursor.x, ~~offsetToCursor.y);
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

function customPrompt(title, initialValue, type) {
    return new Promise((resolve) => {
        const dialog = new FloatingDialog(title);
        const [dialogElement, dialogContentElement] = [dialog.getDialogElement(), dialog.getContentElement()];
        const promptDialog = document.createElement('div');
        promptDialog.className = 'custom-prompt-dialog';

        const titleLabel = document.createElement('label');
        titleLabel.innerHTML = title;
        titleLabel.className = 'custom-prompt-title';
        promptDialog.appendChild(titleLabel);

        let inputElement: HTMLInputElement | HTMLSelectElement;
        // 'text': A simple text box.
        // 'password': A text box that masks the user's input.
        // 'number': A text box that only accepts numerical input.
        // 'email': A text box that validates the input for a valid email format.
        // 'date': A control for entering a date (year, month, and day, with no time).
        // 'datetime-local': A control for entering a date and time, with no time zone.
        // 'time': A control for entering a time value with no time zone.
        // 'url': A text box that validates the input for a valid URL format.
        // 'search': A text box for entering search strings. The behavior of this type is similar to text but varies in some contexts, like styling in some browsers.
        // 'tel': A text box for entering a telephone number. Note that this type does not enforce any syntax or pattern checking.
        // 'color': A control for specifying a color.
        // 'range': A control for entering a number whose exact value is not important.
        // 'checkbox': A check box.
        // 'radio': A radio button.
        // 'file': A control that lets the user select a file to upload.
        // 'submit': A button that submits the form.
        // 'reset': A button that resets the form to its initial values.
        // 'button': A clickable button.
        switch (type) {
            case 'boolean':
                inputElement = document.createElement('select');
                inputElement.innerHTML = `<option value="true">True</option><option value="false">False</option>`;
                inputElement.value = initialValue ?? 'true';
                break;
            case 'number':
                inputElement = document.createElement('input') as HTMLInputElement;
                inputElement.value = initialValue;
                break;
            default:
                inputElement = document.createElement('input');
                inputElement.value = initialValue;
                inputElement.type = type;
                break;
        }
        inputElement.className = 'custom-prompt-input';
        inputElement.ariaReadOnly = 'false';
        inputElement.disabled = false;
        promptDialog.appendChild(inputElement);

        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'custom-prompt-buttons';

        const cancelButton = document.createElement('button');
        cancelButton.innerHTML = 'Cancel';
        cancelButton.onclick = () => {
            dialog.close();
            resolve(null);
        };
        buttonsDiv.appendChild(cancelButton);

        const confirmButton = document.createElement('button');
        confirmButton.innerHTML = 'OK';
        confirmButton.onclick = () => {
            dialog.close();
            resolve(inputElement.value);
        };
        buttonsDiv.appendChild(confirmButton);

        promptDialog.appendChild(buttonsDiv);
        dialogContentElement.appendChild(promptDialog);
        dialog.updateSize();
    });
}

function createObjectTableElement(dialog: HTMLElement, addContentTo: HTMLElement, obj: Object, objName: string, ignoreProps?: string[]): HTMLElement {
    let table = addContent(addContentTo, 'table', null) as HTMLTableElement;
    let headerRow = addContent(table, 'tr', null);

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
                        customPrompt(`Edit value for "${key}":`, currentValueAsStringInHandlerScope, type).then((newValue: any) => {
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
                        });
                    }
                    break;
                default:
                    valueCell.classList.add('immutable-propvalue');
                    break;
            }
        }
    }

    if (!Array.isArray(obj)) {
        for (const [key, value] of Object.entries(obj).sort()) {
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

function visualizeStateMachine(dialogElement: HTMLElement, container: HTMLElement, bfsmController: bfsm_controller): [addContentTo: HTMLElement, machineElements: Map<string, HTMLElement>, stateElements: Map<string, HTMLElement>] {
    let baseTable = addContent(container, 'table', null) as HTMLTableElement;
    let stateElements = new Map<string, HTMLElement>();
    let machineElements = new Map<string, HTMLElement>();

    // Recursive function to visualize a state machine
    function visualizeMachine(machine: statecontext, machineName: string, parentElement: HTMLElement, isActive: boolean, path: string): void {
        let table = addContent(parentElement, 'table', null);

        // Add a row for the machine name
        let machineNameRow = addContent(table, 'th', null);
        let machineNameCell = addContent(machineNameRow, 'td', machineName);
        machineElements.set(path, machineNameCell);

        // Add a row for each state in the state machine
        for (let stateId in machine.states) {
            let state = machine.states?.[stateId];
            let stateRow = addContent(table, 'tr', null);
            let stateCell = addContent(stateRow, 'td', state?.statedef_id ?? 'undefined');
            stateCell.classList.add('state');

            // Add an event listener to the state cell
            const newpath = `${path}.${stateId}`;
            stateCell.onclick = () => {
                bfsmController.to(newpath);
            };
            stateCell.oncontextmenu = () => {
                const stateDialog = new FloatingDialog(`State: [${newpath}]`, dialogElement);
                createObjectTableElement(stateDialog.getDialogElement(), stateDialog.getContentElement(), state, newpath, ['objects']);
                stateDialog.updateSize();
            };
            stateElements.set(newpath, stateCell);

            // If the state is a state machine, visualize it
            if (state.state instanceof statecontext) {
                let subTableCell = addContent(stateRow, 'td', null) as HTMLTableCellElement;
                visualizeMachine(state.state, state.state.id, subTableCell, isActive && machine.currentid === stateId, newpath);
            }
        }

        parentElement.appendChild(table);
    }

    // Visualize each machine in the bfsm_controller
    for (let machineName in bfsmController.machines) {
        let machine = bfsmController.machines[machineName];
        let machineRow = addContent(baseTable, 'tr', null);
        let machineCell = addContent(machineRow, 'td', machineName);
        if (bfsmController.current_machine_id === machineName) {
            machineCell.classList.add('active-machine-or-state');
        }
        else if (machine.parallel) {
            machineCell.classList.add('parallel-machine');
        }

        let subTableCell = addContent(machineRow, 'td', null) as HTMLTableCellElement;

        visualizeMachine(machine, machineName, subTableCell, bfsmController.current_machine_id === machineName || machine.parallel, machineName);
    }

    return [container, machineElements, stateElements];
}

// Function to set the CSS classes for highlighting the current machines/states
function highlightCurrentState(stateElements: Map<string, HTMLElement>, machineElements: Map<string, HTMLElement>, bfsmController: bfsm_controller): void {
    // Recursive function to update the classes of a state machine
    function updateMachineClasses(machine: statecontext, machineName: string, isActive: boolean, path: string): void {
        // Remove the 'active-machine-or-state' and 'parallel-machine' classes from the machine element
        let machineElement = machineElements.get(machineName);
        if (machineElement) {
            machineElement.classList.remove('active-machine-or-state', 'parallel-machine');
        }

        if (isActive) {
            machineElement?.classList.add('active-machine-or-state');
        }
        else if (machine.parallel) {
            machineElement?.classList.add('parallel-machine');
        }

        // Update the classes of each state in the state machine
        for (let stateId in machine.states) {
            // Remove the 'active-machine-or-state' class from the state element
            const newpath = `${path}.${stateId}`;
            let stateElement = stateElements.get(newpath);
            if (stateElement) {
                stateElement.classList.remove('active-machine-or-state');
            }

            // If the state is active, add the 'active-machine-or-state' class
            if (isActive && machine.currentid === stateId) {
                stateElement?.classList.add('active-machine-or-state');
            }

            // If the state is a state machine, update its classes
            let state = machine.states?.[stateId];
            if (state?.state instanceof statecontext) {
                updateMachineClasses(state.state, state.state.id, isActive && machine.currentid === stateId, newpath);
            }
        }
    }

    // Update the classes of each machine in the bfsm_controller
    for (let machineName in bfsmController.machines) {
        let machine = bfsmController.machines[machineName];
        updateMachineClasses(machine, machineName, true, machineName);
    }
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

function createDebugDialog(title?: string, previousDialog?: HTMLElement): [dialogDiv: HTMLDivElement, contentDiv: HTMLDivElement, titleElement: HTMLSpanElement, wrapperElelement: HTMLDivElement, minimizeSpam: HTMLSpanElement] {
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
    // wrapperDiv.ondblclick = (e) => {
    //     toggleFullscreenOnElement(theDialogDiv);
    // };

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
            // previousDialog.style.left = theDialogDiv.style.left;
            // previousDialog.style.top = theDialogDiv.style.top;
            // previousDialog.style.width = theDialogDiv.style.width;
            // previousDialog.style.height = theDialogDiv.style.height;
            previousDialog.style.display = 'flex';
            let newDivFullscreen = theDialogDiv.classList.contains('fullscreen');
            let previousDialogFullscreen = previousDialog.classList.contains('fullscreen');
            if (newDivFullscreen != previousDialogFullscreen) {
                toggleFullscreenOnElement(previousDialog);
            }
        };
    }

    const closeSpan = document.createElement('span');
    closeSpan.className = 'modal-dialog-button';
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

    const maximizeSpan = document.createElement('span');
    maximizeSpan.className = 'modal-dialog-button';
    maximizeSpan.innerHTML = '&#x1F5D6;'; // Unicode for maximize dialog icon
    maximizeSpan.onclick = (e) => {
        e.preventDefault();
        toggleFullscreenOnElement(theDialogDiv);
    };

    const minimizeSpan = document.createElement('span');
    minimizeSpan.className = 'modal-dialog-button';
    minimizeSpan.innerHTML = '&#x1F5D5;'; // Unicode for minimize icon

    minimizeSpan.onclick = (e) => {
        e.preventDefault();
        if (theDialogDiv.classList.contains('minimized')) {
            theDialogDiv.classList.remove('minimized');
            contentDiv.style.display = 'block';
            minimizeSpan.innerHTML = '&#x1F5D5;'; // Unicode for horizontal bar
            if (theDialogDiv.classList.contains('fullscreen')) {
                toggleFullscreenOnElement(theDialogDiv);
            }
            // Restore the original size of the dialog
            theDialogDiv.style.height = theDialogDiv.dataset.oldHeight;
            theDialogDiv.style.width = theDialogDiv.dataset.oldWidth;
        } else {
            theDialogDiv.classList.add('minimized');
            contentDiv.style.display = 'none';
            minimizeSpan.innerHTML = '&#x25B2;'; // Unicode for up arrow
            // Save the original size of the dialog and set its size to fit the title bar
            theDialogDiv.dataset.oldHeight = theDialogDiv.style.height;
            theDialogDiv.dataset.oldWidth = theDialogDiv.style.width;
            theDialogDiv.style.height = window.getComputedStyle(titleSpan).height;
        }
    };

    backSpan && wrapperDiv.insertBefore(backSpan, null);
    wrapperDiv.insertBefore(titleSpan, null);
    wrapperDiv.insertBefore(closeSpan, null);
    wrapperDiv.insertBefore(maximizeSpan, null);
    wrapperDiv.insertBefore(minimizeSpan, null);
    theDialogDiv.insertBefore(wrapperDiv, null);
    theDialogDiv.insertBefore(contentDiv, null);

    return [theDialogDiv, contentDiv, titleSpan, wrapperDiv, minimizeSpan];
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
    /* Handling mouse events on game objects requires
     * transforming the game coordinates to canvas coordinates and that requires scaling
     * to be taken into account.
     */
    let p = div_vec2(new_vec2(x, y), global.view.scale);
    let objsUnderCursor: GameObject[] = global.model.objects.filter(o => o.id !== 'debug_highlighter' && o.overlaps_point(p));
    if (objsUnderCursor && objsUnderCursor.length > 0) {
        // Choose obj with highest z-value
        let objUnderCursorWithHighestZ = objsUnderCursor.reduce((o1, o2) => o1.z > o2.z ? o1 : o2);
        return { objUnderCursor: objUnderCursorWithHighestZ, offsetToCursor: objUnderCursorWithHighestZ.overlaps_point(p) };
    }
    return { objUnderCursor: null, offsetToCursor: null };;
}
