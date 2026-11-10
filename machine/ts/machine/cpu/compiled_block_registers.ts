import type { Blua32ExecutionImage } from './execution_image';
import { ValueTag } from './value';

/** Numeric definitions remain local until an observer needs the guest slots. */
export class JavaScriptRegisterCache {
	private readonly numbers = new Map<number, string>();
	private readonly published = new Set<number>();
	public localCount = 0;

	public constructor(private readonly image: Blua32ExecutionImage) {}

	public numberOperand(selector: number): string {
		if (selector < 0) {
			const index = -selector - 1;
			return this.image.constTags[index] === ValueTag.Number ? `k[${index}]` : 'NaN';
		}
		const local = this.numbers.get(selector);
		return local === undefined ? `r.getNumber(${selector})` : local;
	}

	public tagOperand(selector: number): string {
		if (selector < 0) return `${this.image.constTags[-selector - 1]}`;
		return this.numbers.has(selector) ? `${ValueTag.Number}` : `r.getTag(${selector})`;
	}

	public scalarOperand(selector: number): string {
		if (selector < 0) return `k[${-selector - 1}]`;
		const local = this.numbers.get(selector);
		return local === undefined ? `r.getScalar(${selector})` : local;
	}

	public referenceOperand(selector: number): string {
		return selector < 0 || this.numbers.has(selector) ? 'null' : `r.getReference(${selector})`;
	}

	public truthy(register: number): string {
		return this.numbers.has(register) ? 'true' : `r.isTruthy(${register})`;
	}

	public writeNumber(register: number, expression: string): string {
		const local = `n${this.localCount++}`;
		this.numbers.set(register, local);
		this.published.delete(register);
		return `const ${local}=f(${expression});`;
	}

	public copy(register: number, source: number): string {
		if (register === source) return '';
		this.published.delete(register);
		const local = this.numbers.get(source);
		if (local !== undefined) {
			this.numbers.set(register, local);
			return '';
		}
		this.numbers.delete(register);
		return `r.copySlot(${register},${source});`;
	}

	public discard(register: number): void { this.numbers.delete(register); this.published.delete(register); }
	public discardRange(first: number, end: number): void {
		for (const register of this.numbers.keys()) if (register >= first && register < end) this.discard(register);
	}

	public prepareDynamicOverwrite(first: number, count: string): string {
		let source = '';
		for (const [register, local] of this.numbers) {
			if (register < first) continue;
			if (!this.published.has(register)) source += `if(${count}<=${register - first}) r.setEncoded(${register},${ValueTag.Number},${local},null);`;
			this.discard(register);
		}
		return source;
	}

	public writeBack(): string {
		let source = '';
		for (const [register, local] of this.numbers) if (!this.published.has(register)) source += `r.setEncoded(${register},${ValueTag.Number},${local},null);`;
		return source;
	}

	public publishRange(first: number, end: number): string {
		let source = '';
		for (const [register, local] of this.numbers) {
			if (register < first || register >= end || this.published.has(register)) continue;
			source += `r.setEncoded(${register},${ValueTag.Number},${local},null);`;
			this.published.add(register);
		}
		return source;
	}

	public exit(index: number): string { return `{${this.writeBack()}exit=${index};break region;}`; }
}
