import type { RuntimeResource } from '../../../common/resource';

export type ResourceViewerContent = {
	resource: RuntimeResource;
	lines: string[];
	error: string;
	title: string;
	image?: {
		asset_id: string;
		width: number;
		height: number;
	};
};

/** Input-owned view state survives replacement of the source-derived content. */
export type ResourceViewerState = {
	content: ResourceViewerContent;
	scroll: number;
};
