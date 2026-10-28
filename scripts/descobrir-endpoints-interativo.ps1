$ErrorActionPreference = "Stop"
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
try {
    $env:APF_USERNAME = Read-Host "Usuário do AgilePoint"
    $securePassword = Read-Host "Senha do AgilePoint" -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:APF_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:APF_NETWORK_LOG_DIR = Join-Path (Get-Location) "data\network-discovery"
    node scripts/descobrir-endpoints-interativo.mjs
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Remove-Item Env:APF_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:APF_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:APF_NETWORK_LOG_DIR -ErrorAction SilentlyContinue
}
