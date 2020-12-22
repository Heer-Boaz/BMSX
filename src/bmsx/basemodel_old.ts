import { Point, Direction } from "./common";
import { IGameObject, cbst, BaseModel, Savegame } from './engine';

export abstract class BaseModelOld extends BaseModel {
    public id2object: { [key: string]: IGameObject; };
    public objects: IGameObject[];
    public gameState: number;
    public gameSubstate: number;
    public gameOldState: number;
    public gameOldSubstate: number;
    public paused: boolean;
    public startAfterLoad: boolean;

    public run(elapsedMs?: number): void {
        global.controller.takeTurn(elapsedMs);
    }

    public get oldGameState(): number {
        return this.gameOldState;
    }

    public set oldGameState(value: number) {
        this.gameOldState = value;
    }

    public get state(): number {
        return this.gameState;
    }

    public set state(value: number) {
        this.gameState = value;
    }

    public get oldGameSubstate(): number {
        return this.gameOldSubstate;
    }

    public set oldGameSubstate(value: number) {
        this.gameOldSubstate = value;
    }

    public get substate(): number {
        return this.gameSubstate;
    }

    public set substate(value: number) {
        this.gameSubstate = value;
    }

    public abstract get gamewidth(): number;
    public abstract get gameheight(): number;

    constructor() {
        super();
        this.objects = [];
        this.id2object = {};
        this.gameState = 0;
        this.gameSubstate = 0;
        this.oldGameState = 0;
        this.oldGameSubstate = 0;

        this.paused = false;
    }
    protected buildStates(): void {
        throw new Error("Method not implemented.");
    }

    public load(serialized: string): void {
        throw new Error("Method not implemented.");
    }
    public save(): string {
        throw new Error("Method not implemented.");
    }

    public defaultrun(): void {
        throw new Error("Method not implemented.");
    }
    public where_do(predicate: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => unknown, callbackfn: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => void): void {
        throw new Error("Method not implemented.");
    }
    public clear(): void {
        throw new Error("Method not implemented.");
    }
    public sortObjectsByPriority(): void {
        throw new Error("Method not implemented.");
    }

    public onloaded(): void {
        throw new Error("Method not implemented.");
    }

    public abstract initModelForGameStart(): void;

    public clearModel(): void {
        this.objects.forEach(o => o.ondispose?.());
        this.objects.length = 0;
        delete this.id2object;
        this.id2object = {};
        this.paused = false;
    }

    public spawn(o: IGameObject, pos?: Point): void {
        this.objects.push(o);

        this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));

        this.id2object[o.id] = o;
        o.onspawn?.(pos);
    }

    public exile(o: IGameObject): void {
        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this.id2object[o.id])
            this.id2object[o.id] = undefined;
        o.ondispose?.();
    }

    public exists(id: string): boolean {
        return this.id2object[id] !== undefined;
    }

    public abstract collidesWithTile(o: IGameObject, dir: Direction): boolean;
    public abstract isCollisionTile(x: number, y: number): boolean;
}
