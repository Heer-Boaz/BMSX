import type { World } from '../core/world';
import { EventEmitter } from '../core/eventemitter';
import { $ } from '../core/game';
import { ECSystem, TickGroup } from '../ecs/ecsystem';
import type { Identifier, RegisterablePersistent } from '../rompack/rompack';
import { AbilitySystemComponent } from './abilitysystem';
import type { AbilityYield } from './gastypes';
import { Registry } from 'bmsx';

export type TaskYield = AbilityYield; // Reuse wait engine

export type TaskFn = (ctx: TaskContext) => Generator<TaskYield, void, void>;

export interface TaskContext {
	owner_id?: Identifier;
	model: World;
	director: TaskDirector;
	emit: (name: string, payload?: any) => void;
}

type WaitState =
	| { kind: 'time'; until: number }
	| { kind: 'event'; name: string; unsub: () => void };

type RunnerKind = 'world' | 'actor';

export class TaskRunner {
	readonly id: string;
	readonly kind: RunnerKind;
	readonly ownerId?: Identifier;
	co: Generator<TaskYield, void, void>;
	wait?: WaitState;

	constructor(id: string, kind: RunnerKind, co: Generator<TaskYield, void, void>, ownerId?: Identifier) {
		this.id = id; this.kind = kind; this.co = co; this.ownerId = ownerId;
	}
}

export class TaskDirector implements RegisterablePersistent {
	public get registrypersistent(): true { return true; }
	public get id(): 'task_director' { return 'task_director'; }

	private static _instance: TaskDirector;
	public static get instance(): TaskDirector { return this._instance ?? (this._instance = new TaskDirector()); }

	private _runners = new Map<string, TaskRunner>();
	private _counter = 0;

	private constructor() { this.bind(); }

	public dispose(): void { // TODO: VERIFY!!
		this.unbind();
		for (const runner of this._runners.values()) {
			runner.co.return();
		}
		this._runners.clear();
	}

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this);
	}

	public get runners(): Iterable<TaskRunner> { return this._runners.values(); }

	private makeCtx(owner_id?: Identifier): TaskContext {
		return {
			owner_id: owner_id,
			model: $.world,
			director: this,
			emit: (name: string, payload?: any) => EventEmitter.instance.emit(name, $.get(owner_id), payload)
		};
	}

	public playWorld(task: TaskFn): string {
		const id = `t#${this._counter++}`;
		const co = task(this.makeCtx());
		this._runners.set(id, new TaskRunner(id, 'world', co));
		return id;
	}

	public playActor(owner_id: Identifier, task: TaskFn): string {
		const id = `t#${this._counter++}`;
		const co = task(this.makeCtx(owner_id));
		this._runners.set(id, new TaskRunner(id, 'actor', co, owner_id));
		return id;
	}

	public cancel(id: string): void {
		const r = this._runners.get(id);
		if (!r) return;
		if (r.wait?.kind === 'event') r.wait.unsub();
		this._runners.delete(id);
	}

	public cancelWorld(): void {
		for (const [id, r] of [...this._runners]) if (r.kind === 'world') this.cancel(id);
	}

	public cancelOwner(ownerId: Identifier): void {
		for (const [id, r] of [...this._runners]) if (r.ownerId === ownerId) this.cancel(id);
	}

	// Helpers for combinators
	public whenAny(ids: string[]): string {
		const groupId = `tg#${this._counter++}`;
		const name = `task_group_any_${groupId}`;
		const token: any = { __taskAny: true, groupId };
		let fired = false;
		const handler = () => {
			if (fired) return; fired = true;
			EventEmitter.instance.emit(name, { id: 'task' });
			EventEmitter.instance.removeSubscriber(token);
		};
		for (const id of ids) {
			const listener = (evName: string) => { if (evName === `task_done_${id}`) handler(); };
			EventEmitter.instance.on(`task_done_${id}`, listener, token, undefined, false);
		}
		return name;
	}
}

