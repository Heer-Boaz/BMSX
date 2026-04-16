import { clamp } from '../../../../common/clamp';
import type { SearchMatch } from '../../../common/types';

export type ReferenceMatchInfo = {
	matches: SearchMatch[];
	expression: string;
	definitionKey: string;
	documentVersion: number;
};

const EMPTY_REFERENCE_MATCHES: SearchMatch[] = [];

export class ReferenceState {
	private matches: SearchMatch[] = EMPTY_REFERENCE_MATCHES;
	private activeIndex = -1;
	private expression: string = null;
	private definitionKey: string = null;

	public clear(): void {
		this.matches = EMPTY_REFERENCE_MATCHES;
		this.activeIndex = -1;
		this.expression = null;
		this.definitionKey = null;
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

	public getDefinitionKey(): string {
		return this.definitionKey;
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
		this.definitionKey = info.definitionKey;
	}

	public setActiveIndex(index: number): void {
		if (this.matches.length === 0) {
			this.activeIndex = -1;
			return;
		}
		this.activeIndex = clamp(index, 0, this.matches.length - 1);
	}
}

export const referenceState = new ReferenceState();
