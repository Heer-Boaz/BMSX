/** Semantic status facts; the workbench owns all measurement, placement and disclosure. */
export type WorkbenchStatusItem = {
	text: string;
	readonly alignment: 'left' | 'right';
	/** Overflow admission within this source, not precedence over other status sources. */
	priority: number;
	readonly overflow: 'ellipsis' | 'hide';
	tone: 'normal' | 'warning' | 'error' | 'info' | 'success';
};

export const STATUS_PRIORITY_HINT = 0;
export const STATUS_PRIORITY_DETAIL = 10;
export const STATUS_PRIORITY_CONTENT = 20;
export const STATUS_PRIORITY_ERROR = 30;

export const EMPTY_STATUS_ITEMS: readonly WorkbenchStatusItem[] = [];

/** The attached view publishes full facts before the shared status presentation is arranged. */
export interface WorkbenchStatusSource {
	readonly statusItems: readonly WorkbenchStatusItem[];
	/** Guidance for an ongoing user interaction takes precedence over ordinary feedback. */
	readonly interactionActive?: boolean;
	updateStatus(): void;
}
