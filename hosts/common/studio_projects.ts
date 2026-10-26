/** A saved cartridge project, independent of a running machine or build job. */
export type StudioCartridgeProject = { target: string; projectRoot: string; entryPath: string; readonly sourceContextId: string };

/** Workspace-admitted source namespace. File locations and build generations are not its identity. */
export type StudioSourceContext = { readonly id: string; readonly projectRoot: string };

/** The selected cartridge context and its explicitly bound BIOS context. */
export type StudioProjectAdmission = {
	readonly target: string;
	readonly system: StudioSourceContext;
	readonly cartridge: StudioSourceContext;
};
