import { buildLuaFileSemanticData, type SymbolID } from '../../../toolchain/ts/lua/semantic/model';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { buildActionEffectBody } from '../../../ide/workbench/contrib/behavior_lens/action_effect';
import { installBehaviorLensDocument } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { collectBehaviorRegistrations } from '../../../ide/workbench/contrib/behavior_lens/registrations';
import { collectMutatedDeclarations, resolveSourceTable, type BehaviorRecognizerContext } from '../../../ide/workbench/contrib/behavior_lens/source';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { ACTIONEFFECT_SOURCE } from '../../helpers/actioneffect_source_fixture';
import { medianMilliseconds } from '../../helpers/performance';

for (const registrations of [24, 1024]) {
	const source = ACTIONEFFECT_SOURCE.slice(0, ACTIONEFFECT_SOURCE.indexOf('effects.register_effect'))
		+ Array.from({ length: registrations }, (_, index) => `effects.register_effect('profile.${index}', blueprint)`).join('\n');
	const resource = { domain: 0 as const, path: 'effect_profile.lua', source: { resid: 'effect_profile', type: 'lua' as const } };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const sourceProjectionMs = medianMilliseconds(() => { buildBehaviorSourceDocument(resource, semantic); });
	const document = buildBehaviorSourceDocument(resource, semantic);
	const model = new EditorTextModel(resource, 'lua', source);
	const view = createBehaviorLensViewState(document, model, 'outline');
	const inputRefreshMs = medianMilliseconds(() => { installBehaviorLensDocument(view, document, model.buffer); });
	const registrationSet = collectBehaviorRegistrations(resource, semantic);
	const registration = registrationSet.registrations[0];
	const context: BehaviorRecognizerContext = {
		analysis: semantic, constInitializers: registrationSet.constInitializers, mutatedDeclarations: collectMutatedDeclarations(semantic),
		anchor: registration.anchor, registrationRange: registration.callSite.expression.range, sourceIncomplete: false, behaviorKind: 'action_effect',
	};
	const active = new Set<SymbolID>();
	const table = resolveSourceTable(context, registration.callSite.expression.arguments[1], active)!;
	const singleBodyMs = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) buildActionEffectBody(context, table, active);
	}) / 1000;
	if (document.definitions.length !== registrations || view.sourceNodes.length !== registrations * 17) throw new Error('profile must retain every registration, field and requirement');
	console.log(JSON.stringify({ registrations, fields: registrations * 12, sourceNodes: view.sourceNodes.length,
		sourceProjectionMs, singleBodyMs, inputRefreshMs,
		boundary: 'cold source generation on cached semantic data, one body, and input refresh measured separately; excludes parsing, drawing, runtime and total Studio frame' }));
}
