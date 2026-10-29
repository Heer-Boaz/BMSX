import type { ResourceIdentity, RuntimeResourceLocation } from '../../../../common/resource';
import type { ProjectContentReference } from './content_index';
import type { ResourcePanelFilterMode } from './files_model';

/** An admitted namespace and authoring root, independent of its label or visible row. */
export type ResourceFilesRootReference = {
	readonly contextId: string;
	readonly locationKind: RuntimeResourceLocation['kind'];
	readonly path: string;
};

export type ResourceFilesContainerReference =
	| { readonly kind: 'root'; readonly root: ResourceFilesRootReference }
	| { readonly kind: 'directory'; readonly root: ResourceFilesRootReference; readonly path: string }
	| { readonly kind: 'physicalFile'; readonly root: ResourceFilesRootReference; readonly path: string }
	| { readonly kind: 'file'; readonly resource: ResourceIdentity };

export type ResourceFilesNodeReference = ResourceFilesContainerReference
	| { readonly kind: 'definition'; readonly content: ProjectContentReference };

/** Inert browser intent; source/declaration owners establish correspondence during recovery. */
export type ResourceFilesSnapshot = {
	readonly selected: ResourceFilesNodeReference | undefined;
	readonly disclosure: readonly { readonly node: ResourceFilesContainerReference; readonly collapsed: boolean }[];
	readonly scroll: number;
	readonly hscroll: number;
};

export type SerializedResourcePanel = {
	readonly visible: boolean;
	readonly filter: ResourcePanelFilterMode;
	readonly widthRatio: number;
	readonly focused: boolean;
	readonly view: ResourceFilesSnapshot;
};
