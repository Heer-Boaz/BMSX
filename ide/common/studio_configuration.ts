/** Deployment-owned configuration, consumed once at the browser composition root. */
export type StudioConfiguration = {
	workspace: { kind: 'browser' } | { kind: 'http'; baseUrl: string };
	/** Protocol base URLs. Absence means that the service is not installed. */
	assistant?: string;
	conversations?: string;
	/** One workspace observation channel; tools are an independent capability. */
	server?: { baseUrl: string; tools: boolean; builds: boolean; projects: boolean };
};
