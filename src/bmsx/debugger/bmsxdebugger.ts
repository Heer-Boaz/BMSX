import { BehaviorTreeDefinitions } from '../behaviourtree';
import { PositionUpdateAxisComponent } from '../collisioncomponents';
import { Component, componenttags_preprocessing, ComponentUpdateParams } from '../component';
import { EventEmitter, type ListenerSet } from '../eventemitter';
import { StateDefinitions } from '../fsmlibrary';
import type { Identifier } from "../game";
import { area2size, div_vec2, new_vec2, translate_vec2, trunc_vec3 } from '../game';
import { GameObject } from '../gameobject';
import { excludeclassfromsavegame } from '../gameserializer';
import { Msx1Colors } from '../msx';
import { Registry } from '../registry';
import type { vec2, vec3arr } from '../rompack';
import { SpriteObject } from '../sprite';
import { Color } from '../view';
import { createObjectTableElement } from './objectpropertydialog';
import { ObjectPropertyDialog, refreshAllObjectPropertyDialogs } from './objectpropertydialogimproved';
import { showRewindDialog } from './rewindui';
import { StateMachineVisualizer } from './statemachinevisualizer';
const DEBUG_ELEMENT_ID = 'debug_element_id';

let draggedObj: GameObject | null;
let draggedObjCursorOffset: vec2;
let shiftX: number;
let shiftY: number;
let prevPausedState: boolean; // Remember the paused-state before a dialog was opened. This allows to return to the original "paused" state after closing debug dialogs

export class DebugHighlightComponent extends PositionUpdateAxisComponent { // Note: MUST export this class, otherwise decorator will cause it to be undefined
    override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
        super.postprocessingUpdate({ params, returnvalue });
        const highlighter = $.model.getGameObject<ObjectHighlighter>('debug_highlighter');
        if (highlighter) {
            highlighter.setHighlightPos(this.parent);
        }
    }
}

@componenttags_preprocessing('render')
export class HitBoxVisualizer extends Component {
    static toggle(obj: GameObject) {
        if (HitBoxVisualizer.attachedToObject(obj)) {
            HitBoxVisualizer.detachFromObject(obj);
        }
        else {
            HitBoxVisualizer.attachToObject(obj);
        }
    }

    static attachToObject(obj: GameObject) {
        if (!obj.getComponent(HitBoxVisualizer)) {
            obj.addComponent(new HitBoxVisualizer(obj.id));
        }
    }

    static detachFromObject(obj: GameObject) {
        obj.removeComponent(HitBoxVisualizer);
    }

    static attachedToObject(obj: GameObject) {
        return obj.getComponent(HitBoxVisualizer);
    }

    constructor(_id: Identifier) {
        super(_id);
    }

    override preprocessingUpdate(): void {
        const parent = this.parent as SpriteObject;
        if (parent.hitbox) {
            $.view.drawRectangle({ area: { ...parent.hitbox, start: { ...parent.hitbox.start, z: parent.z } }, color: { ...Msx1Colors[5], a: 0.5 } });
        }

        // Draw polygons if available on the GameObject
        if (parent.hasHitPolygon) {
            for (const poly of parent.hitpolygon) {
                // Offset polygon by parent position and z
                const poly3: vec3arr[] = poly.map(p => [p[0], p[1], parent.z]);
                $.view.drawPolygon(poly3, { ...Msx1Colors[2], a: 0.5 }, 1);
            }
        }

    }
}

@excludeclassfromsavegame
class ObjectHighlighter extends SpriteObject {
    #highlighted_obj: GameObject;
    static readonly mijnkleur: Color = { r: 0, g: 0, b: 1, a: .5 };

    public constructor() {
        super('debug_highlighter');
        this.imgid = 'whitepixel'; // ! FIXME: HARDCODED
        this.visible = false;
        this.#highlighted_obj = null;
        this.z = Math.pow(10, 9);
        this.sprite.colorize = ObjectHighlighter.mijnkleur;
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

        if (o.id === this.id) return; // Don't highlight self

        this.#highlighted_obj = o;
        if (!o.getComponent(DebugHighlightComponent)) {
            o.addComponent(new DebugHighlightComponent(o.id));
        }
        this.setHighlightPos(o);
        this.visible = true;
    }
}

export class FloatingDialog {
    private dialogDiv: HTMLDivElement;
    private contentDiv: HTMLDivElement;
    private minimizeSpan: HTMLSpanElement;

