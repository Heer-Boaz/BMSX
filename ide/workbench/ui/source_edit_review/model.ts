import type { EditorTextModel } from '../../../editor/model/text_model';
import type { WorkbenchPropertyElement } from '../property_tree';

/** An atomic source proposal may affect many uses; rows are not independent edits. */
export type SourceEditReviewItem = {
	readonly label: string;
	readonly value: string;
	readonly description: string;
};

export type SourceEditReview = {
	readonly model: EditorTextModel;
	readonly title: string;
	readonly summary: string;
	readonly items: readonly SourceEditReviewItem[];
	apply(): void;
	openSource(index: number): void;
};

export type SourceEditReviewElement = WorkbenchPropertyElement & { readonly index: number };
