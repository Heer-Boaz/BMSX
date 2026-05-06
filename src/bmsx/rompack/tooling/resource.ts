import type { asset_id } from './format';

export type ResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: asset_id;
	readOnly?: boolean;
};

export type LuaResourceCreationRequest = {
	path: string;
	contents: string;
};
