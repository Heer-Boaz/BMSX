import type { Blua32ExecutionImage } from './execution_image';
import { ValueTag } from './value';

type LocalValue = { readonly tag: string; readonly word: string };

/** Locals carry the same tag/word pair as storage, never decoded host objects. */
export class JavaScriptRegisterCache {
	private readonly locals = new Map<number, LocalValue>();
	private readonly published = new Set<number>();
	public localCount = 0;
	public readonly residents: Map<number, boolean>;

	public constructor(private readonly image: Blua32ExecutionImage, residents: ReadonlyMap<number, boolean>,
		private readonly outputs: ReadonlySet<number>) {
		this.residents = new Map(residents);
	}
	public tagOperand(selector: number): string {
		if (selector < 0) return `${this.image.constTags[-selector - 1]}`;
		return this.locals.get(selector)?.tag ?? (this.residents.has(selector) ? `rt${selector}` : `r.getTag(${selector})`);
	}
	public wordOperand(selector: number): string {
		if (selector < 0) return `k[${-selector - 1}]`;
		return this.locals.get(selector)?.word ?? (this.residents.has(selector) ? `rw${selector}` : `r.getPayload(${selector})`);
	}
	/** Exact int/f32 value for comparisons; arithmetic rounds Integer inputs separately. */
	public numberOperand(selector: number): string {
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
		return `${t}=${tag};${w}=${word};${this.residents.has(register) ? `rt${register}=${t};rw${register}=${w};` : ''}`;
	}
	public copy(register: number, source: number): string {
		return register === source ? '' : this.writeEncoded(register, this.tagOperand(source), this.wordOperand(source));
	}
	public copyFrom(register: number, bank: string, source: string): string {
		return this.writeEncoded(register, `${bank}.getTag(${source})`, `${bank}.getPayload(${source})`);
	}
	public reloadRange(first: number, end: number): string {
		let source = '';
		for (const register of this.residents.keys()) if (register >= first && register < end) {
			this.locals.delete(register);
			source += `rt${register}=r.getTag(${register});rw${register}=r.getPayload(${register});`;
			this.published.add(register);
		}
		return source;
	}
	public writeResidents(): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && !this.published.has(register))
			source += `r.setEncoded(${register},rt${register},rw${register});`;
		return source;
	}
	/** Retain common locals; only departing dirty bindings return to the bank. */
	public transferResidents(target: ReadonlyMap<number, boolean>): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && target.get(register) !== true && !this.published.has(register))
			source += `r.setEncoded(${register},rt${register},rw${register});`;
		for (const register of target.keys()) if (!this.residents.has(register))
			source += `rt${register}=r.getTag(${register});rw${register}=r.getPayload(${register});`;
		return source;
	}
	public discard(register: number): void { this.locals.delete(register); this.published.delete(register); }
	public discardRange(first: number, end: number): void {
		for (const register of this.locals.keys()) if (register >= first && register < end) this.discard(register);
	}
	public prepareDynamicOverwrite(first: number, count: string): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && register >= first && !this.published.has(register))
			source += `if(${count}<=${register - first}) r.setEncoded(${register},rt${register},rw${register});`;
		for (const [register, local] of this.locals) {
			if (register < first) continue;
			if (!this.residents.has(register) && !this.published.has(register)) source += `if(${count}<=${register - first}) r.setEncoded(${register},${local.tag},${local.word});`;
			this.discard(register);
		}
		return source;
	}
	public writeBack(includeResidents = false): string {
		let source = '';
		for (const [register, local] of this.locals) if (!this.residents.has(register) && !this.published.has(register))
			source += `r.setEncoded(${register},${local.tag},${local.word});`;
		return source + (includeResidents ? this.writeResidents() : '');
	}
	public publishRange(first: number, end: number): string {
		let source = '';
		for (const [register, local] of this.locals) {
			if (register < first || register >= end || this.residents.has(register) || this.published.has(register)) continue;
			source += `r.setEncoded(${register},${local.tag},${local.word});`;
			this.published.add(register);
		}
		for (const [register, written] of this.residents) {
			if (!written || register < first || register >= end || this.published.has(register)) continue;
			source += `r.setEncoded(${register},rt${register},rw${register});`;
			this.published.add(register);
		}
		return source;
	}
	public declarations(): string {
		return Array.from({ length: this.localCount }, (_, index) => `let t${index},w${index};`).join('');
	}
	public exit(index: number): string { return `{${this.writeBack(true)}exit=${index};break region;}`; }
}
