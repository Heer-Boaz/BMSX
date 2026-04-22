import { ruleNames } from '../../rule';
import { ensurePatternRule } from '../shared/ensure_pattern';
import { syntaxErrorPatternRule } from './syntax_error_pattern';
import { uppercaseCodePatternRule } from './uppercase_code_pattern';
import { comparisonWrapperGetterPatternRule } from './comparison_wrapper_getter_pattern';
import { visualUpdatePatternRule } from './visual_update_pattern';
import { bool01DuplicatePatternRule } from './bool01_duplicate_pattern';
import { pureCopyFunctionPatternRule } from './pure_copy_function_pattern';
import { uselessAssertPatternRule } from './useless_assert_pattern';
import { crossFileLocalGlobalConstantPatternRule } from './cross_file_local_global_constant_pattern';
import { shadowedRequireAliasPatternRule } from './shadowed_require_alias_pattern';
import { unusedInitValuePatternRule } from './unused_init_value_pattern';
import { getterSetterPatternRule } from './getter_setter_pattern';
import { builtinRecreationPatternRule } from './builtin_recreation_pattern';
import { forbiddenMathFloorPatternRule } from './forbidden_math_floor_pattern';
import { forbiddenRandomHelperPatternRule } from './forbidden_random_helper_pattern';
import { localFunctionConstPatternRule } from './local_function_const_pattern';
import { multiHasTagPatternRule } from './multi_has_tag_pattern';
import { singleUseHasTagPatternRule } from './single_use_has_tag_pattern';
import { selfPropertyLocalAliasPatternRule } from './self_property_local_alias_pattern';
import { imgidAssignmentPatternRule } from './imgid_assignment_pattern';
import { selfImgidAssignmentPatternRule } from './self_imgid_assignment_pattern';
import { imgidFallbackPatternRule } from './imgid_fallback_pattern';
import { forbiddenTransitionToPatternRule } from './forbidden_transition_to_pattern';
import { forbiddenMatchesStatePathPatternRule } from './forbidden_matches_state_path_pattern';
import { forbiddenDispatchPatternRule } from './forbidden_dispatch_pattern';
import { eventHandlerDispatchPatternRule } from './event_handler_dispatch_pattern';
import { eventHandlerStateDispatchPatternRule } from './event_handler_state_dispatch_pattern';
import { eventHandlerFlagProxyPatternRule } from './event_handler_flag_proxy_pattern';
import { contiguousMultiEmitPatternRule } from './contiguous_multi_emit_pattern';
import { dispatchFanoutLoopPatternRule } from './dispatch_fanout_loop_pattern';
import { tickFlagPollingPatternRule } from './tick_flag_polling_pattern';
import { tickInputCheckPatternRule } from './tick_input_check_pattern';
import { actionTriggeredBoolChainPatternRule } from './action_triggered_bool_chain_pattern';
import { setSpaceRoundtripPatternRule } from './set_space_roundtrip_pattern';
import { crossObjectStateEventRelayPatternRule } from './cross_object_state_event_relay_pattern';
import { foreignObjectInternalMutationPatternRule } from './foreign_object_internal_mutation_pattern';
import { runtimeTagTableAccessPatternRule } from './runtime_tag_table_access_pattern';
import { fsmStateNameMirrorAssignmentPatternRule } from './fsm_state_name_mirror_assignment_pattern';
import { constantCopyPatternRule } from './constant_copy_pattern';
import { splitLocalTableInitPatternRule } from './split_local_table_init_pattern';
import { duplicateInitializerPatternRule } from './duplicate_initializer_pattern';
import { handlerIdentityDispatchPatternRule } from './handler_identity_dispatch_pattern';
import { ensureLocalAliasPatternRule } from './ensure_local_alias_pattern';
import { serviceDefinitionSuffixPatternRule } from './service_definition_suffix_pattern';
import { defineFactoryTickEnabledPatternRule } from './define_factory_tick_enabled_pattern';
import { defineFactorySpaceIdPatternRule } from './define_factory_space_id_pattern';
import { createServiceIdAddonPatternRule } from './create_service_id_addon_pattern';
import { defineServiceIdPatternRule } from './define_service_id_pattern';
import { fsmEnteringStateVisualSetupPatternRule } from './fsm_entering_state_visual_setup_pattern';
import { fsmDirectStateHandlerShorthandPatternRule } from './fsm_direct_state_handler_shorthand_pattern';
import { fsmEventReemitHandlerPatternRule } from './fsm_event_reemit_handler_pattern';
import { fsmForbiddenLegacyFieldsPatternRule } from './fsm_forbidden_legacy_fields_pattern';
import { fsmProcessInputPollingTransitionPatternRule } from './fsm_process_input_polling_transition_pattern';
import { fsmRunChecksInputTransitionPatternRule } from './fsm_run_checks_input_transition_pattern';
import { fsmLifecycleWrapperPatternRule } from './fsm_lifecycle_wrapper_pattern';
import { fsmTickCounterTransitionPatternRule } from './fsm_tick_counter_transition_pattern';
import { fsmIdLabelPatternRule } from './fsm_id_label_pattern';
import { btIdLabelPatternRule } from './bt_id_label_pattern';
import { injectedServiceIdPropertyPatternRule } from './injected_service_id_property_pattern';
import { inlineStaticLookupTablePatternRule } from './inline_static_lookup_table_pattern';
import { stagedExportLocalCallPatternRule } from './staged_export_local_call_pattern';
import { stagedExportLocalTablePatternRule } from './staged_export_local_table_pattern';
import { requireLuaExtensionPatternRule } from './require_lua_extension_pattern';
import { branchUninitializedLocalPatternRule } from './branch_uninitialized_local_pattern';
import { forbiddenRenderWrapperCallPatternRule } from './forbidden_render_wrapper_call_pattern';
import { forbiddenRenderModuleRequirePatternRule } from './forbidden_render_module_require_pattern';
import { forbiddenRenderLayerStringPatternRule } from './forbidden_render_layer_string_pattern';

