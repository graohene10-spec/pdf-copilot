using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace PdfCopilot {
    // Closing the browser connection also closes the job, killing descendant processes.
    internal sealed class ProcessJob : IDisposable {
        private IntPtr handle;
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimit {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimit {
            public BasicLimit BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
        internal ProcessJob(Process process) {
            handle = CreateJobObject(IntPtr.Zero, null);
            if (handle == IntPtr.Zero) throw new InvalidOperationException("Could not isolate the Codex process.");
            var limits = new ExtendedLimit(); limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int size = Marshal.SizeOf(limits); IntPtr memory = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, memory, false);
                if (!SetInformationJobObject(handle, 9, memory, (uint)size) || !AssignProcessToJobObject(handle, process.Handle)) throw new InvalidOperationException("Could not isolate the Codex process.");
            } catch { Dispose(); throw; }
            finally { Marshal.FreeHGlobal(memory); }
        }
        public void Dispose() { IntPtr owned = Interlocked.Exchange(ref handle, IntPtr.Zero); if (owned != IntPtr.Zero) CloseHandle(owned); }
    }
}
