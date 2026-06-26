# audio-helper.ps1
param (
    [string]$Action,
    [string]$DeviceId,
    [string]$Type # "Playback" or "Recording"
)

$code = @'
using System;
using System.Runtime.InteropServices;

namespace AudioCmd {
    [Guid("f8679f50-850a-41cf-9c74-d830ee957c74"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig {
        int GetMixFormat(string deviceName, out IntPtr format);
        int GetDeviceFormat(string deviceName, int isDefault, out IntPtr format);
        int ResetDeviceFormat(string deviceName);
        int SetDeviceFormat(string deviceName, IntPtr endpointFormat, IntPtr mixFormat);
        int GetProcessingPeriod(string deviceName, int isDefault, out long period, out long minimumPeriod);
        int SetProcessingPeriod(string deviceName, long period);
        int GetShareMode(string deviceName, out int mode);
        int SetShareMode(string deviceName, int mode);
        int GetPropertyValue(string deviceName, ref PropertyKey key, out PropVariant value);
        int SetPropertyValue(string deviceName, ref PropertyKey key, ref PropVariant value);
        int SetDefaultEndpoint(string deviceId, int role);
        int SetEndpointVisibility(string deviceId, int isVisible);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr unionContents;
    }

    [ComImport, Guid("294935c4-98b5-4a84-90f7-ea499356c694")]
    class PolicyConfigClient {}

    public class AudioHelper {
        public static bool SetDefault(string deviceId, int role) {
            try {
                IPolicyConfig config = (IPolicyConfig)new PolicyConfigClient();
                config.SetDefaultEndpoint(deviceId, role);
                return true;
            } catch (Exception ex) {
                Console.Error.WriteLine(ex.Message);
                return false;
            }
        }
    }
}
'@

if ($Action -eq "list") {
    $devices = @()
    
    # Render (Playback) devices
    $renderPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render'
    if (Test-Path $renderPath) {
        Get-ChildItem $renderPath | ForEach-Object {
            $id = $_.PSChildName
            $propertiesPath = Join-Path $_.PSPath 'Properties'
            if (Test-Path $propertiesPath) {
                $name = (Get-ItemProperty -Path $propertiesPath -Name '{a45c254e-df1c-4efd-8020-67d146a850e0},2' -ErrorAction SilentlyContinue).'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
                $state = (Get-ItemProperty -Path $_.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
                # State: 1 = Active, 2 = Disabled, 8 = Not Present, 16 = Unplugged
                if ($name -and ($state -eq 1)) {
                    $devices += [PSCustomObject]@{
                        Id = "{0.0.0.00000000}.$id"
                        Name = $name
                        Type = "Playback"
                    }
                }
            }
        }
    }

    # Capture (Recording) devices
    $capturePath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture'
    if (Test-Path $capturePath) {
        Get-ChildItem $capturePath | ForEach-Object {
            $id = $_.PSChildName
            $propertiesPath = Join-Path $_.PSPath 'Properties'
            if (Test-Path $propertiesPath) {
                $name = (Get-ItemProperty -Path $propertiesPath -Name '{a45c254e-df1c-4efd-8020-67d146a850e0},2' -ErrorAction SilentlyContinue).'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
                $state = (Get-ItemProperty -Path $_.PSPath -Name 'DeviceState' -ErrorAction SilentlyContinue).DeviceState
                if ($name -and ($state -eq 1)) {
                    $devices += [PSCustomObject]@{
                        Id = "{0.0.1.00000000}.$id"
                        Name = $name
                        Type = "Recording"
                    }
                }
            }
        }
    }

    Write-Output ($devices | ConvertTo-Json -Compress)
}
elseif ($Action -eq "set") {
    if (-not $DeviceId) {
        Write-Error "DeviceId is required for 'set' action"
        exit 1
    }
    
    # Add Type compilation
    Add-Type -TypeDefinition $code
    
    # Roles: 0 = Console (default), 1 = Multimedia, 2 = Communications
    $res0 = [AudioCmd.AudioHelper]::SetDefault($DeviceId, 0)
    $res1 = [AudioCmd.AudioHelper]::SetDefault($DeviceId, 1)
    $res2 = [AudioCmd.AudioHelper]::SetDefault($DeviceId, 2)
    
    if ($res0 -and $res1 -and $res2) {
        Write-Output "Success"
    } else {
        Write-Error "Failed to set default device"
        exit 1
    }
}
