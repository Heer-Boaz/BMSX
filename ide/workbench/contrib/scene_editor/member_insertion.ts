import { formatLuaNumberExpression } from '../../../../toolchain/ts/lua/syntax/number_expression';
import { quoteLuaString } from '../../../../toolchain/ts/lua/syntax/string_literal';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { createLuaTableFieldsInsertionEdits } from '../../../language/lua/table_field_insertion';
import type { SceneSourceDefinition, SceneSourceDocument } from './model';

export type SceneAddMemberChoice = { readonly id: string };
export type SceneAddMemberPlan = {
	readonly choices: readonly SceneAddMemberChoice[];
	readonly occupied: ReadonlySet<string>;
};

/** Append one ordinary root member; the Lua table owner supplies punctuation and exterior trivia. */
export function createSceneMemberInsertionEdits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition,
	memberId: string, definitionId: string, x: number, y: number): readonly EditorTextEdit[] {
	const source = '{ member_id = ' + quoteLuaString(memberId) + ', definition_id = ' + quoteLuaString(definitionId)
		+ ', position = { x = ' + formatLuaNumberExpression(x) + ', y = ' + formatLuaNumberExpression(y) + ' } }';
	return createLuaTableFieldsInsertionEdits(buffer, document.analysis.chunk, scene.objectsTable, scene.objectsTable.fields.length, [source]);
}
