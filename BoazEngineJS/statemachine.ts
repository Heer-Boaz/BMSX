import { anidata } from './statemachine';
import { Point, IGameObject } from './interfaces';

export interface anidata<A extends any | null | {}> {
	delta: number;
	data: A;
}

export type str2bst<T extends object, A extends any | null> = { [key: string]: bst<T, A>; };
export type runhandle<T extends object, A extends any | null> = (_state: bst<T, A>, ...input: any[]) => any;
export type bsfthandle<T extends object, A extends any | null> = (_state: bst<T, A>) => void;
export type numstring = number | string;

export function animatepos(st: bst<IGameObject, anidata<Point>>, delta: number): void {
	let tapedata = () => st.statedata[st.tapehead];

	st.delta2tapehead += delta;
	if (st.delta2tapehead >= tapedata().delta) {
		st.delta2tapehead = 0;
		++st.tapehead;
		if (st.endoftape) {
			st.ontapeend && st.ontapeend(st);
		}
		else {
			st.target.pos.x += tapedata().data.x;
			st.target.pos.y += tapedata().data.y;
		}
	}
}

export function resetAnimationOnTapeEnd(st: bst<IGameObject, anidata<Point>>): void {
	st.tapehead = 0;
	st.delta2tapehead = 0;
}

export class bst<T extends object, A extends any | null>{
	public target: T;
	public statedata: A[];
	public tapehead: number;
	public delta2tapehead: number; // Number of runs before tapehead moves to next statedata

	public static readonly initstateid = 0;

	public states: str2bst<T, A>; // Note that numbers will be automatically converted to strings!
	public stateid: numstring; // Identifier of current state
	public isfinal: boolean;
	public onrun: runhandle<T, A>;
	public onfinalstate: bsfthandle<T, A>;
	public ontapeend: bsfthandle<T, A>;
	public oninitstate: bsfthandle<T, A>;
	public onexitstate: bsfthandle<T, A>;
	public get endoftape(): boolean { return !this.statedata || this.tapehead === this.statedata.length - 1; }
	public get startoftape(): boolean { return this.tapehead === 0; }

	constructor(_target: T, _composite = false, _final = false) {
		if (_composite) this.states = {};
		this.target = _target;
		this.isfinal = _final;
		this.reset();
	}

	public invoke(_state: bst<T, A>, f: runhandle<T, A> | bsfthandle<T, A>, ...args: any[]): any {
		return (!_state || !f) ? undefined : (args ? f(_state, args) : f(_state));
	}

	public get state(): bst<T, A> { return this.states[this.stateid]; };

	public run(...input: any[]) {
		let result = this.invoke(this.state, this.state.onrun, input);
		if (this.state.isfinal) this.invoke(this.state, this.state.onfinalstate);
		return result;
	}

	public switch(newstate: numstring): void {
		this.invoke(this.state, this.state.onexitstate);
		this.stateid = newstate;
		this.invoke(this.state, this.state.oninitstate);
	}

	public reset(): void {
		this.stateid = bst.initstateid;
		this.tapehead = 0;
		this.delta2tapehead = 0;
	}
}