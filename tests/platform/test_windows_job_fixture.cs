using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class TestJobFixture {
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr VirtualAlloc(IntPtr address, UIntPtr bytes, uint allocation, uint protection);
    [DllImport("kernel32.dll")] static extern bool VirtualFree(IntPtr address, UIntPtr bytes, uint kind);
    static Process Child() {
        return Process.Start(new ProcessStartInfo {
            FileName = Process.GetCurrentProcess().MainModule.FileName,
            Arguments = "sleep", UseShellExecute = false, CreateNoWindow = true
        });
    }
    public static int Main(string[] args) {
        switch (args[0]) {
            case "exit": return int.Parse(args[1]);
            case "sleep": Thread.Sleep(30000); return 0;
            case "tree":
            case "timeout":
                using (Process child = Child()) {
                    File.WriteAllText(args[1], child.Id.ToString());
                    if (args[0] == "timeout") Thread.Sleep(30000);
                }
                return 0;
            case "deny":
                // Commit is bounded by the test job; no pages are touched and
                // this probe never requests an 8 GiB allocation.
                IntPtr allocation = VirtualAlloc(IntPtr.Zero, new UIntPtr(128UL * 1024 * 1024), 0x3000, 4);
                if (allocation != IntPtr.Zero) { VirtualFree(allocation, UIntPtr.Zero, 0x8000); return 99; }
                Console.Error.WriteLine("known-allocation-denial:" + Marshal.GetLastWin32Error());
                return 0; // The runner, not this fixture, must notice the limit.
            default: return 98;
        }
    }
}
