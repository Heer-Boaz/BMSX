import { BUILD_TOOLS, callBuildTool } from '../builds/tools';
import type { StudioBuildJobs } from '../builds/jobs';
import { buildRequestId } from '../builds/api';
import type { WorkspaceProjects } from '../workspace/projects';
import { PROJECT_TOOLS, decodeCartridgeTarget } from '../workspace/projects_api';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { imageDataUrlContent } from '../../common/image';
import type { StudioToolDefinition, StudioToolResult } from '../../common/studio_tools';
import type { StudioSessions } from './sessions';

const INSTRUCTIONS = 'BMSX Studio tools operate on explicit browser or server-owned headless Studio sessions, independently of this conversation. '
	+ 'Successful results expose the domain value as structuredContent.result and matching JSON text. Images are separate image blocks. '
	+ 'Workspace builds and headless session management need no toolContext. Builds do not install media. Start a headless Studio explicitly from a completed build when a separate workspace is wanted; never choose another target because the session list is empty. '
	+ 'For live Studio tools, first call studio_list_sessions, then studio_open_context with the chosen session ID. Pass the returned toolContext to every domain tool. '
	+ 'Handles and source receipts belong to that context; never guess them. Close the context when finished. '
	+ 'Open a new context after source changes, workspace replacement or disconnection; do not replay mutations. '
	+ 'External context lifetime is explicit, not bound to CLI conversation turns. '
	+ 'Source access and proposal approval are explicit session capabilities, not inferred from its host kind. User-approved proposals remain in the ordinary Studio review pane. studio_resolve_review can apply only with sourceAccess=edit and reviewApproval=agent. studio_read_review observes that proposal, not a Save acknowledgement. '
	+ 'Keep its context open until review settles. Use a fresh context to check source/Save status afterwards. '
	+ 'Neither listing sessions nor opening a context starts Codex, signs in, pauses the game or executes Lua. '
	+ 'Multiple contexts may inspect the same Studio; physical execution admission remains with Studio.';

const MANAGEMENT_TOOLS: Tool[] = [
	{ name: 'studio_list_sessions', description: 'List connected browser and server-owned headless Studio sessions, including source access and proposal approval authority. Select the actual target explicitly; no first-window or active-chat routing.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: 'studio_open_context', description: 'Open a tool context on a listed Studio session. Captures source authority and owns inspection handles and finite operations, independently of any chat. No guest execution. Returns the context required by domain tools.',
		inputSchema: { type: 'object', properties: { session: { type: 'string' } }, required: ['session'], additionalProperties: false } },
	{ name: 'studio_close_context', description: 'Release a tool context, cancel its unfinished operations and invalidate pending reviews. Does not stop another context, undo completed work or roll back accepted Saves.',
		inputSchema: { type: 'object', properties: { toolContext: { type: 'string' } }, required: ['toolContext'], additionalProperties: false } },
	{ name: 'studio_read_review', description: 'Read the current state of a proposal created in this context. Approval follows the session\'s explicit reviewApproval capability; user approval remains in the ordinary Studio review pane. Applied means source edits were accepted, not proof of Save or installed code. Do not busy-poll.',
		inputSchema: { type: 'object', properties: { toolContext: { type: 'string' }, review: { type: 'string' } }, required: ['toolContext', 'review'], additionalProperties: false },
		annotations: { readOnlyHint: true, openWorldHint: false } },
	{ name: 'studio_resolve_review', description: 'Explicitly resolve a source proposal from this context. Apply requires sourceAccess=edit and reviewApproval=agent; user-owned review cannot be approved by a model. Any context can discard its own proposal. Applies through ordinary Studio source/Undo ownership, without Saving or installing code. Read fresh source receipts in a new tool context afterwards.',
		inputSchema: { type: 'object', properties: { toolContext: { type: 'string' }, review: { type: 'string' }, decision: { type: 'string', enum: ['apply', 'discard'] } },
			required: ['toolContext', 'review', 'decision'], additionalProperties: false } },
];

