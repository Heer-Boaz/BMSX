// Main-RAM Thread header lanes also consumed by the raw capture datapath.
export const enum ThreadField {
	Header = 0, Status = 8, Resumer = 12, Entry = 16, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	ProtectedDepth = 60,
}
