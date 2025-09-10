import { BehaviorTreeDefinitions } from '../ai/behaviourtree';
import { Component, componenttags_postprocessing, componenttags_preprocessing } from '../component/basecomponent';
import { CameraObject } from '../core/object/cameraobject';
import { EventEmitter, type ListenerSet } from '../core/eventemitter';
import { $ } from '../core/game';
import { WorldObject } from '../core/object/worldobject';
import { Registry } from '../core/registry';
import { SpriteObject } from '../core/object/sprite';
import { div_vec2, new_vec2 } from '../utils/utils';
import { StateDefinitions } from '../fsm/fsmlibrary';
import { PhysicsDebugComponent } from '../physics/physicsdebugcomponent';
import type { Identifier, vec2 } from '../rompack/rompack';
import { excludeclassfromsavegame, type RevivableObjectArgs } from '../serializer/gameserializer';
import { Msx1Colors } from '../systems/msx';
import { createObjectTableElement } from './objectpropertydialog';
import { ObjectPropertyDialog, refreshAllObjectPropertyDialogs } from './objectpropertydialogimproved';
import { StateMachineVisualizer } from './statemachinevisualizer';
const DEBUG_ELEMENT_ID = 'debug_element_id';
const PHYSICS_OVERLAY_ID = 'physics_overlay_canvas';

let draggedObj: WorldObject | null;
let draggedObjCursorOffset: vec2;
let shiftX: number;
let shiftY: number;
let prevPausedState: boolean; // Remember the paused-state before a dialog was opened. This allows to return to the original "paused" state after closing debug dialogs
let currentHighlighterComponent: ObjectHighlighterComponent | null;
let stateMachineVisualisers: Record<Identifier, StateMachineVisualizer> = {};

// Physics overlay renderer: attaches once, renders PhysicsDebugComponent buffers every frame
@excludeclassfromsavegame
@componenttags_postprocessing('render')
export class PhysicsOverlayRenderer extends Component {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private lastResizeW = 0; private lastResizeH = 0;
    constructor(opts: RevivableObjectArgs & { parentid: Identifier }) {
        super(opts);
        // Create or reuse overlay canvas
        let c = document.getElementById(PHYSICS_OVERLAY_ID) as HTMLCanvasElement | null;
        if (!c) {
            c = document.createElement('canvas');
            c.id = PHYSICS_OVERLAY_ID;
            c.style.position = 'absolute';
            c.style.left = '0'; c.style.top = '0';
            c.style.pointerEvents = 'none';
            c.style.zIndex = '9000';
            document.body.appendChild(c);
        }
        this.canvas = c;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('2D context not available for physics overlay');
        this.ctx = ctx;
    }

    private ensureSize() {
        const w = window.innerWidth, h = window.innerHeight;
        if (w !== this.lastResizeW || h !== this.lastResizeH) {
            this.lastResizeW = this.canvas.width = w;
            this.lastResizeH = this.canvas.height = h;
        }
    }