    constructor(title?: string, previousDialog?: HTMLElement) {
        [this.dialogDiv, this.contentDiv, , , this.minimizeSpan] = this.createDialog(title, previousDialog);
        document.body.insertBefore(this.dialogDiv, null);
    }

    private createDialog(title?: string, previousDialog?: HTMLElement): [HTMLDivElement, HTMLDivElement, HTMLSpanElement, HTMLDivElement, HTMLSpanElement] {
        const dialogDiv = createDialogDiv(previousDialog);
        const wrapperDiv = createWrapperDiv(title, dialogDiv, previousDialog);
        const contentDiv = createContentDiv(dialogDiv, previousDialog);

        dialogDiv.insertBefore(wrapperDiv, null);
        dialogDiv.insertBefore(contentDiv, null);

        return [dialogDiv, contentDiv, wrapperDiv.querySelector('.modal-title'), wrapperDiv, wrapperDiv.querySelector('.modal-dialog-button.minimize')];
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
        // Check if the dialog is a child of the body element
        if (!this.dialogDiv.parentElement) return;
        this.dialogDiv.parentElement.removeChild(this.dialogDiv);
    }

    public updateSize(): void {
        // Add a CSS class that sets the size automatically
        this.dialogDiv.classList.add('autosize');

        // Force a reflow to ensure the automatic size is applied
        void this.dialogDiv.offsetHeight;

        // Remove the autosize class
        this.dialogDiv.classList.remove('autosize');

        // Set the size manually to the automatic size
        // this.dialogDiv.style.height = 'auto'; // Ensure the dialog height is adjusted to fit the content
        // this.dialogDiv.style.width = 'auto'; // Ensure the dialog width is adjusted to fit the content
    }

    public getDialogElement(): HTMLDivElement {
        return this.dialogDiv;
    }

    public getContentElement(): HTMLDivElement {
        return this.contentDiv;
    }
}

function toggleFullscreenOnElement(el: HTMLElement) {
    if (!el.classList.contains('fullscreen')) {
        el.dataset.left = el.style.left;
        el.dataset.top = el.style.top;
        el.style.removeProperty('left');
        el.style.removeProperty('top');
    }
    else {
        el.dataset.left && (el.style.left = el.dataset.left);
        el.dataset.top && (el.style.top = el.dataset.top);
    }
    el.classList.toggle('fullscreen');
}

function createDialogDiv(previousDialog?: HTMLElement): HTMLDivElement {
    const dialogDiv = document.createElement('div');
    dialogDiv.className = 'modal-dialog';
    dialogDiv.id = DEBUG_ELEMENT_ID;

    if (previousDialog) {
        previousDialog.style.display = 'none';
        (dialogDiv as any).previous = previousDialog;
    }

    return dialogDiv;
}

function createDebugDialog(title?: string, previousDialog?: HTMLElement): [HTMLDivElement, HTMLDivElement, HTMLSpanElement, HTMLDivElement, HTMLSpanElement] {
    const dialogDiv = createDialogDiv(previousDialog);
    const wrapperDiv = createWrapperDiv(title, dialogDiv, previousDialog);
    const contentDiv = createContentDiv(dialogDiv, previousDialog);

    dialogDiv.insertBefore(wrapperDiv, null);
    dialogDiv.insertBefore(contentDiv, null);

    const titleSpan = wrapperDiv.querySelector('.modal-title') as HTMLSpanElement;
    return [dialogDiv, contentDiv, titleSpan, wrapperDiv, wrapperDiv.querySelector('.modal-dialog-button.minimize')];
}

function createWrapperDiv(title: string, dialogDiv: HTMLDivElement, previousDialog?: HTMLElement): HTMLDivElement {
    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'modal-title-wrapper';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'modal-title';
    title && (titleSpan.innerHTML = title);

    const backSpan = createBackSpan(dialogDiv, previousDialog);
    const closeSpan = createCloseSpan(dialogDiv, previousDialog);
    const maximizeSpan = createMaximizeSpan(dialogDiv);
    const minimizeSpan = createMinimizeSpan(dialogDiv, titleSpan);

    backSpan && wrapperDiv.insertBefore(backSpan, null);
    wrapperDiv.insertBefore(titleSpan, null);
    wrapperDiv.insertBefore(closeSpan, null);
    wrapperDiv.insertBefore(maximizeSpan, null);
    wrapperDiv.insertBefore(minimizeSpan, null);

    // Make the dialog draggable via the entire top menu span/div
    wrapperDiv.onmousedown = (ev: MouseEvent) => {
        if (dialogDiv.classList.contains('fullscreen')) return; // Prevent dragging when the dialog is in fullscreen mode

        shiftX = ev.clientX - dialogDiv.getBoundingClientRect().left;
        shiftY = ev.clientY - dialogDiv.getBoundingClientRect().top;
        document.onmousemove = (moveEvent: MouseEvent) => {
            dialogDiv.style.left = moveEvent.pageX - shiftX + 'px';
            dialogDiv.style.top = moveEvent.pageY - shiftY + 'px';
        };
        document.onmouseup = () => {
            document.onmousemove = null;
            document.onmouseup = null;
        };
    };

    return wrapperDiv;
}

