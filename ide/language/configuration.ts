import { aemDocumentFormat } from '../../toolchain/ts/rompack/aem';

export type EditorDocumentMode = 'lua' | 'aem' | 'yaml';

export type TextLanguageConfiguration = {
	readonly indentationUnit: string;
	readonly lineComment: string | undefined;
};

const LUA: TextLanguageConfiguration = { indentationUnit: '\t', lineComment: '--' };
const YAML: TextLanguageConfiguration = { indentationUnit: '  ', lineComment: '#' };
const JSON: TextLanguageConfiguration = { indentationUnit: '  ', lineComment: undefined };

/** Editing syntax belongs to the authored language, not the resource's runtime use. */
export function textLanguageConfiguration(mode: EditorDocumentMode, path: string): TextLanguageConfiguration {
	switch (mode) {
		case 'lua': return LUA;
		case 'yaml': return YAML;
		case 'aem': return aemDocumentFormat(path) === 'yaml' ? YAML : JSON;
	}
}