export class TaskRuntimeSystem extends ECSystem {
	constructor(priority: number = 33) { super(TickGroup.Simulation, priority); }
	update(_model: World): void {
		const now = performance.now();
		for (const runner of [...TaskDirector.instance.runners]) {
			// Cancel actor task if owner gone
			if (runner.ownerId && !$.world.exists(runner.ownerId)) { TaskDirector.instance.cancel(runner.id); continue; }
			// Honor waits
			if (runner.wait) {
				if (runner.wait.kind === 'time') { if (now < runner.wait.until) continue; runner.wait = undefined; }
				else if (runner.wait.kind === 'event') continue;
			}
			const { done, value } = runner.co.next();
			if (done) { this.finish(runner); continue; }
			if (!value || typeof value !== 'object' || !('type' in value)) continue;
			switch (value.type) {
				case 'waitTime': runner.wait = { kind: 'time', until: now + value.ms }; break;
				case 'waitEvent': {
					const name = value.name; const token: any = { __taskWait: true, id: runner.id };
					const listener = (evName: string) => { if (evName === name) { const r = [...TaskDirector.instance.runners].find(x => x.id === runner.id); if (!r) return; if (r.wait?.kind === 'event') { r.wait.unsub(); r.wait = undefined; } } };
					EventEmitter.instance.on(name, listener, token, undefined, false);
					runner.wait = { kind: 'event', name, unsub: () => EventEmitter.instance.removeSubscriber(token) };
					break;
				}
				case 'waitTag': {
					const asc = runner.ownerId ? $.world.getWorldObject(runner.ownerId)?.getComponent?.(AbilitySystemComponent) as AbilitySystemComponent : undefined;
					if (!asc) break; // no-op if no ASC
					if ((asc as AbilitySystemComponent).hasGameplayTag(value.tag) !== value.present) {
						// emulate tag wait via polling next tick
						runner.wait = { kind: 'time', until: now }; // wake next frame
					}
					break;
				}
				case 'finish': this.finish(runner); break;
			}
		}
	}

	private finish(r: TaskRunner): void {
		if (r.wait?.kind === 'event') r.wait.unsub();
		TaskDirector.instance.cancel(r.id);
		EventEmitter.instance.emit(`task_done_${r.id}`, { id: 'task' });
	}
}

// --- Core tasks ---

export const Wait = (ms: number): TaskFn => function* () { yield { type: 'waitTime', ms }; };
export const WaitEvent = (name: string): TaskFn => function* () { yield { type: 'waitEvent', name }; };
export const WaitTag = (tag: string, present: boolean = true): TaskFn => function* () { yield { type: 'waitTag', tag, present }; };

export const SetTag = (owner: Identifier, tag: string, present: boolean): TaskFn => function* (_ctx) {
	const wo = $.world.getWorldObject(owner);
	const asc = wo?.getComponent?.(AbilitySystemComponent) as AbilitySystemComponent | undefined;
	if (asc) present ? asc.addTag(tag) : asc.removeTag(tag);
};

export const ApplyEffect = (owner: Identifier, effect: Parameters<AbilitySystemComponent['applyEffect']>[0]): TaskFn => function* () {
	const wo = $.world.getWorldObject(owner);
	const asc = wo?.getComponent?.(AbilitySystemComponent) as AbilitySystemComponent | undefined;
	if (asc) asc.applyEffect(effect);
};

// The following emit events that systems can consume to perform the action
export const PlayAnim = (owner: Identifier, clip: string): TaskFn => function* (ctx) { ctx.emit('task_play_anim', { owner, clip }); };
export const MoveTo = (owner: Identifier, x: number, y: number, speed?: number): TaskFn => function* (ctx) { ctx.emit('task_move_to', { owner, x, y, speed }); };
export const CameraPan = (to: { x: number; y: number }, ms: number): TaskFn => function* (ctx) { ctx.emit('task_camera_pan', { to, ms }); };
export const ShowDialogue = (text: string): TaskFn => function* (ctx) { ctx.emit('task_dialogue', { text }); };
export const Spawn = (prefabId: Identifier, at: { x: number; y: number }): TaskFn => function* (ctx) { ctx.emit('task_spawn', { prefabId, at }); };
export const Despawn = (owner: Identifier): TaskFn => function* (ctx) { ctx.emit('task_despawn', { owner }); };

// --- Combinators ---

export const Sequence = (...tasks: TaskFn[]): TaskFn => function* (ctx) { for (const t of tasks) { yield* t(ctx); } };

export const Parallel = (...tasks: TaskFn[]): TaskFn => function* (ctx) {
	const ids = tasks.map(t => ctx.director.playWorld(function* () { yield* t(ctx); }));
	for (const id of ids) { yield { type: 'waitEvent', name: `task_done_${id}` }; }
};

export const Race = (...tasks: TaskFn[]): TaskFn => function* (ctx) {
	const ids = tasks.map(t => ctx.director.playWorld(function* () { yield* t(ctx); }));
	const name = ctx.director.whenAny(ids);
	yield { type: 'waitEvent', name };
};
