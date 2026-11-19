param([switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class FormaDirectoryDialog {
    [ComImport, Guid("D57C7288-D4AD-4768-BE02-9D969532D960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr filters);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }
    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint nameType, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem item, uint hint, out int order);
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

    public static string Select(string initialDirectory, bool validateOnly) {
        object instance = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")));
        IShellItem initial = null, selected = null;
        try {
            IFileOpenDialog dialog = (IFileOpenDialog)instance;
            // Native Explorer folder picker: folders only, filesystem paths, existing locations.
            dialog.SetOptions(0x02000868);
            dialog.SetTitle("选择项目存放位置");
            dialog.SetOkButtonLabel("选择此文件夹");
            if (!String.IsNullOrEmpty(initialDirectory) && Directory.Exists(initialDirectory)) {
                Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
                if (SHCreateItemFromParsingName(initialDirectory, IntPtr.Zero, ref iid, out initial) == 0) dialog.SetFolder(initial);
            }
            if (validateOnly) return "validated";
            int result = dialog.Show(GetForegroundWindow());
            if (result == unchecked((int)0x800704C7)) return null;
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out selected);
            IntPtr path;
            selected.GetDisplayName(0x80058000, out path);
            try { return Marshal.PtrToStringUni(path); }
            finally { Marshal.FreeCoTaskMem(path); }
        } finally {
            if (selected != null) Marshal.ReleaseComObject(selected);
            if (initial != null) Marshal.ReleaseComObject(initial);
            Marshal.ReleaseComObject(instance);
        }
    }
}
'@
$directory = [FormaDirectoryDialog]::Select($env:FORMA_PICKER_INITIAL_DIRECTORY, $ValidateOnly.IsPresent)
@{ directory = $directory } | ConvertTo-Json -Compress
