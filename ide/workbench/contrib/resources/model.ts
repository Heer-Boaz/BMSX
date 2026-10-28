import type { RuntimeResource } from '../../../common/resource';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import type { RomToolingLayer } from '../../../../toolchain/ts/rompack/loader';

export type ResourceViewerContent = {
	resource: RuntimeResource;
	lines: string[];
	error: string;
	title: string;
	image?: {
		readonly asset: RomAsset;
		readonly rom: RomToolingLayer | null;
	};
};

export type ResourceViewerContentView = 'preview' | 'info';

/** Input-owned view state survives replacement of the source-derived content. */
export type ResourceViewerState = {
	readonly content: ResourceViewerContent;
	scroll: number;
	scrollLeft: number;
	contentView: ResourceViewerContentView;
};
