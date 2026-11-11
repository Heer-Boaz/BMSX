using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace Bmsx {
// The test launcher owns the Win32 ABI. The existing Node process-scope owner
// uses the same atomic JOB_LIST + explicit inherited-handle-list protocol.
public static class TestJob {
    const uint JobMemory = 0x200, KillOnClose = 0x2000;
    const uint Suspended = 4, ExtendedStartup = 0x80000;
    const uint WaitTimeout = 258, Infinite = 0xffffffff;
    const int ExtendedLimits = 9, CompletionPortInfo = 7, AccountingInfo = 1;

    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] struct PortAssociation { public IntPtr Key, Port; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public uint Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, Width, Height, CharWidth, CharHeight, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Basic; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref PortAssociation info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Limits info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr port, UIntPtr key, uint threads);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out UIntPtr key, out IntPtr data, uint milliseconds);

    static void Check(bool success, string operation) {
        if (!success) {
            int error = Marshal.GetLastWin32Error();
            throw new Win32Exception(error, operation + " failed (Win32 " + error + ")");
        }
    }
    // CRT argv quoting, matching process_scope/native/scope_windows.cpp. Never
    // interpret command text through cmd.exe or PowerShell.
    static void Argument(StringBuilder line, string value) {
        if (line.Length != 0) line.Append(' ');
        line.Append('"');
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { ++slashes; continue; }
            line.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            line.Append(ch); slashes = 0;
        }
        line.Append('\\', slashes * 2).Append('"');
    }
    static bool Message(IntPtr port, uint timeout, ref bool memoryHit) {
        uint message; UIntPtr key; IntPtr data;
        if (!GetQueuedCompletionStatus(port, out message, out key, out data, timeout)) {
            int error = Marshal.GetLastWin32Error();
            if (error == (int)WaitTimeout) return false;
            throw new Win32Exception(error, "GetQueuedCompletionStatus");
        }
        // Hard-limit notifications are not guaranteed by Windows. A received
        // one always fails the run, even when the workload catches ENOMEM.
        if (message == 9 || message == 10) memoryHit = true;
        return true;
    }

    public static int Run(string executable, string[] arguments, string cwd, ulong memoryLimit, int timeoutSeconds) {
        if (Environment.OSVersion.Platform != PlatformID.Win32NT || IntPtr.Size != 8
            || memoryLimit == 0 || memoryLimit > 8589934592UL || timeoutSeconds < 1 || timeoutSeconds > 86400)
            throw new ArgumentException("Require x64 Windows, 0 < job memory <= 8 GiB and timeout 1..86400 seconds");
        IntPtr job = IntPtr.Zero, port = IntPtr.Zero, attributes = IntPtr.Zero, values = IntPtr.Zero;
        IntPtr[] handles = new IntPtr[3];
        ProcessInfo process = new ProcessInfo();
        bool attributesReady = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero, "CreateJobObject");
            Limits limits = new Limits();
            limits.Basic.Flags = JobMemory | KillOnClose;
            limits.JobMemory = new UIntPtr(memoryLimit);
            Check(SetInformationJobObject(job, ExtendedLimits, ref limits, (uint)Marshal.SizeOf(typeof(Limits))), "SetInformationJobObject limits");
            Limits installed;
            Check(QueryInformationJobObject(job, ExtendedLimits, out installed, (uint)Marshal.SizeOf(typeof(Limits)), IntPtr.Zero), "QueryInformationJobObject limits");
            if (installed.Basic.Flags != limits.Basic.Flags || installed.JobMemory.ToUInt64() != memoryLimit)
                throw new InvalidOperationException("Kernel job memory/kill/no-breakaway limits do not match");
            port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, UIntPtr.Zero, 1);
            Check(port != IntPtr.Zero, "CreateIoCompletionPort");
            PortAssociation association = new PortAssociation { Key = job, Port = port };
            Check(SetInformationJobObject(job, CompletionPortInfo, ref association, (uint)Marshal.SizeOf(typeof(PortAssociation))), "SetInformationJobObject completion port");
            IntPtr self = GetCurrentProcess();
            for (int i = 0; i != 3; ++i)
                Check(DuplicateHandle(self, GetStdHandle(-10 - i), self, out handles[i], 0, true, 2), "DuplicateHandle stdio");
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "InitializeProcThreadAttributeList");
            attributesReady = true;
            values = Marshal.AllocHGlobal(IntPtr.Size * 4);
            for (int i = 0; i != 3; ++i) Marshal.WriteIntPtr(values, i * IntPtr.Size, handles[i]);
            Marshal.WriteIntPtr(values, 3 * IntPtr.Size, job);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), values, new IntPtr(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "stdio handle list");
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000d), IntPtr.Add(values, 3 * IntPtr.Size), new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "job assignment attribute");
            StartupEx startup = new StartupEx();
            startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx));
            startup.Basic.Flags = 0x100;
            startup.Basic.Input = handles[0]; startup.Basic.Output = handles[1]; startup.Basic.Error = handles[2];
            startup.Attributes = attributes;
            StringBuilder command = new StringBuilder();
            Argument(command, executable);
            foreach (string argument in arguments) Argument(command, argument);
            // Atomic JOB_LIST assignment also closes the controller-death gap
            // between CreateProcess and AssignProcessToJobObject.
            Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, Suspended | ExtendedStartup,
                IntPtr.Zero, cwd, ref startup, out process), "CreateProcess (suspended, atomically assigned job)");
            bool member;
            Check(IsProcessInJob(process.Process, job, out member), "IsProcessInJob");
            if (!member) throw new InvalidOperationException("Suspended child is not in the bounded job");
            Console.Error.WriteLine("[test-job] pid={0} job_memory_limit={1} timeout_seconds={2}", process.Pid, memoryLimit, timeoutSeconds);
            Check(ResumeThread(process.Thread) != Infinite, "ResumeThread");
            bool memoryHit = false, timedOut = false;
            Stopwatch timer = Stopwatch.StartNew();
            while (true) {
                Message(port, 0, ref memoryHit);
                uint wait = WaitForSingleObject(process.Process, 0);
                if (wait == 0) break;
                Check(wait == WaitTimeout, "WaitForSingleObject");
                timedOut = timer.Elapsed.TotalSeconds >= timeoutSeconds;
                if (memoryHit || timedOut) break;
                Message(port, 50, ref memoryHit);
            }
            uint code;
            Check(GetExitCodeProcess(process.Process, out code), "GetExitCodeProcess");
            Check(TerminateJobObject(job, memoryHit ? 137u : timedOut ? 124u : code), "TerminateJobObject cleanup");
            // Completion notifications alone do not prove all descendants left.
            timer.Restart();
            Accounting accounting;
            while (true) {
                Message(port, 0, ref memoryHit);
                Check(QueryInformationJobObject(job, AccountingInfo, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "QueryInformationJobObject active processes");
                if (accounting.ActiveProcesses == 0) break;
                if (timer.Elapsed.TotalSeconds >= 10)
                    throw new InvalidOperationException("Job termination did not complete within 10 seconds; descendant cleanup is unconfirmed");
                Message(port, 50, ref memoryHit);
            }
            while (Message(port, 0, ref memoryHit)) {
                if (timer.Elapsed.TotalSeconds >= 10)
                    throw new InvalidOperationException("Job notifications did not drain within the cleanup deadline");
            }
            // Final kernel accounting includes terminated children, not the
            // PowerShell launcher. Keep the API's integer 100 ns units.
            Console.Error.WriteLine("[test-job] cpu_user_100ns={0} cpu_kernel_100ns={1} total_processes={2}",
                accounting.UserTime, accounting.KernelTime, accounting.TotalProcesses);
            if (memoryHit) { Console.Error.WriteLine("[test-job] job memory limit notification: FAILED"); return 137; }
            if (timedOut) { Console.Error.WriteLine("[test-job] timeout: FAILED"); return 124; }
            return unchecked((int)code);
        } finally {
            // Non-inheritable job handle: killing this launcher also closes the
            // final owner and kills the entire ordinary child-process tree.
            if (job != IntPtr.Zero) CloseHandle(job);
            if (process.Thread != IntPtr.Zero) CloseHandle(process.Thread);
            if (process.Process != IntPtr.Zero) CloseHandle(process.Process);
            foreach (IntPtr handle in handles) if (handle != IntPtr.Zero) CloseHandle(handle);
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (values != IntPtr.Zero) Marshal.FreeHGlobal(values);
            if (port != IntPtr.Zero) CloseHandle(port);
        }
    }
}
}
