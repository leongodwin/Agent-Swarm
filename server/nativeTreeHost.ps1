$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
public static class CubeNativeTree {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {public int cb;public string reserved,desktop,title;public int x,y,xs,ys,xc,yc,fill,flags;public short show,reserved2;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct SIEX {public SI basic;public IntPtr attributes;}
 [StructLayout(LayoutKind.Sequential)] struct PI {public IntPtr process,thread;public uint pid,tid;}
 [StructLayout(LayoutKind.Sequential)] struct LIMIT {public long processTime,jobTime;public uint flags;public UIntPtr min,max;public uint count;public UIntPtr affinity;public uint priority,scheduling;}
 [StructLayout(LayoutKind.Sequential)] struct IO {public ulong a,b,c,d,e,f;}
 [StructLayout(LayoutKind.Sequential)] struct EXT {public LIMIT basic;public IO io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
 [StructLayout(LayoutKind.Sequential)] struct ACCOUNT {public long a,b,c,d;public uint faults,total,active,terminated;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr sa,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref EXT info,uint size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out ACCOUNT info,uint size,IntPtr length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SIEX si,out PI pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr length);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 static void Check(bool value){if(!value)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
 public static int Run(string exe,string cmd,string cwd,string proof,string body) {
  IntPtr job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)throw new Exception("CreateJobObject failed");
  PI pi=new PI();bool assigned=false;IntPtr attributes=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero;
  try{
   EXT limit=new EXT();limit.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(typeof(EXT))));
   SIEX si=new SIEX();si.basic.cb=Marshal.SizeOf(typeof(SIEX));si.basic.flags=0x100;si.basic.input=IntPtr.Zero;si.basic.output=GetStdHandle(-11);si.basic.error=GetStdHandle(-12);
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);attributes=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attributes,2,0,ref size));si.attributes=attributes;
   jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
   handles=Marshal.AllocHGlobal(2*IntPtr.Size);Marshal.WriteIntPtr(handles,0,si.basic.output);Marshal.WriteIntPtr(handles,IntPtr.Size,si.basic.error);Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(2*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
   Check(SetHandleInformation(GetStdHandle(-10),1,0));
   Check(CreateProcess(exe,new StringBuilder(cmd),IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,cwd,ref si,out pi));
   assigned=true; // Job membership was assigned atomically by CreateProcess.
   // Begin monitoring parent control-pipe EOF before allowing any native code.
   Task<string> closed=Task.Run(()=>Console.ReadLine());
   if(!closed.IsCompleted){if(ResumeThread(pi.thread)==0xffffffff)throw new Exception("ResumeThread failed");}
   DateTime deadline=DateTime.UtcNow.AddMinutes(20);
   uint wait;do{wait=WaitForSingleObject(pi.process,20);if(wait==0xffffffff)throw new Exception("Process wait failed");}while(wait==258&&!closed.IsCompleted&&DateTime.UtcNow<deadline);
   uint exit=1;Check(GetExitCodeProcess(pi.process,out exit));
   bool cancelled=closed.IsCompleted||DateTime.UtcNow>=deadline;
   Check(TerminateJobObject(job,cancelled?1u:exit));
   ACCOUNT account;DateTime stop=DateTime.UtcNow.AddSeconds(30);
   do{Check(QueryInformationJobObject(job,1,out account,(uint)Marshal.SizeOf(typeof(ACCOUNT)),IntPtr.Zero));if(account.active==0)break;Thread.Sleep(10);}while(DateTime.UtcNow<stop);
   if(account.active!=0)throw new Exception("Job remains active");
   string pending=proof+".pending";
   using(FileStream file=new FileStream(pending,FileMode.CreateNew,FileAccess.Write,FileShare.None)){byte[] bytes=new UTF8Encoding(false).GetBytes(body);file.Write(bytes,0,bytes.Length);file.Flush(true);}
   File.Move(pending,proof);
   return cancelled?1:(int)exit;
  }finally{if(attributes!=IntPtr.Zero){DeleteProcThreadAttributeList(attributes);Marshal.FreeHGlobal(attributes);}if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(pi.process!=IntPtr.Zero&&!assigned)TerminateProcess(pi.process,1);CloseHandle(job);if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);}
 }
}
"@
try {
 $payload=[Console]::ReadLine() | ConvertFrom-Json
 $proof=[ordered]@{schemaVersion=1;id=$payload.id;intentSha256=$payload.intentSha256;mechanism='windows-job-object-v1';scope='inherited-process-tree';activeProcesses=0;breakawayAllowed=$false;nativeTreeQuiescenceVerified=$true}
 $code=[CubeNativeTree]::Run($payload.exe,$payload.commandLine,$payload.cwd,$payload.proof,($proof | ConvertTo-Json -Compress))
 exit $code
} catch { [Console]::Error.WriteLine('Native tree supervision failed: '+$_.Exception.Message); exit 1 }
