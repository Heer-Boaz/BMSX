#pragma once

namespace bmsx {

class Runtime;

void syncRuntimeGameViewStateToTable(Runtime& runtime);
void applyRuntimeGameViewTableToState(Runtime& runtime);

} // namespace bmsx