export { ensurePatternRule };
export { syntaxErrorPatternRule };
export { uppercaseCodePatternRule };
export { comparisonWrapperGetterPatternRule };
export { visualUpdatePatternRule };
export { bool01DuplicatePatternRule };
export { pureCopyFunctionPatternRule };
export { uselessAssertPatternRule };
export { crossFileLocalGlobalConstantPatternRule };
export { shadowedRequireAliasPatternRule };
export { unusedInitValuePatternRule };
export { getterSetterPatternRule };
export { builtinRecreationPatternRule };
export { forbiddenMathFloorPatternRule };
export { forbiddenRandomHelperPatternRule };
export { localFunctionConstPatternRule };
export { multiHasTagPatternRule };
export { singleUseHasTagPatternRule };
export { selfPropertyLocalAliasPatternRule };
export { imgidAssignmentPatternRule };
export { selfImgidAssignmentPatternRule };
export { imgidFallbackPatternRule };
export { forbiddenTransitionToPatternRule };
export { forbiddenMatchesStatePathPatternRule };
export { forbiddenDispatchPatternRule };
export { eventHandlerDispatchPatternRule };
export { eventHandlerStateDispatchPatternRule };
export { eventHandlerFlagProxyPatternRule };
export { contiguousMultiEmitPatternRule };
export { dispatchFanoutLoopPatternRule };
export { tickFlagPollingPatternRule };
export { tickInputCheckPatternRule };
export { actionTriggeredBoolChainPatternRule };
export { setSpaceRoundtripPatternRule };
export { crossObjectStateEventRelayPatternRule };
export { foreignObjectInternalMutationPatternRule };
export { runtimeTagTableAccessPatternRule };
export { fsmStateNameMirrorAssignmentPatternRule };
export { constantCopyPatternRule };
export { splitLocalTableInitPatternRule };
export { duplicateInitializerPatternRule };
export { handlerIdentityDispatchPatternRule };
export { ensureLocalAliasPatternRule };
export { serviceDefinitionSuffixPatternRule };
export { defineFactoryTickEnabledPatternRule };
export { defineFactorySpaceIdPatternRule };
export { createServiceIdAddonPatternRule };
export { defineServiceIdPatternRule };
export { fsmEnteringStateVisualSetupPatternRule };
export { fsmDirectStateHandlerShorthandPatternRule };
export { fsmEventReemitHandlerPatternRule };
export { fsmForbiddenLegacyFieldsPatternRule };
export { fsmProcessInputPollingTransitionPatternRule };
export { fsmRunChecksInputTransitionPatternRule };
export { fsmLifecycleWrapperPatternRule };
export { fsmTickCounterTransitionPatternRule };
export { fsmIdLabelPatternRule };
export { btIdLabelPatternRule };
export { injectedServiceIdPropertyPatternRule };
export { inlineStaticLookupTablePatternRule };
export { stagedExportLocalCallPatternRule };
export { stagedExportLocalTablePatternRule };
export { requireLuaExtensionPatternRule };
export { branchUninitializedLocalPatternRule };
export { forbiddenRenderWrapperCallPatternRule };
export { forbiddenRenderModuleRequirePatternRule };
export { forbiddenRenderLayerStringPatternRule };

