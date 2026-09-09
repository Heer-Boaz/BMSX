import type { ElkNode } from 'elkjs/lib/elk-api';

/** The unmodified elkjs 0.12.0 dispatcher protocol (ElkJs.exportLayout), not a BMSX RPC. */
export type GraphLayoutRequest = { readonly id: number } & (
	| { readonly cmd: 'register'; readonly algorithms: readonly string[] }
	| { readonly cmd: 'layout'; readonly graph: ElkNode }
);
export type GraphLayoutReply = { readonly id: number } & (
	| { readonly data?: ElkNode }
	| { readonly error: unknown }
);