const HEADLESS_TOOLS: Tool[] = [
	{ name: 'studio_start_headless', description: 'Start a real server-owned headless Studio from an exact completed workspace build, with separate documents, Undo, runtime, debugger and history but no browser window or desktop input. Specify sourceAccess=review or edit explicitly. The caller-created requestId UUID identifies one start for this server lifetime; reuse the same ID and payload to reconcile a lost reply, never blindly create a second instance. A previously closed instance stays closed. Startup and accepted source Saves outlive an MCP request. Does not create a Codex conversation or auto-apply proposals. Select the returned session with studio_open_context and inspect actual runtime status.',
		inputSchema: { type: 'object', properties: { requestId: { type: 'string' }, buildRequestId: { type: 'string' }, sourceAccess: { type: 'string', enum: ['review', 'edit'] } },
			required: ['requestId', 'buildRequestId', 'sourceAccess'], additionalProperties: false } },
	{ name: 'studio_close_headless', description: 'Close an explicitly identified server-owned headless Studio, never a human browser window. Specify discardUnsaved=false to refuse while source documents are dirty and return their identities; true explicitly discards those unsaved drafts. Accepted Saves still drain before shutdown. Closing invalidates its contexts and unfinished operations; it never rolls back completed source writes.',
		inputSchema: { type: 'object', properties: { session: { type: 'string' }, discardUnsaved: { type: 'boolean' } },
			required: ['session', 'discardUnsaved'], additionalProperties: false } },
];

type Context = { session: string; lifetime: AbortController };
type Client = { server: Server; transport: StreamableHTTPServerTransport; contexts: Map<string, Context>; lifetime: AbortController };

/** Official MCP transport/protocol; domain schemas and admission remain owned by Studio. */
export class StudioMcpApi {
	private readonly clients = new Map<string, Client>();
	private readonly tools: Tool[];
	private readonly names: Set<string>;
	private closing = false;
	public constructor(private readonly sessions: StudioSessions, definitions: readonly StudioToolDefinition[],
		private readonly builds?: StudioBuildJobs, private readonly projects?: WorkspaceProjects) {
		this.names = new Set(definitions.map(tool => tool.name));
		this.tools = [...MANAGEMENT_TOOLS, ...(builds === undefined ? [] : [...HEADLESS_TOOLS, ...BUILD_TOOLS]), ...(projects === undefined ? [] : PROJECT_TOOLS), ...definitions.map(tool => ({ name: tool.name, description: tool.description,
			inputSchema: { ...tool.inputSchema, type: 'object' as const,
				properties: { toolContext: { type: 'string', description: 'Context returned by studio_open_context.' }, ...tool.inputSchema.properties },
				required: ['toolContext', ...tool.inputSchema.required] } }))];
	}