function createContentDiv(dialogDiv: HTMLDivElement, previousDialog?: HTMLElement): HTMLDivElement {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'modal-content';

    if (previousDialog) {
        dialogDiv.style.left = previousDialog.style.left;
        dialogDiv.style.top = previousDialog.style.top;
        dialogDiv.style.width = previousDialog.style.width;
        dialogDiv.style.height = previousDialog.style.height;

        let newDivFullscreen = dialogDiv.classList.contains('fullscreen');
        let previousDialogFullscreen = previousDialog.classList.contains('fullscreen');
        if (newDivFullscreen != previousDialogFullscreen) {
            toggleFullscreenOnElement(dialogDiv);
        }
    }

    return contentDiv;
}

function createBackSpan(dialogDiv: HTMLDivElement, previousDialog?: HTMLElement): HTMLSpanElement | undefined {
    if (!previousDialog) return undefined;

    const backSpan = document.createElement('span');
    backSpan.className = 'modal-back';
    backSpan.innerHTML = '&larr;';
    backSpan.onclick = (e) => {
        e.preventDefault();
        document.body.removeChild(dialogDiv);
        previousDialog.style.display = 'flex';
        let newDivFullscreen = dialogDiv.classList.contains('fullscreen');
        let previousDialogFullscreen = previousDialog.classList.contains('fullscreen');
        if (newDivFullscreen != previousDialogFullscreen) {
            toggleFullscreenOnElement(previousDialog);
        }
    };

    return backSpan;
}

function createCloseSpan(dialogDiv: HTMLDivElement, previousDialog?: HTMLElement): HTMLSpanElement {
    const closeSpan = document.createElement('span');
    closeSpan.className = 'modal-dialog-button';
    closeSpan.innerHTML = '&times;';
    closeSpan.onclick = (e) => {
        e.preventDefault();
        document.body.removeChild(dialogDiv);

        let previous = previousDialog;
        while (previous) {
            document.body.removeChild(previous);
            previous = (previous as any).previous;
        }
        global.$.paused = prevPausedState;
    };

    return closeSpan;
}

function createMaximizeSpan(dialogDiv: HTMLDivElement): HTMLSpanElement {
    const maximizeSpan = document.createElement('span');
    maximizeSpan.className = 'modal-dialog-button';
    maximizeSpan.innerHTML = '&#x1F5D6;';
    maximizeSpan.onclick = (e) => {
        e.preventDefault();
        toggleFullscreenOnElement(dialogDiv);
    };

    return maximizeSpan;
}

