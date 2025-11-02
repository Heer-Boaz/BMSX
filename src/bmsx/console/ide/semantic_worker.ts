/// <reference lib="webworker" />

import { buildLuaFileSemanticData, type SerializedFileSemanticData } from './semantic_model.ts';

type UpdateMessage = {
	type: 'update';
	requestId: number;
	version: number;
	chunkName: string;
	source: string;
};

type SemanticResultMessage = {
	type: 'semantic-result';
	requestId: number;
	version: number;
	chunkName: string;
	data: SerializedFileSemanticData;
};

type SemanticErrorMessage = {
	type: 'semantic-error';
	requestId: number;
	version: number;
	chunkName: string;
};

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<UpdateMessage>): void => {
	const message = event.data;
	try {
		const fileData = buildLuaFileSemanticData(message.source, message.chunkName);
		const serialized: SerializedFileSemanticData = {
			file: message.chunkName,
			source: fileData.source,
			lines: fileData.lines,
			annotations: fileData.annotations,
			decls: fileData.decls,
			refs: fileData.refs,
			definitions: fileData.model.definitions,
		};
		const response: SemanticResultMessage = {
			type: 'semantic-result',
			requestId: message.requestId,
			version: message.version,
			chunkName: message.chunkName,
			data: serialized,
		};
		workerScope.postMessage(response);
	} catch {
		const errorResponse: SemanticErrorMessage = {
			type: 'semantic-error',
			requestId: message.requestId,
			version: message.version,
			chunkName: message.chunkName,
		};
		workerScope.postMessage(errorResponse);
	}
};
