import { clamp } from '../../../../machine/ts/common/clamp';
import type { SearchMatch } from '../../../common/models';
import type { SymbolID } from '../../../../toolchain/ts/lua/semantic/model';

export type ReferenceMatchInfo = {
	matches: SearchMatch[];
	expression: string;
	definitionKeys: readonly SymbolID[];
	documentVersion: number;
};

const EMPTY_REFERENCE_MATCHES: SearchMatch[] = [];

export class ReferenceState {
	private matches: SearchMatch[] = EMPTY_REFERENCE_MATCHES;
	private activeIndex = -1;
	private expression: string = null;

	public clear(): void {
		this.matches = EMPTY_REFERENCE_MATCHES;
		this.activeIndex = -1;
		this.expression = null;
	}

	public getMatches(): readonly SearchMatch[] {
		return this.matches;
	}

	public getActiveIndex(): number {
		return this.activeIndex;
	}

	public getExpression(): string {
		return this.expression;
	}

	public apply(info: ReferenceMatchInfo, activeIndex: number): void {
		this.matches = info.matches;
		if (this.matches.length === 0) {
			this.activeIndex = -1;
		} else {
			const clampedIndex = clamp(activeIndex, 0, this.matches.length - 1);
			this.activeIndex = clampedIndex;
		}
		this.expression = info.expression;
	}

}

export const referenceState = new ReferenceState();
