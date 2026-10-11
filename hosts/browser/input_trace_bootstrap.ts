import { BrowserInputTrace } from './input_trace';

// This separate entrypoint is present only in trace-equipped player packages.
window.bmsxInputTrace = new BrowserInputTrace(window);