	/** Host, Origin and bearer capability are authorized by the existing server before this call. */
	public async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (this.closing) { response.writeHead(503).end('Studio MCP is shutting down'); return; }
		const id = request.headers['mcp-session-id'] as string | undefined;
		if (id !== undefined) {
			const client = this.clients.get(id);
			if (!client) { response.writeHead(404).end('MCP session has ended'); return; }
			await client.transport.handleRequest(request, response);
			return;
		}
		if (request.method !== 'POST') { response.writeHead(400).end('Initialize an MCP session first'); return; }
		// The low-level Server accepts our existing JSON Schemas and domain decoders:
		// no second Zod schema/catalog that can drift from the embedded agent tools.
		const server = new Server({ name: 'bmsx-studio', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID,
			onsessioninitialized: id => { this.clients.set(id, client); } });
		const client: Client = { server, transport, contexts: new Map(), lifetime: new AbortController() };
		server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: this.tools }));
		server.setRequestHandler(CallToolRequestSchema, (request, extra) => this.call(client, request.params.name,
			request.params.arguments ?? {}, AbortSignal.any([extra.signal, client.lifetime.signal])));
		server.onclose = () => {
			client.lifetime.abort(new Error('MCP client disconnected'));
			for (const [id, context] of client.contexts) this.release(client, id, context);
			if (transport.sessionId !== undefined) this.clients.delete(transport.sessionId);
		};
		await server.connect(transport);
		try { await transport.handleRequest(request, response); }
		finally { if (transport.sessionId === undefined) await server.close(); }
	}

	private async call(client: Client, name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
		try {
			signal.throwIfAborted();
			if (this.builds !== undefined && name === 'studio_start_headless') {
				if (input.sourceAccess !== 'review' && input.sourceAccess !== 'edit') throw new Error('sourceAccess must explicitly be review or edit');
				return toolResult({ success: true, data: await this.sessions.startHeadless({ requestId: buildRequestId(input.requestId),
					buildRequestId: buildRequestId(input.buildRequestId), sourceAccess: input.sourceAccess }) });
			}
			if (this.builds !== undefined && name === 'studio_close_headless') {
				if (typeof input.session !== 'string') throw new Error('session must identify a listed headless Studio');
				if (input.discardUnsaved !== true && input.discardUnsaved !== false) throw new Error('Specify discardUnsaved: true or false');
				return toolResult({ success: true, data: await this.sessions.closeHeadless(input.session, input.discardUnsaved) });
			}
			if (name === 'studio_create_cartridge' && this.projects !== undefined) {
				return toolResult({ success: true, data: await this.projects.createCartridge(decodeCartridgeTarget(input.target)) });
			}
			if (this.builds !== undefined && BUILD_TOOLS.some(tool => tool.name === name)) return toolResult({ success: true, data: await callBuildTool(this.builds, name, input) });
			if (name === 'studio_list_sessions') return toolResult({ success: true, data: { sessions: this.sessions.list() } });
			if (name === 'studio_open_context') {
				if (typeof input.session !== 'string') throw new Error('session must be a listed Studio session ID');
				const id = randomUUID(), context: Context = { session: input.session, lifetime: new AbortController() };
				client.contexts.set(id, context);
				try {
					const result = await this.sessions.invoke(context.session, { type: 'open', context: id }, signal);
					if (!result.success) this.release(client, id, context);
					return toolResult(result);
				} catch (error) { this.release(client, id, context); throw error; }
			}
			if (typeof input.toolContext !== 'string') throw new Error('toolContext must be returned by studio_open_context');
			const context = client.contexts.get(input.toolContext);
			if (!context) throw new Error('This context does not belong to this MCP session or has closed');
			if (name === 'studio_close_context') {
				this.release(client, input.toolContext, context);
				return toolResult({ success: true, data: { toolContext: input.toolContext, status: 'closed' } });
			}
			const operationSignal = AbortSignal.any([signal, context.lifetime.signal]);
			if (name === 'studio_read_review' || name === 'studio_resolve_review') {
				if (typeof input.review !== 'string') throw new Error('review must be returned by a proposal');
				if (name === 'studio_resolve_review') {
					if (input.decision !== 'apply' && input.decision !== 'discard') throw new Error('decision must be apply or discard');
					return toolResult(await this.sessions.invoke(context.session, { type: 'resolve-review', context: input.toolContext,
						review: input.review, decision: input.decision }, operationSignal));
				}
				return toolResult(await this.sessions.invoke(context.session, { type: 'review', context: input.toolContext, review: input.review }, operationSignal));
			}
			if (!this.names.has(name)) throw new Error(`Unknown Studio tool: ${name}`);
			const { toolContext: id, ...argumentsValue } = input;
			return toolResult(await this.sessions.invoke(context.session, { type: 'call', context: id as string, name, arguments: argumentsValue }, operationSignal));
		} catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
	}

	private release(client: Client, id: string, context: Context): void {
		client.contexts.delete(id);
		context.lifetime.abort(new Error('Studio tool context closed'));
		this.sessions.release(context.session, id);
	}

	public async close(): Promise<void> {
		this.closing = true;
		await Promise.all(Array.from(this.clients.values(), client => client.server.close()));
	}
}

/** MCP content blocks, not base64 pasted into tool prose. */
function toolResult(result: StudioToolResult): CallToolResult {
	if (result.success === false) return { isError: true, content: [{ type: 'text', text: result.error }] };
	// MCP structured content is an object; the result field also carries domain arrays.
	const structuredContent = { result: result.data };
	const content: CallToolResult['content'] = [{ type: 'text', text: JSON.stringify(structuredContent) }];
	if (result.images !== undefined) for (const image of result.images) content.push({ type: 'image', ...imageDataUrlContent(image) });
	return { content, structuredContent, isError: false };
}
