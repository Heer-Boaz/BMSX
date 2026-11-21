import { f32BitsToNumber } from '../../common/float32';
import type { Blua32ExecutionImage } from './execution_image';
import { ValueTag } from './value';

type LocalValue = { readonly tag: string; readonly word: string };

/**
 * Region exits store their dirty registers once, after the region loop. Every
 * site that leaves through the same exit with the same stores shares that
 * code; a site with different stores gets a negative alias that the epilogue
 * maps back to its exit.
 */
export class CompiledExitWriteBacks {
	private readonly stores = new Map<number, string>();
	private readonly aliases: { readonly index: number; readonly stores: string }[] = [];

	public leave(index: number, stores: string): string {
		const shared = this.stores.get(index);
		if (shared === undefined) this.stores.set(index, stores);
		else if (shared !== stores) {
			let alias = this.aliases.findIndex(entry => entry.index === index && entry.stores === stores);
			if (alias < 0) alias = this.aliases.push({ index, stores }) - 1;
			return `X=${-1 - alias};break R;`;
		}
		return `X=${index};break R;`;
	}
	public epilogue(): string {
		const labels = new Map<string, string>();
		for (const [index, stores] of this.stores) if (stores !== '') labels.set(stores, `${labels.get(stores) ?? ''}case ${index}:`);
		let source = '';
		for (const [stores, cases] of labels) source += `${cases}${stores}break;`;
		for (let alias = 0; alias < this.aliases.length; ++alias)
			source += `case ${-1 - alias}:${this.aliases[alias].stores}X=${this.aliases[alias].index};break;`;
		return source === '' ? '' : `switch(X){${source}}`;
	}
}

/** Locals carry the same tag/word pair as storage, never decoded host objects. */
export class JavaScriptRegisterCache {
	private readonly locals = new Map<number, LocalValue>();
	private readonly published = new Set<number>();
	public localCount = 0;
	public readonly residents: Map<number, boolean>;

	public constructor(residents: ReadonlyMap<number, boolean>,
		private readonly outputs: ReadonlySet<number>, private readonly exits: CompiledExitWriteBacks,
		private readonly constants: Blua32ExecutionImage) {
		this.residents = new Map(residents);
	}
	public tagOperand(selector: number): string {
		if (selector < 0) return `${this.constants.constTags[-selector - 1]}`;
		return this.locals.get(selector)?.tag ?? (this.residents.has(selector) ? `y${selector}` : `r.t(${selector})`);
	}
	public wordOperand(selector: number): string {
		if (selector < 0) return `${this.constants.constWords[-selector - 1]}`;
		return this.locals.get(selector)?.word ?? (this.residents.has(selector) ? `z${selector}` : `r.p(${selector})`);
	}
	/** Exact int/f32 value for comparisons; arithmetic rounds Integer inputs separately. */
	public numberOperand(selector: number): string {
		if (selector < 0) {
			const slot = -selector - 1, bits = this.constants.constWords[slot];
			if (this.constants.constTags[slot] === ValueTag.Integer) return `${bits | 0}`;
			const number = f32BitsToNumber(bits);
			return Object.is(number, -0) ? '-0' : `${number}`;
		}
		const tag = this.tagOperand(selector), word = this.wordOperand(selector);
		return `(${tag}===${ValueTag.Integer}?(${word}|0):bf(${word}))`;
	}
	public truthy(register: number): string {
		const tag = this.tagOperand(register);
		return `(${tag}!==${ValueTag.Nil}&&${tag}!==${ValueTag.False})`;
	}
	public writeInteger(register: number, expression: string): string {
		return this.writeEncoded(register, `${ValueTag.Integer}`, `(${expression})>>>0`);
	}
	public writeFloatBits(register: number, expression: string): string {
		return this.writeEncoded(register, `${ValueTag.Float}`, expression);
	}
	public writeEncoded(register: number, tag: string, word: string): string {
		const local = this.localCount++, t = `t${local}`, w = `w${local}`;
		// Snapshot both sources before changing a resident: MOV/SELF and loads
		// can alias a source with the destination's tag or payload.
		this.discard(register);
		this.locals.set(register, { tag: t, word: w });
		if (this.residents.has(register) || this.outputs.has(register)) this.residents.set(register, true);
		return `${t}=${tag};${w}=${word};${this.residents.has(register) ? `y${register}=${t};z${register}=${w};` : ''}`;
	}
	public copy(register: number, source: number): string {
		return register === source ? '' : this.writeEncoded(register, this.tagOperand(source), this.wordOperand(source));
	}
	public copyFrom(register: number, bank: string, source: string): string {
		return this.writeEncoded(register, `${bank}.t(${source})`, `${bank}.p(${source})`);
	}
	public reloadRange(first: number, end: number): string {
		let source = '';
		for (const register of this.residents.keys()) if (register >= first && register < end) {
			this.locals.delete(register);
			source += `y${register}=r.t(${register});z${register}=r.p(${register});`;
			this.published.add(register);
		}
		return source;
	}
	public writeResidents(): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && !this.published.has(register))
			source += `r.s(${register},y${register},z${register});`;
		return source;
	}
	/** Retain common locals; only departing dirty bindings return to the bank. */
	public transferResidents(target: ReadonlyMap<number, boolean>): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && target.get(register) !== true && !this.published.has(register))
			source += `r.s(${register},y${register},z${register});`;
		for (const register of target.keys()) if (!this.residents.has(register))
			source += `y${register}=r.t(${register});z${register}=r.p(${register});`;
		return source;
	}
	public discard(register: number): void { this.locals.delete(register); this.published.delete(register); }
	public discardRange(first: number, end: number): void {
		for (const register of this.locals.keys()) if (register >= first && register < end) this.discard(register);
	}
	public prepareDynamicOverwrite(first: number, count: string): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && register >= first && !this.published.has(register))
			source += `if(${count}<=${register - first}) r.s(${register},y${register},z${register});`;
		for (const [register, local] of this.locals) {
			if (register < first) continue;
			if (!this.residents.has(register) && !this.published.has(register)) source += `if(${count}<=${register - first}) r.s(${register},${local.tag},${local.word});`;
			this.discard(register);
		}
		return source;
	}
	public writeBack(includeResidents = false): string {
		let source = '';
		for (const [register, local] of this.locals) if (!this.residents.has(register) && !this.published.has(register))
			source += `r.s(${register},${local.tag},${local.word});`;
		return source + (includeResidents ? this.writeResidents() : '');
	}
	public publishRange(first: number, end: number): string {
		let source = '';
		for (const [register, local] of this.locals) {
			if (register < first || register >= end || this.residents.has(register) || this.published.has(register)) continue;
			source += `r.s(${register},${local.tag},${local.word});`;
			this.published.add(register);
		}
		for (const [register, written] of this.residents) {
			if (!written || register < first || register >= end || this.published.has(register)) continue;
			source += `r.s(${register},y${register},z${register});`;
			this.published.add(register);
		}
		return source;
	}
	public exit(index: number): string { return `{${this.exits.leave(index, this.writeBack(true))}}`; }
	/** Leave after the block body has already stored its non-resident locals. */
	public leaveResidents(index: number): string { return this.exits.leave(index, this.writeResidents()); }
}