    override postprocessingUpdate(): void {
        this.ensureSize();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // Gather all PhysicsDebugComponents
        const debugComponents: PhysicsDebugComponent[] = [];
        // Iterate all spaces for game objects
        const modelAny: any = $.world;
        const spaceMap = modelAny[Symbol.for('id2space')] || modelAny['id2space'] || modelAny['spaceid_2_space'] || modelAny['spaceid_2_space'.toString()];
        if (spaceMap) {
            for (const sid in spaceMap) {
                const space = spaceMap[sid];
                if (!space || !space.objects) continue;
                for (const wo of space.objects) {
                    const p = wo.getComponent(PhysicsDebugComponent);
                    if (p && p.enabled) debugComponents.push(p);
                }
            }
        }
        // if (!debugComponents.length) return;
        // Camera-aware projection: project 3D -> NDC -> screen (overlay canvas coordinates)
        const activeCamObj = $.world.getWorldObject($.world.activeCameraId) as CameraObject | undefined;
        const cam = activeCamObj?.camera;
        if (!cam) return; // no camera yet
        const vp = cam.viewProjection; // Float32Array length 16
        const width = this.canvas.width; const height = this.canvas.height;
        const project = (x: number, y: number, z: number): { sx: number; sy: number; depth: number; behind: boolean } => {
            // Multiply vec4
            const vx = x, vy = y, vz = z, vw = 1;
            const m = vp;
            const rx = m[0] * vx + m[4] * vy + m[8] * vz + m[12] * vw;
            const ry = m[1] * vx + m[5] * vy + m[9] * vz + m[13] * vw;
            const rz = m[2] * vx + m[6] * vy + m[10] * vz + m[14] * vw;
            const rw = m[3] * vx + m[7] * vy + m[11] * vz + m[15] * vw;
            if (rw === 0) return { sx: 0, sy: 0, depth: 1, behind: true };
            const invW = 1 / rw;
            const ndcX = rx * invW, ndcY = ry * invW, ndcZ = rz * invW;
            // behind camera if rw<0 or outside clip z (ndcZ outside [-1,1])
            const behind = rw < 0 || ndcZ < -1 || ndcZ > 1;
            const sx = (ndcX * 0.5 + 0.5) * width;
            const sy = (-ndcY * 0.5 + 0.5) * height;
            return { sx, sy, depth: ndcZ, behind };
        };
        const fadeDepth = (d: number) => Math.max(0.15, 1 - ((d + 1) * 0.5)); // map ndcZ [-1,1] -> [0,1]
        const drawLine = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: string) => {
            const p1 = project(x1, y1, z1), p2 = project(x2, y2, z2);
            if (p1.behind && p2.behind) return;
            ctx.globalAlpha = Math.min(fadeDepth(p1.depth), fadeDepth(p2.depth));
            ctx.strokeStyle = color;
            ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
        };
        const drawCircle = (cx: number, cy: number, cz: number, r: number, color: string) => {
            const center = project(cx, cy, cz); if (center.behind) return;
            // Approximate radius in screen space by projecting a point offset along camera right axis
            // Simplify: sample point in +X world direction (small)
            const edge = project(cx + r, cy, cz);
            const radiusPx = Math.abs(edge.sx - center.sx);
            ctx.globalAlpha = fadeDepth(center.depth);
            ctx.strokeStyle = color;
            ctx.beginPath(); ctx.arc(center.sx, center.sy, radiusPx, 0, Math.PI * 2); ctx.stroke();
        };
        const drawPoint = (x: number, y: number, z: number, color: string) => {
            const p = project(x, y, z); if (p.behind) return;
            ctx.globalAlpha = fadeDepth(p.depth);
            ctx.fillStyle = color;
            ctx.fillRect(p.sx - 2, p.sy - 2, 4, 4);
        };
        // Color scheme
        const colAABB = '#0f8';
        const colTrigger = '#ff0';
        const colSphere = '#08f';
        const colContact = '#f33';
        for (const d of debugComponents) {
            for (const l of d.aabbLines) drawLine(l.x1, l.y1, l.z1, l.x2, l.y2, l.z2, colAABB);
            for (const t of d.triggerAabbs) {
                // Draw as 12 edges: recreate quickly
                const hx = t.hx, hy = t.hy, hz = t.hz;
                const x = t.x, y = t.y, z = t.z;
                const edges = [
                    [x - hx, y - hy, z - hz, x + hx, y - hy, z - hz],
                    [x + hx, y - hy, z - hz, x + hx, y + hy, z - hz],
                    [x + hx, y + hy, z - hz, x - hx, y + hy, z - hz],
                    [x - hx, y + hy, z - hz, x - hx, y - hy, z - hz],
                    [x - hx, y - hy, z + hz, x + hx, y - hy, z + hz],
                    [x + hx, y - hy, z + hz, x + hx, y + hy, z + hz],
                    [x + hx, y + hy, z + hz, x - hx, y + hy, z + hz],
                    [x - hx, y + hy, z + hz, x - hx, y - hy, z + hz],
                    [x - hx, y - hy, z - hz, x - hx, y - hy, z + hz],
                    [x + hx, y - hy, z - hz, x + hx, y - hy, z + hz],
                    [x + hx, y + hy, z - hz, x + hx, y + hy, z + hz],
                    [x - hx, y + hy, z - hz, x - hx, y + hy, z + hz]
                ];
                for (const e of edges) drawLine(e[0], e[1], e[2], e[3], e[4], e[5], colTrigger);
            }
            for (const c of d.sphereCircles) drawCircle(c.cx, c.cy, c.cz, c.r, colSphere);
            for (const cp of d.contactPoints) {
                drawPoint(cp.x, cp.y, cp.z, colContact);
            }
        }
        // World axes (length 5) for orientation: X=red, Y=green, Z=blue
        const AXIS_LEN = 5;
        drawLine(0, 0, 0, AXIS_LEN, 0, 0, '#f00');
        drawLine(0, 0, 0, 0, AXIS_LEN, 0, '#0f0');
        drawLine(0, 0, 0, 0, 0, AXIS_LEN, '#00f');
        ctx.globalAlpha = 1;
    }
}