function createMinimizeSpan(dialogDiv: HTMLDivElement, titleSpan: HTMLSpanElement): HTMLSpanElement {
    const minimizeSpan = document.createElement('span');
    minimizeSpan.className = 'modal-dialog-button';
    minimizeSpan.innerHTML = '&#x1F5D5;';

    minimizeSpan.onclick = (e) => {
        e.preventDefault();
        if (dialogDiv.classList.contains('minimized')) {
            dialogDiv.classList.remove('minimized');
            (dialogDiv.querySelector('.modal-content') as HTMLElement).style.display = 'block';
            minimizeSpan.innerHTML = '&#x1F5D5;';
            if (dialogDiv.classList.contains('fullscreen')) {
                toggleFullscreenOnElement(dialogDiv);
            }
            dialogDiv.style.height = dialogDiv.dataset.oldHeight;
            dialogDiv.style.width = dialogDiv.dataset.oldWidth;
        } else {
            dialogDiv.classList.add('minimized');
            (dialogDiv.querySelector('.modal-content') as HTMLElement).style.display = 'none';
            minimizeSpan.innerHTML = '&#x25B2;';
            dialogDiv.dataset.oldHeight = dialogDiv.style.height;
            dialogDiv.dataset.oldWidth = dialogDiv.style.width;
            dialogDiv.style.height = window.getComputedStyle(titleSpan).height;
        }
    };

    return minimizeSpan;
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

export function handleOpenObjectMenu(e: UIEvent | null, previous?: HTMLElement): void {
    if (e && e.type !== 'keydown') return;
    if (!previous) {
        prevPausedState = global.$.paused; // Remember the original paused-state so that we can return to that state
        global.$.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
    }

    const [dialogDiv, contentDiv] = createDebugDialog('Objects', previous);

    let table = addContent(contentDiv, 'table', null);
    let headerRow = addContent(table, 'tr', null);
    addContent(headerRow, 'th', 'Type');
    addContent(headerRow, 'th', 'ID');

    $.model.objects.forEach(o => {
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

export function handleOpenEventEmitterMenu(previous?: HTMLElement): void {
    const [dialogDiv, contentDiv] = createDebugDialog('Event Emitter Debugger', previous);

    const eventEmitter = EventEmitter.instance;
    const container = document.createElement('div');
    container.className = 'event-emitter-container';
    contentDiv.appendChild(container);

    const wrapper = document.createElement('div');
    wrapper.className = 'event-emitter-wrapper';
    container.appendChild(wrapper);

    const header = document.createElement('div');
    header.className = 'event-emitter-header';
    header.textContent = 'Event Emitter Debugger';
    wrapper.appendChild(header);

    const table = addContent(wrapper, 'table', null);
    table.className = 'event-emitter-table';
    const headerRow = addContent(table, 'tr', null);
    addContent(headerRow, 'th', 'Event Name');
    addContent(headerRow, 'th', 'Scope');
    addContent(headerRow, 'th', 'Listeners');

    for (const eventName in eventEmitter.globalScopeListeners) {
        const row = addContent(table, 'tr', null);
        addContent(row, 'td', eventName);
        addContent(row, 'td', 'global');
        const listenersCell = addContent(row, 'td', `${eventEmitter.globalScopeListeners[eventName].size}`);
        listenersCell.classList.add('clickable');
        listenersCell.onclick = () => handleOpenListenersDialog(eventName, 'global', eventEmitter.globalScopeListeners[eventName], dialogDiv);
    }

    for (const eventName in eventEmitter.emitterScopeListeners) {
        for (const scope in eventEmitter.emitterScopeListeners[eventName]) {
            const row = addContent(table, 'tr', null);
            addContent(row, 'td', eventName);
            addContent(row, 'td', scope);
            const listenersCell = addContent(row, 'td', `${eventEmitter.emitterScopeListeners[eventName][scope].size}`);
            listenersCell.classList.add('clickable');
            listenersCell.onclick = () => handleOpenListenersDialog(eventName, scope, eventEmitter.emitterScopeListeners[eventName][scope], dialogDiv);
        }
    }

    document.body.insertBefore(dialogDiv, null);
}

function handleOpenListenersDialog(eventName: string, scope: string, listeners: ListenerSet, previous?: HTMLElement): void {
    const [dialogDiv, contentDiv] = createDebugDialog(`Listeners for ${eventName} (${scope})`, previous);

    const table = addContent(contentDiv, 'table', null);
    table.className = 'event-emitter-listeners-table';
    const headerRow = addContent(table, 'tr', null);
    addContent(headerRow, 'th', 'Listener');
    addContent(headerRow, 'th', 'Subscriber');

    listeners.forEach(({ listener, subscriber }) => {
        const row = addContent(table, 'tr', null);
        addContent(row, 'td', listener.name || 'anonymous');
        addContent(row, 'td', subscriber.constructor.name);
    });

    document.body.insertBefore(dialogDiv, null);
}

export function handleOpenDebugMenu(e: UIEvent): void {
    if (e && e.type !== 'keydown') return;
    prevPausedState = global.$.paused; // Remember the original paused-state so that we can return to that state
    global.$.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!

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
    row.onclick = (_) => openObjectDetailMenu(StateDefinitions, 'Statemachine definitions', dialogDiv);

    row = addContent(table, 'tr', null);
    row.classList.add('selectableoption', 'centered-text');
    addContent(row, 'td', `List all behavior tree definitions`);
    row.onclick = (_) => openObjectDetailMenu(BehaviorTreeDefinitions, 'BT definitions', dialogDiv);

    row = addContent(table, 'tr', null);
    row.classList.add('selectableoption', 'centered-text');
    addContent(row, 'td', `See the Event Emitter`);
    row.onclick = (_) => openObjectDetailMenu(EventEmitter.instance, 'Event Emitter', dialogDiv);

    row = addContent(table, 'tr', null);
    row.classList.add('selectableoption', 'centered-text');
    addContent(row, 'td', `See the Event Emitter???`);
    row.onclick = (_) => handleOpenEventEmitterMenu(dialogDiv);

    row = addContent(table, 'tr', null);
    row.classList.add('selectableoption', 'centered-text');
    addContent(row, 'td', `See da Registry`);
    row.onclick = (_) => openObjectDetailMenu(Registry.instance, 'Da Registry', dialogDiv);

    document.body.insertBefore(dialogDiv, null);
}

export function handleOpenModelMenu(e: UIEvent | null, previous: HTMLElement): void {
    if (e && e.type !== 'keydown') return;
    if (!previous) {
        prevPausedState = global.$.paused; // Remember the original paused-state so that we can return to that state
        global.$.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
        draggedObj = null; // Make sure that we stop dragging any object
    }

    openObjectDetailMenu($.model, 'The Model', previous);
}

function openObjectDetailMenu(obj: any, title: string, previous?: HTMLElement): void {
    if (!previous) {
        prevPausedState = global.$.paused; // Remember the original paused-state so that we can return to that state
        global.$.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
    }

    // Use ObjectPropertyDialog for live-refresh
    if (obj && obj.id != null) {
        const dlg = ObjectPropertyDialog.openDialogById(obj.id.toString(), title, ['objects']);
        // Optionally, position or focus dialog if needed
    } else {
        const [dialogDiv, contentDiv] = createDebugDialog(title, previous);
        createObjectTableElement(dialogDiv, contentDiv, obj, title, ['objects']);
        document.body.insertBefore(dialogDiv, null);
    }
}

export function handleDebugClick(e: MouseEvent): void {
    if (!e.shiftKey && e.ctrlKey && !draggedObj) { // Only open when main or middle button is clicked and shift is not pressed and ctrl is pressed and no object is being dragged
        const { objUnderCursor } = getGameObjectAtCursor(e);
        if (objUnderCursor) {
            openObjectDetailMenu(objUnderCursor, objUnderCursor.id);
        }
    }
}

function getGameObjectAtCursor(e: MouseEvent): { objUnderCursor: GameObject | null; offsetToCursor: vec2 | null; } {
    const x = e.offsetX;
    const y = e.offsetY;
    const p = div_vec2(new_vec2(x, y), $.view.viewportScale);

    const pointArea = { start: { x: p.x, y: p.y }, end: { x: p.x, y: p.y } };

    const objsUnderCursor: GameObject[] = $.model.objects.filter(o =>
        o.id !== 'debug_highlighter' &&
        o.hittable &&
        (
            (o.hasHitPolygon && o.collides(pointArea)) ||
            (!o.hasHitPolygon && o.overlaps_point && o.overlaps_point(p))
        )
    );

    if (objsUnderCursor && objsUnderCursor.length > 0) {
        const objUnderCursorWithHighestZ = objsUnderCursor.reduce((o1, o2) => o1.z > o2.z ? o1 : o2);
        return {
            objUnderCursor: objUnderCursorWithHighestZ,
            offsetToCursor: objUnderCursorWithHighestZ.overlaps_point
                ? objUnderCursorWithHighestZ.overlaps_point(p)
                : { x: 0, y: 0 }
        };
    }
    return { objUnderCursor: null, offsetToCursor: null };
}

export function handleDebugMouseDown(e: MouseEvent): void {
    if (e.button === 1) {
        const { objUnderCursor } = getGameObjectAtCursor(e);
        if (objUnderCursor) {
            HitBoxVisualizer.toggle(objUnderCursor);
        }
    }

    if (e.button !== 0) {
        draggedObj = null; // Stop dragging object
        return; // Only start dragging when primary button is pressed
    }

    if (!$.input.getPlayerInput(1).getButtonState('ShiftLeft', 'keyboard').pressed) { // Only start or continue dragging when shift is pressed. Note that the shift key is not updated after the mouse is pressed down
        draggedObj = null; // Stop dragging object
        return;
    }

    if (!draggedObj) { // Only start dragging when no object is currently being dragged
        let { objUnderCursor, offsetToCursor } = getGameObjectAtCursor(e); // Get the object under the cursor and the offset from the cursor to the object's position
        if (objUnderCursor && offsetToCursor) { // Only start dragging when an object is under the cursor and the offset is valid (i.e. the object has a position)
            e.preventDefault();
            startDragGameObject(objUnderCursor!, offsetToCursor!); // Start dragging the object under the cursor around
        }
        else { // Otherwise, continue dragging the object that is already being dragged
            handleDebugMouseMove(e); // Update the dragged object's position when the mouse is pressed down and moved
        }
    }
}

export function handleDebugMouseMove(e: MouseEvent): void {
    const { objUnderCursor } = getGameObjectAtCursor(e);
    if ($.input.getPlayerInput(1).getButtonState('ControlLeft', 'keyboard').pressed) { // Ctrl + mouse move = allow for selecting objects in the game world (for debugging)
        // Highlight mouse-overed objects
        highlight_object(objUnderCursor);
    }
    else {
        highlight_object(null); // Remove highlight when Ctrl is not pressed or when no object is under the cursor
    }

    if (draggedObj) {
        // Otherwise, continue dragging the object that is already being dragged
        let x = e.offsetX / $.view.viewportScale;
        let y = e.offsetY / $.view.viewportScale;

        if (draggedObj.pos) {
            draggedObj.x = ~~x - draggedObjCursorOffset.x;
            draggedObj.y = ~~y - draggedObjCursorOffset.y;
        }
        if (!$.input.getPlayerInput(1).getButtonState('ShiftLeft', 'keyboard').pressed) {
            draggedObj = null; // Stop dragging object when shift is released
        }
        return;
    }
}

function highlight_object(o: GameObject) {
    const model = $.model;
    let highlighter = $.model.getGameObject<ObjectHighlighter>('debug_highlighter');

    if (!o) {
        highlighter && (highlighter.target = null);
    }
    else {
        if (!highlighter) {
            highlighter = new ObjectHighlighter();
            model.spawn(highlighter);
        }
        else if (!model.is_obj_in_current_space('debug_highlighter')) {
            model.move_obj_to_space('debug_highlighter', model.current_space_id);
        }
        highlighter.target = o;
    }
    $.view.drawgame();
}

export function handleDebugMouseUp(_e: MouseEvent): void {
    if (draggedObj) {
        draggedObj = null;
    }
}

export function handleDebugMouseOut(_e: MouseEvent): void {
    highlight_object(null);
    draggedObj = null;
}

function startDragGameObject(gameobject_at_cursor: GameObject, offsetToCursor: vec2): void {
    draggedObj = gameobject_at_cursor;
    draggedObjCursorOffset = new_vec2(~~offsetToCursor.x, ~~offsetToCursor.y);
}

let stateMachineVisualisers: Record<Identifier, StateMachineVisualizer> = {};
export function removeStateMachineVisualizer(objId: Identifier): void {
    if (stateMachineVisualisers[objId]) {
        delete stateMachineVisualisers[objId];
    }
}

export function handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const { objUnderCursor } = getGameObjectAtCursor(e);
    // Add state visualiser to the UI
    if (objUnderCursor) {
        // Verify that there is no existing state visualiser dialog on screen
        if (stateMachineVisualisers[objUnderCursor.id]) {
            // If there is an existing state visualiser dialog, close it
            stateMachineVisualisers[objUnderCursor.id].closeDialog();
        }
        else {
            // If there is no existing state visualiser dialog, create a new one
            const visualiser = new StateMachineVisualizer(objUnderCursor.id);
            stateMachineVisualisers[objUnderCursor.id] = visualiser;
            visualiser.openDialog();
            visualiser.frameUpdate(); // Force an initial update to display the current state
        }
    }
    else {
        highlight_object(null); // Remove highlight when Ctrl is not pressed or when no object is under the cursor
    }

}

function refreshDialogs() {
    // Refresh all object property dialogs
    refreshAllObjectPropertyDialogs();
    // Refresh all state machine visualizers
    if (typeof stateMachineVisualisers === 'object') {
        for (const visualiser of Object.values(stateMachineVisualisers)) {
            if (visualiser && typeof visualiser.frameUpdate === 'function') {
                visualiser.frameUpdate();
            }
        }
    }
}

// Attach to frame event for live-refresh of property dialogs and state machine visualizers
window.addEventListener('frame', refreshDialogs);
window.addEventListener('rewind', refreshDialogs);

export function gamePaused() {
    showRewindDialog();
}

export function gameResumed() {
    let rewindOverlay = document.getElementById('rewind-overlay');
    if (rewindOverlay) rewindOverlay.remove();
}
