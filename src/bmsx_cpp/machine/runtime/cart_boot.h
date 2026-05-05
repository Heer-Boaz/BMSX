#pragma once

namespace bmsx {

class ConsoleCore;
class Runtime;

class CartBootState {
public:
        CartBootState(Runtime& runtime, ConsoleCore& console);
        void reset();
        bool processProgramReloadRequest();
        bool processPending();

private:
        bool pollSystemBootRequest();
        void request();

        Runtime& m_runtime;
        ConsoleCore& m_console;

        bool m_pending = false;
};

} // namespace bmsx