@componenttags_preprocessing('render')
@excludeclassfromsavegame
export class HitBoxVisualizer extends Component {
    static toggle(obj: WorldObject) {
        if (HitBoxVisualizer.attachedToObject(obj)) {
            HitBoxVisualizer.detachFromObject(obj);
        }
        else {
            HitBoxVisualizer.attachToObject(obj);
        }
    }

    static attachToObject(obj: WorldObject) {
        if (!obj.getComponent(HitBoxVisualizer)) {
            obj.addComponent(new HitBoxVisualizer({ parentid: obj.id }));
        }
    }

    static detachFromObject(obj: WorldObject) {
        obj.removeComponent(HitBoxVisualizer);
    }

    static attachedToObject(obj: WorldObject) {
        return obj.getComponent(HitBoxVisualizer);
    }

    constructor(opts: RevivableObjectArgs & { parentid: Identifier }) {
        super(opts);
    }

    override preprocessingUpdate(): void {
        const parent = this.parent as unknown as SpriteObject;
        // Draw polygons if available on the WorldObject
        if (parent.hasHitPolygon) {
            for (const poly of parent.hitpolygon) {
                // Offset polygon by parent position and z
                $.view.drawPolygon(poly, parent.z + 1, { ...Msx1Colors[2], a: 0.5 }, 1);
            }
        }
        if (parent.hitbox) {
            $.view.drawRectangle({ area: { ...parent.hitbox, start: { ...parent.hitbox.start, z: parent.z } }, color: { ...Msx1Colors[5], a: 0.5 } });
        }
    }
}

@excludeclassfromsavegame
@componenttags_preprocessing('render')
export class ObjectHighlighterComponent extends Component {
    static toggle(obj: WorldObject) {
        if (ObjectHighlighterComponent.attachedToObject(obj)) {
            ObjectHighlighterComponent.detachFromObject(obj);
        }
        else {
            HitBoxVisualizer.attachToObject(obj);
        }
    }

    static attachToObject(obj: WorldObject) {
        if (!obj.getComponent(ObjectHighlighterComponent)) {
            obj.addComponent(new ObjectHighlighterComponent({ parentid: obj.id }));
        }
    }

    static detachFromObject(obj: WorldObject) {
        obj.removeComponent(ObjectHighlighterComponent);
    }

    static attachedToObject(obj: WorldObject) {
        return obj.getComponent(ObjectHighlighterComponent);
    }

    constructor(opts: RevivableObjectArgs & { parentid: Identifier }) {
        super(opts);
    }

    override preprocessingUpdate(): void {
        const parent = this.parent as unknown as SpriteObject;

        // Draw polygons if available on the WorldObject
        if (parent.hasHitPolygon) {
            for (const poly of parent.hitpolygon) {
                // Offset polygon by parent position and z
                $.view.drawPolygon(poly, parent.z, { ...Msx1Colors[6], a: 0.5 }, 1);
            }
        }

        // Draw a transparent filled rectangle around the WorldObject
        if (parent.hitbox) {
            $.view.fillRectangle({ area: { ...parent.hitbox, start: { ...parent.hitbox.start, z: parent.z } }, color: { ...Msx1Colors[5], a: 0.5 } });
        }
    }
}

