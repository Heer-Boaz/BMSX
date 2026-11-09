import type { Blua32ExecutionImage } from './execution_image';
import { ValueTag } from './value';

/** Numeric definitions remain local until an observer needs the guest slots. */
export class JavaScriptRegisterCache {
	private readonly numbers = new Map<number, string>();
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
		return `const ${local}=f(${expression});`;
	}

	public copy(register: number, source: number): string {
		const local = this.numbers.get(source);
		if (local !== undefined) {
			this.numbers.set(register, local);
			return '';
		}
		this.numbers.delete(register);
		return `r.copySlot(${register},${source});`;
	}

	public discard(register: number): void { this.numbers.delete(register); }

	public writeBack(): string {
		let source = '';
		for (const [register, local] of this.numbers) source += `r.setEncoded(${register},${ValueTag.Number},${local},null);`;
		return source;
	}

	public exit(index: number): string { return `{${this.writeBack()}return ${index};}`; }
}
