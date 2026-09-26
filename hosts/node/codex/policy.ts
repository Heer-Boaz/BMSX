import { isDeepStrictEqual } from 'node:util';
import { CodexAdmissionError, type Json } from './protocol';

export const CODEX_VERSION = '0.156.1';

/** Node composition chooses the provider, never a browser RPC or model tool. */
export type CodexProvider = { model: string; name: string; baseUrl: string };
type ConfigRead = { config: Record<string, Json>; layers: { name: { type: string }; config: Record<string, Json> }[] };

export class CodexPolicy {
	private readonly config: Record<string, Json>;
	public readonly args: string[];

	public constructor(provider?: CodexProvider) {
		// Tool dispatch runs through the code-mode host in this Codex version: with the host off,
		// `dispatch_tool_call_with_state` refuses every Studio tool call. It is the supported
		// configuration, and the one the official editor integration launches with.
		// Studio grants Codex the full capability set of the CLI it embeds. Approvals stay off:
		// the session answers no approval request, so `never` lets Codex act on its own authority
		// instead of asking a channel that would refuse it and stall the turn.
		const features: Record<string, Json> = { skip_host_skill_discovery: true, code_mode_host: true };
		for (const feature of ['shell_tool', 'unified_exec', 'plugins', 'apps', 'browser_use', 'computer_use',
			'multi_agent', 'hooks', 'workspace_dependencies', 'image_generation', 'view_image', 'goals',
			'shell_snapshot', 'skill_mcp_dependency_install']) features[feature] = true;
		// `memories` runs a second Memory Writing Agent inference after every turn. That is billed
		// work the user did not ask for, and it breaks the guarantee that browsing or editing the
		// queue starts no inference. Capability features stay on; this one bills, so it stays off.
		features.memories = false;
		this.config = {
			approval_policy: 'never', sandbox_mode: 'danger-full-access', web_search: 'live',
			// Disable Codex's lossy text truncation for every JS-representable tool result.
			// These are exact JSON receipts, not shell logs. Provider context limits still apply.
			tool_output_token_limit: Number.MAX_SAFE_INTEGER,
			mcp_servers: {}, notify: [], features, project_doc_max_bytes: 0,
			// A self-update check reaches api.github.com on startup. That is not a capability the
			// session asked for, and it is the one remote call unrelated to running a turn.
			check_for_update_on_startup: false,
			cli_auth_credentials_store: 'file', mcp_oauth_credentials_store: 'file',
			orchestrator: { skills: { enabled: false }, mcp: { enabled: false } },
			tools: { experimental_request_user_input: { enabled: false }, update_plan: { enabled: false } },
			analytics: { enabled: false }, model_provider: 'openai',
		};
		if (provider) {
			this.config.model = provider.model;
			this.config.model_provider = 'studio';
			this.config.model_providers = { studio: { name: provider.name, base_url: provider.baseUrl,
				wire_api: 'responses', request_max_retries: 0, stream_max_retries: 0, supports_websockets: false } };
			features.enable_request_compression = false;
		}
		// TOML inline tables are emitted here, at the owner of the external config ABI.
		this.args = ['app-server', '--stdio'];
		for (const [key, value] of Object.entries(this.config)) this.args.push('-c', `${key}=${toml(value)}`);
	}

	public admit(read: ConfigRead): void {
		let sessionFlags = false;
		for (const layer of read.layers) {
			if (layer.name.type === 'sessionFlags') {
				if (sessionFlags || !isDeepStrictEqual(layer.config, this.config)) throw new CodexAdmissionError('Codex changed the Studio launch policy');
				sessionFlags = true;
			} else if (!isDeepStrictEqual(layer.config, {})) {
				throw new CodexAdmissionError(`Unowned Codex configuration layer: ${layer.name.type}`);
			}
		}
		if (!sessionFlags || !isDeepStrictEqual(read.config.mcp_servers, {}) || read.config.approval_policy !== 'never'
			|| read.config.sandbox_mode !== 'danger-full-access' || read.config.web_search !== 'live'
			|| read.config.tool_output_token_limit !== this.config.tool_output_token_limit) {
			throw new CodexAdmissionError('Codex did not admit the Studio capability policy');
		}
		const effectiveFeatures = read.config.features as Record<string, Json>;
		for (const [name, value] of Object.entries(this.config.features)) {
			if (effectiveFeatures[name] !== value) throw new CodexAdmissionError(`Codex changed feature admission: ${name}`);
		}
	}
}

function toml(value: Json): string {
	if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value).map(([key, value]) => `${JSON.stringify(key)}=${toml(value)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}