// @excludeclassfromsavegame
// class ObjectHighlighter extends SpriteObject {
//     #highlighted_obj: WorldObject;
//     static readonly mijnkleur: Color = { r: 0, g: 0, b: 1, a: .5 };

//     public constructor() {
//         super('debug_highlighter');
//         this.imgid = 'whitepixel'; // ! FIXME: HARDCODED
//         this.visible = false;
//         this.#highlighted_obj = null;
//         this.z = Math.pow(10, 9);
//         this.sprite.colorize = ObjectHighlighter.mijnkleur;
//     }

//     public setHighlightPos(o: WorldObject) {
//         if (o.hitarea) {
//             let translate = translate_vec2(o.pos, o.hitarea.start);
//             this.x = translate.x, this.y = translate.y;
//             let size = area2size(o.hitarea);
//             this.sx = size.x, this.sy = size.y;
//         }
//         else {
//             this.x = o.x, this.y = o.y;
//             this.sx = o.sx, this.sy = o.sy;
//         }
//         this.pos = trunc_vec3(this.pos);
//         this.size = trunc_vec3(this.size);
//         this.sprite.sx = this.size.x + 1;
//         this.sprite.sy = this.size.y + 1;
//     }

//     public get target() {
//         return this.#highlighted_obj;
//     }

//     public set target(o: WorldObject) {
//         if (!o) {
//             if (this.#highlighted_obj) {
//                 this.#highlighted_obj.removeComponent(DebugHighlightComponent);
//                 this.#highlighted_obj = null;
//             }
//             this.x = this.y = this.sx = this.sy = 0;
//             this.visible = false;
//             return;
//         }

//         if (o.id === this.id) return; // Don't highlight self

//         this.#highlighted_obj = o;
//         if (!o.getComponent(DebugHighlightComponent)) {
//             o.addComponent(new DebugHighlightComponent(o.id));
//         }
//         this.setHighlightPos(o);
//         this.visible = true;
//     }
// }

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
        $.paused = prevPausedState;
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
        prevPausedState = $.paused; // Remember the original paused-state so that we can return to that state
        $.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
    }

    const [dialogDiv, contentDiv] = createDebugDialog('Objects', previous);

    let table = addContent(contentDiv, 'table', null);
    let headerRow = addContent(table, 'tr', null);
    addContent(headerRow, 'th', 'Type');
    addContent(headerRow, 'th', 'ID');

    $.world.activeObjects.forEach(o => {
        let row = addContent(table, 'tr', null);
        row.classList.add('selectableoption');
        addContent(row, 'td', `${o.constructor?.name}`);
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
        addContent(row, 'td', listener.name);
        addContent(row, 'td', subscriber.constructor?.name);
    });

    document.body.insertBefore(dialogDiv, null);
}

export function handleOpenDebugMenu(e: UIEvent): void {
    if (e && e.type !== 'keydown') return;
    prevPausedState = $.paused; // Remember the original paused-state so that we can return to that state
    $.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!

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
        prevPausedState = $.paused; // Remember the original paused-state so that we can return to that state
        $.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
        draggedObj = null; // Make sure that we stop dragging any object
    }

    openObjectDetailMenu($.world, 'The Model', previous);
}

function openObjectDetailMenu(obj: any, title: string, previous?: HTMLElement): void {
    if (!previous) {
        prevPausedState = $.paused; // Remember the original paused-state so that we can return to that state
        $.paused = true; // TODO: DOES NOT WORK. WE NEED TO MAKE SURE THAT THIS FUNCTION ONLY WORKS WHEN NO DIALOGS ARE OPEN!
    }

    // Use ObjectPropertyDialog for live-refresh
    if (obj) {
        if (obj.id != null) {
            ObjectPropertyDialog.openDialogById(obj.id, title, ['objects']);
            // Optionally, position or focus dialog if needed
        }
        else {
            const [dialogDiv, contentDiv] = createDebugDialog(title, previous);
            createObjectTableElement(dialogDiv, contentDiv, obj, title, ['objects']);
            document.body.insertBefore(dialogDiv, null);
        }
    }
}

