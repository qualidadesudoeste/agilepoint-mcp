$ErrorActionPreference = "Stop"
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
try {
    $env:APF_USERNAME = Read-Host "Usuário do AgilePoint"
    $securePassword = Read-Host "Senha do AgilePoint" -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:APF_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    node scripts/testar-universal-interativo.mjs
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Remove-Item Env:APF_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:APF_USERNAME -ErrorAction SilentlyContinue
}
