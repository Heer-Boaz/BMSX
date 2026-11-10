import type { Blua32ExecutionImage } from './execution_image';
import { ValueTag } from './value';

/** Region bindings retain raw Values; other numeric definitions remain block-local. */
export class JavaScriptRegisterCache {
	private readonly numbers = new Map<number, string>();
	private readonly published = new Set<number>();
	public localCount = 0;
	public readonly residents: Map<number, boolean>;

	public constructor(private readonly image: Blua32ExecutionImage, residents: ReadonlyMap<number, boolean>,
		private readonly outputs: ReadonlySet<number>) {
		this.residents = new Map(residents);
	}

	public numberOperand(selector: number): string {
		if (selector < 0) {
			const index = -selector - 1;
			return this.image.constTags[index] === ValueTag.Number ? `k[${index}]` : 'NaN';
		}
		const local = this.numbers.get(selector);
		return local !== undefined ? local : this.residents.has(selector)
			? `(rt${selector}===${ValueTag.Number}?rs${selector}:NaN)` : `r.getNumber(${selector})`;
	}

	public tagOperand(selector: number): string {
		if (selector < 0) return `${this.image.constTags[-selector - 1]}`;
		return this.numbers.has(selector) ? `${ValueTag.Number}` : this.residents.has(selector) ? `rt${selector}` : `r.getTag(${selector})`;
	}

	public scalarOperand(selector: number): string {
		if (selector < 0) return `k[${-selector - 1}]`;
		const local = this.numbers.get(selector);
		return local !== undefined ? local : this.residents.has(selector) ? `rs${selector}` : `r.getScalar(${selector})`;
	}

	public referenceOperand(selector: number): string {
		return selector < 0 || this.numbers.has(selector) ? 'null' : this.residents.has(selector) ? `rv${selector}` : `r.getReference(${selector})`;
	}

	public truthy(register: number): string {
		return this.numbers.has(register) ? 'true' : this.residents.has(register)
			? `(rt${register}!==${ValueTag.Nil}&&rt${register}!==${ValueTag.False})` : `r.isTruthy(${register})`;
	}

	public writeNumber(register: number, expression: string): string {
		const local = `n${this.localCount++}`;
		this.numbers.set(register, local);
		this.published.delete(register);
		if (this.residents.has(register) || this.outputs.has(register)) this.residents.set(register, true);
		return `const ${local}=f(${expression});${this.residents.has(register) ? `rt${register}=${ValueTag.Number};rs${register}=${local};rv${register}=null;` : ''}`;
	}

	public writeEncoded(register: number, tag: string, scalar: string, reference: string): string {
		this.discard(register);
		if (this.residents.has(register) || this.outputs.has(register)) this.residents.set(register, true);
		return this.residents.has(register) ? `rt${register}=${tag};rs${register}=${scalar};rv${register}=${reference};`
			: `r.setEncoded(${register},${tag},${scalar},${reference});`;
	}

	public copy(register: number, source: number): string {
		if (register === source) return '';
		this.published.delete(register);
		const local = this.numbers.get(source);
		if (local !== undefined) {
			this.numbers.set(register, local);
			if (this.residents.has(register) || this.outputs.has(register)) this.residents.set(register, true);
			return this.residents.has(register) ? `rt${register}=${ValueTag.Number};rs${register}=${local};rv${register}=null;` : '';
		}
		const tag = this.tagOperand(source), scalar = this.scalarOperand(source), reference = this.referenceOperand(source);
		return this.writeEncoded(register, tag, scalar, reference);
	}

	public copyFrom(register: number, bank: string, source: string): string {
		this.discard(register);
		return this.residents.has(register) || this.outputs.has(register)
			? this.writeEncoded(register, `${bank}.getTag(${source})`, `${bank}.getScalar(${source})`, `${bank}.getReference(${source})`)
			: `r.copySlotFrom(${bank},${register},${source});`;
	}

	public reloadRange(first: number, end: number): string {
		let source = '';
		for (const register of this.residents.keys()) if (register >= first && register < end) {
			source += `rt${register}=r.getTag(${register});rs${register}=r.getScalar(${register});rv${register}=r.getReference(${register});`;
			this.published.add(register);
		}
		return source;
	}

	public writeResidents(): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && !this.published.has(register))
			source += `r.setEncoded(${register},rt${register},rs${register},rv${register});`;
		return source;
	}

	/** Retain common locals; only departing dirty bindings return to the bank. */
	public transferResidents(target: ReadonlyMap<number, boolean>): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && target.get(register) !== true && !this.published.has(register))
			source += `r.setEncoded(${register},rt${register},rs${register},rv${register});`;
		for (const register of target.keys()) if (!this.residents.has(register))
			source += `rt${register}=r.getTag(${register});rs${register}=r.getScalar(${register});rv${register}=r.getReference(${register});`;
		return source;
	}

	public discard(register: number): void { this.numbers.delete(register); this.published.delete(register); }
	public discardRange(first: number, end: number): void {
		for (const register of this.numbers.keys()) if (register >= first && register < end) this.discard(register);
	}

	public prepareDynamicOverwrite(first: number, count: string): string {
		let source = '';
		for (const [register, written] of this.residents) if (written && register >= first && !this.published.has(register))
			source += `if(${count}<=${register - first}) r.setEncoded(${register},rt${register},rs${register},rv${register});`;
		for (const [register, local] of this.numbers) {
			if (register < first) continue;
			if (!this.residents.has(register) && !this.published.has(register)) source += `if(${count}<=${register - first}) r.setEncoded(${register},${ValueTag.Number},${local},null);`;
			this.discard(register);
		}
		return source;
	}

	public writeBack(includeResidents = false): string {
		let source = '';
		for (const [register, local] of this.numbers) if (!this.residents.has(register) && !this.published.has(register)) source += `r.setEncoded(${register},${ValueTag.Number},${local},null);`;
		return source + (includeResidents ? this.writeResidents() : '');
	}

	public publishRange(first: number, end: number): string {
		let source = '';
		for (const [register, local] of this.numbers) {
			if (register < first || register >= end || this.residents.has(register) || this.published.has(register)) continue;
			source += `r.setEncoded(${register},${ValueTag.Number},${local},null);`;
			this.published.add(register);
		}
		for (const [register, written] of this.residents) {
			if (!written || register < first || register >= end || this.published.has(register)) continue;
			source += `r.setEncoded(${register},rt${register},rs${register},rv${register});`;
			this.published.add(register);
		}
		return source;
	}

	public exit(index: number): string { return `{${this.writeBack(true)}exit=${index};break region;}`; }
}