export const LUA_CART_ONLY_LINT_RULES_DEFINITIONS = [
	ensurePatternRule,
	syntaxErrorPatternRule,
	uppercaseCodePatternRule,
	comparisonWrapperGetterPatternRule,
	visualUpdatePatternRule,
	bool01DuplicatePatternRule,
	pureCopyFunctionPatternRule,
	uselessAssertPatternRule,
	crossFileLocalGlobalConstantPatternRule,
	shadowedRequireAliasPatternRule,
	unusedInitValuePatternRule,
	getterSetterPatternRule,
	builtinRecreationPatternRule,
	forbiddenMathFloorPatternRule,
	forbiddenRandomHelperPatternRule,
	localFunctionConstPatternRule,
	multiHasTagPatternRule,
	singleUseHasTagPatternRule,
	selfPropertyLocalAliasPatternRule,
	imgidAssignmentPatternRule,
	selfImgidAssignmentPatternRule,
	imgidFallbackPatternRule,
	forbiddenTransitionToPatternRule,
	forbiddenMatchesStatePathPatternRule,
	forbiddenDispatchPatternRule,
	eventHandlerDispatchPatternRule,
	eventHandlerStateDispatchPatternRule,
	eventHandlerFlagProxyPatternRule,
	contiguousMultiEmitPatternRule,
	dispatchFanoutLoopPatternRule,
	tickFlagPollingPatternRule,
	tickInputCheckPatternRule,
	actionTriggeredBoolChainPatternRule,
	setSpaceRoundtripPatternRule,
	crossObjectStateEventRelayPatternRule,
	foreignObjectInternalMutationPatternRule,
	runtimeTagTableAccessPatternRule,
	fsmStateNameMirrorAssignmentPatternRule,
	constantCopyPatternRule,
	splitLocalTableInitPatternRule,
	duplicateInitializerPatternRule,
	handlerIdentityDispatchPatternRule,
	ensureLocalAliasPatternRule,
	serviceDefinitionSuffixPatternRule,
	defineFactoryTickEnabledPatternRule,
	defineFactorySpaceIdPatternRule,
	createServiceIdAddonPatternRule,
	defineServiceIdPatternRule,
	fsmEnteringStateVisualSetupPatternRule,
	fsmDirectStateHandlerShorthandPatternRule,
	fsmEventReemitHandlerPatternRule,
	fsmForbiddenLegacyFieldsPatternRule,
	fsmProcessInputPollingTransitionPatternRule,
	fsmRunChecksInputTransitionPatternRule,
	fsmLifecycleWrapperPatternRule,
	fsmTickCounterTransitionPatternRule,
	fsmIdLabelPatternRule,
	btIdLabelPatternRule,
	injectedServiceIdPropertyPatternRule,
	inlineStaticLookupTablePatternRule,
	stagedExportLocalCallPatternRule,
	stagedExportLocalTablePatternRule,
	requireLuaExtensionPatternRule,
	branchUninitializedLocalPatternRule,
	forbiddenRenderWrapperCallPatternRule,
	forbiddenRenderModuleRequirePatternRule,
	forbiddenRenderLayerStringPatternRule,
] as const;
export const LUA_CART_ONLY_LINT_RULES = ruleNames(LUA_CART_ONLY_LINT_RULES_DEFINITIONS);
