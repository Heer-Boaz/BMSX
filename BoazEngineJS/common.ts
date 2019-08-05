/// <reference path="interfaces.ts"/>
/// <reference path="btimer.ts"/>

import { BStopwatch } from "./btimer"
import { Direction } from "./direction";

export function moveArea(a: Area, p: Point): Area {
    return <Area>{
        start: <Point>{ x: a.start.x + p.x, y: a.start.y + p.y },
        end: <Point>{ x: a.end.x + p.x, y: a.end.y + p.y },
    };
}

export function addPoints(a: Point, b: Point): Point {
    return <Point>{ x: a.x + b.x, y: a.y + b.y };
}

/// http://stackoverflow.com/questions/4959975/generate-random-value-between-two-numbers-in-javascript
export function randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

export function copyPoint(toCopy: Point): Point {
    return <Point>{ x: toCopy.x, y: toCopy.y };
}

export function newArea(sx: number, sy: number, ex: number, ey: number): Area {
    return <Area>{ start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

export function newSize(x: number, y: number): Size {
    return <Size>{ x: x, y: y };
}

/// Alternative implementation for Point.Set()
export function setPoint(p: Point, new_x: number, new_y: number) {
    p.x = new_x;
    p.y = new_y;
}

export function area2size(a: Area) {
    return <Size>{ x: a.end.x - a.start.x, y: a.end.y - a.start.y };
}

/// <summary>
/// Wait for a timeframe to elapse.
/// This method increases the given elapsedMs by the gametime.
/// If the elapsedMs is smaller than the duration, false is returned, else true.
/// In addition, if true is returned, elapsedMs is set to 0
/// </summary>
/// <param name="elapsedMs">The current amount of ms that has elapsed since the last call</param>
/// <param name="duration">The duration of the timeframe</param>
/// <returns>True iff elapsedMs >= duration</returns>
export function waitDuration(timer: BStopwatch, duration: number): boolean {
    if (!timer.running) timer.restart(); // FIXME: Dirty fix for bugs!

    if (timer.elapsedMilliseconds >= duration) {
        timer.restart();
        return true;
    }
    return false;
}

export function addToScreen(element: HTMLElement): void {
    let gamescreen = document.getElementById('gamescreen');
    gamescreen.appendChild(element);
}

export function removeFromScreen(element: HTMLElement): void {
    let gamescreen = document.getElementById('gamescreen');
    gamescreen.removeChild(element);
}

export function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement {
    let result = document.createElement('div');
    if (classnames) {
        classnames.forEach(x => {
            result.classList.add(x);
        });
    }

    let rimg = document.createElement('img');
    if (imgsrc) rimg.src = imgsrc;
    else if (img) rimg.src = img.src;
    else throw ('Cannot create sprite without an image or image source!');

    result.appendChild(rimg);

    return result;
}

export function GetDeltaFromSourceToTarget(source: Point, target: Point): Point {
    let delta = <Point>{ x: 0, y: 0 };

    if (Math.abs(target.x - source.x - 0) < 0.01) {
        delta.x = 0;
        delta.y = (target.y - source.y) > 0 ? 1 : -1;
    }
    else if (Math.abs(target.y - source.y - 0) < 0.01) {
        delta.x = (target.x - source.x) > 0 ? 1 : -1;
        delta.y = 0;
    }
    else if (Math.abs((target.x - source.x)) > Math.abs((target.y - source.y))) {
        delta.x = (target.x - source.x) > 0 ? 1 : -1;
        delta.y = (target.y - source.y) / (Math.abs(target.x - source.x));
    }
    else {
        delta.x = (target.x - source.x) / (Math.abs(target.y - source.y));
        delta.y = (target.y - source.y) > 0 ? 1 : -1;
    }

    return delta;
}

export function LineLength(p1: Point, p2: Point): number {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - 1;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
export function storageAvailable(type: string): boolean {
    try {
        var storage = window[type],
            x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch (e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.code === 22 ||
            // Firefox
            e.code === 1014 ||
            // test name field too, because code might not be present
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            storage.length !== 0;
    }
}

export function localStorageAvailable(): boolean {
    return storageAvailable('localStorage');
}

export function sessionStorageAvailable(): boolean {
    return storageAvailable('sessionStorage');
}

// export class Extensions
//                 {
// public static Dir2dx:Dictionary<Direction,number>  =  __init(new Dictionary<Direction,number>  (),{ { Direction.Up,0 },{ Direction.Right,1 },{ Direction.Down,0 },{ Direction.Left,-1 } });
// public static Dir2dy:Dictionary<Direction,number>  =  __init(new Dictionary<Direction,number>  (),{ { Direction.Up,-1 },{ Direction.Right,0 },{ Direction.Down,1 },{ Direction.Left,0 } });
export function LookAt(subjectpos: Point, targetpos: Point): Direction {
    let delta: Point = <Point>{ x: subjectpos.x - targetpos.x, y: subjectpos.x - targetpos.y };
    if (Math.abs(delta.x) >= Math.abs(delta.y)) {
        if (delta.x < 0)
            return Direction.Right;
        else return Direction.Left;
    }
    else {
        if (delta.y < 0)
            return Direction.Down;
        else return Direction.Up;
    }
}

export function Opposite(dir: Direction): Direction {
    switch (dir) {
        case Direction.Up:
            return Direction.Down;
        case Direction.Right:
            return Direction.Left;
        case Direction.Down:
            return Direction.Up;
        case Direction.Left:
            return Direction.Right;
        default:
            return Direction.None;
    }
}