export function handleDebugClick(e: MouseEvent): void {
    if (!e.shiftKey && e.ctrlKey && !draggedObj) { // Only open when main or middle button is clicked and shift is not pressed and ctrl is pressed and no object is being dragged
        const { objUnderCursor } = getWorldObjectAtCursor(e);
        if (objUnderCursor) {
            openObjectDetailMenu(objUnderCursor, objUnderCursor.id);
        }
    }
}

function getWorldObjectAtCursor(e: MouseEvent): { objUnderCursor: WorldObject | null; offsetToCursor: vec2 | null; } {
    const x = e.offsetX;
    const y = e.offsetY;
    const p = div_vec2(new_vec2(x, y), $.view.viewportScale);

    const pointArea = { start: { x: p.x, y: p.y }, end: { x: p.x, y: p.y } };

    const objsUnderCursor: WorldObject[] = $.world.activeObjects.filter(o =>
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
        const { objUnderCursor } = getWorldObjectAtCursor(e);
        if (objUnderCursor) {
            HitBoxVisualizer.toggle(objUnderCursor);
        }
    }

    if (e.button !== 0) {
        draggedObj = null; // Stop dragging object
        return; // Only start dragging when primary button is pressed
    }

    if (!e.shiftKey) { // Only start or continue dragging when shift is pressed. Note that the shift key is not updated after the mouse is pressed down
        draggedObj = null; // Stop dragging object
        return;
    }

    if (!draggedObj) { // Only start dragging when no object is currently being dragged
        let { objUnderCursor, offsetToCursor } = getWorldObjectAtCursor(e); // Get the object under the cursor and the offset from the cursor to the object's position
        if (objUnderCursor && offsetToCursor) { // Only start dragging when an object is under the cursor and the offset is valid (i.e. the object has a position)
            e.preventDefault();
            startDragWorldObject(objUnderCursor!, offsetToCursor!); // Start dragging the object under the cursor around
        }
        else { // Otherwise, continue dragging the object that is already being dragged
            handleDebugMouseMove(e); // Update the dragged object's position when the mouse is pressed down and moved
        }
    }
}

export function handleDebugMouseMove(e: MouseEvent): void {
    const { objUnderCursor } = getWorldObjectAtCursor(e);

    // We can't use the player input because they are not updated when the game is paused
    // Get the state of the Control key directly from the browser API
    if (e.ctrlKey) {
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
            draggedObj.x_nonotify = ~~x - draggedObjCursorOffset.x;
            draggedObj.y_nonotify = ~~y - draggedObjCursorOffset.y;
        }
        if (!e.shiftKey) {
            draggedObj = null; // Stop dragging object when shift is released
        }
    }
    // Vraag een enkele veilige render aan via de main loop (alleen als paused).
    // Geen directe draw -> minder batch/particle side-effects bij snel hoveren.
    $.requestPausedFrame();
}

function highlight_object(o: WorldObject) {
    if (!o) {
        currentHighlighterComponent && currentHighlighterComponent.isAttached && currentHighlighterComponent.detach();
    }
    else {
        if (!currentHighlighterComponent) {
            currentHighlighterComponent = new ObjectHighlighterComponent({ parentid: o.id });
        }
        currentHighlighterComponent.attach(o.id); // Also automatically detaches it
    }
}

export function handleDebugMouseUp(_e: MouseEvent): void {
    draggedObj = null;
}

export function handleDebugMouseOut(_e: MouseEvent): void {
    highlight_object(null);
    draggedObj = null;
}

function startDragWorldObject(worldobject_at_cursor: WorldObject, offsetToCursor: vec2): void {
    draggedObj = worldobject_at_cursor;
    draggedObjCursorOffset = new_vec2(~~offsetToCursor.x, ~~offsetToCursor.y);
}

export function removeStateMachineVisualizer(objId: Identifier): void {
    if (stateMachineVisualisers[objId]) {
        delete stateMachineVisualisers[objId];
    }
}

export function handleContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const { objUnderCursor } = getWorldObjectAtCursor(e);
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
// Guard against Node environment (rompacker) where 'window' is not defined
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('frame', refreshDialogs);
    window.addEventListener('rewind', refreshDialogs);
}
