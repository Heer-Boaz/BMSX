import type { EditorTextModel } from '../../editor/model/text_model';

/** A captured working-copy position, not an AST lookup against a later projection. */
export type SourceReviewLocation = {
	readonly model: EditorTextModel;
	readonly version: number;
	readonly offset: number;
};

/** Evidence explains one atomic edit; these items are not independently applicable changes. */
export type SourceReviewItem = {
	readonly label: string;
	readonly value: string;
	readonly description: string;
	readonly location: SourceReviewLocation;
};

export type SourceReviewEvidence = {
	readonly summary: string;
	readonly items: readonly SourceReviewItem[];
};
