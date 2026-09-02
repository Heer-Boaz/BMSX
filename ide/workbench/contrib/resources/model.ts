import type { RuntimeResource } from '../../../common/resource';

export type ResourceViewerState = {
	resource: RuntimeResource;
	lines: string[];
	error: string;
	title: string;
	scroll: number;
	image?: {
		asset_id: string;
		width: number;
		height: number;
	};
};
