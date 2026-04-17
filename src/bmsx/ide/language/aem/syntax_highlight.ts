import type { HighlightLine } from '../../common/models';
import { highlightYamlTextLine } from '../yaml/yaml_syntax_highlight';

const AEM_VALUE_KEYWORDS = new Set([
	'loop',
	'sfx',
	'music',
	'ui',
	'replace',
	'ignore',
	'queue',
	'stop',
	'pause',
]);

export function highlightAemTextLine(line: string): HighlightLine {
	return highlightYamlTextLine(line, AEM_VALUE_KEYWORDS);
}
