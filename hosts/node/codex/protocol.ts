/** The small subset of the pinned external protocol that the Studio process owner consumes. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type RpcId = string | number;
export type RpcMessage = {
	id?: RpcId;
	method?: string;
	params?: Json;
	result?: Json;
	error?: { code: number; message: string; data?: Json };
};

export class CodexProtocolError extends Error {}
export class CodexAdmissionError extends Error {}

/** External JSON boundary only; BMSX model/tool results do not pass through this. */
export function parseRpcMessage(line: string): RpcMessage {
	const message = JSON.parse(line) as RpcMessage;
	if (!message || Array.isArray(message) || typeof message !== 'object') {
		throw new CodexProtocolError('Codex emitted a non-object protocol message');
	}
	if (message.id !== undefined && typeof message.id !== 'string' && !Number.isInteger(message.id)) {
		throw new CodexProtocolError('Codex emitted an invalid request identity');
	}
	if (message.method !== undefined) {
		if (typeof message.method !== 'string' || message.result !== undefined || message.error !== undefined) {
			throw new CodexProtocolError('Codex emitted an invalid request/notification');
		}
	} else if (message.id === undefined || (('result' in message) === ('error' in message))) {
		throw new CodexProtocolError('Codex emitted an invalid response');
	}
	if ('error' in message && (!message.error || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string')) {
		throw new CodexProtocolError('Codex emitted an invalid error response');
	}
	return message;
}

export type CodexTool = { name: string; description: string; inputSchema: Json };
export type CodexToolCall = { threadId: string; turnId: string; callId: string; namespace: string | null; tool: string; arguments: Json };
export type CodexToolResult = { success: boolean; text: string };
export type CodexTurn = { id: string; status: 'inProgress' | 'completed' | 'interrupted' | 'failed'; error: { message: string } | null };
export type CodexAccount = { account: { type: string; email?: string; planType?: string } | null; requiresOpenaiAuth: boolean };
export type CodexSessionEvent =
	| { type: 'turn-started'; turnId: string }
	| { type: 'turn-completed'; turn: CodexTurn }
	| { type: 'text-delta'; turnId: string; itemId: string; text: string }
	| { type: 'message'; turnId: string; itemId: string; text: string }
	| { type: 'account-changed' }
	| { type: 'closed'; error?: Error };
