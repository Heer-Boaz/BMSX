#pragma once

namespace bmsx {

class GameView;
class Memory;
class TextureManager;

void flushHostRuntimeAssetEdits(Memory& memory, TextureManager& texmanager, const GameView& view);

} // namespace bmsx
