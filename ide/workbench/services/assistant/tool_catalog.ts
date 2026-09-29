import { STUDIO_SOURCE_TOOLS } from './source_tool_protocol';
import { STUDIO_TEST_TOOLS } from './test_tool_protocol';
import { STUDIO_RUNTIME_TOOLS } from './runtime_tool_protocol';

/** One catalog for the embedded agent and external MCP clients. */
export const STUDIO_TOOLS = [...STUDIO_SOURCE_TOOLS, ...STUDIO_TEST_TOOLS, ...STUDIO_RUNTIME_TOOLS];
export const STUDIO_TOOL_NAMES = new Set(STUDIO_TOOLS.map(tool => tool.name));
export const STUDIO_RUNTIME_TOOL_NAMES = new Set(STUDIO_RUNTIME_TOOLS.map(tool => tool.name));
export const STUDIO_TEST_TOOL_NAMES = new Set(STUDIO_TEST_TOOLS.map(tool => tool.name));
