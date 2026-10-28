$ErrorActionPreference = "Stop"
$securePassword = $null
$passwordPointer = [IntPtr]::Zero
try {
    $env:APF_USERNAME = Read-Host "Usuário do AgilePoint"
    $securePassword = Read-Host "Senha do AgilePoint" -AsSecureString
    $env:APF_TARGET_APPLICATION = Read-Host "Aplicação/projeto (nome exato)"
    $env:APF_TARGET_SPRINT = Read-Host "Versão/sprint"
    $env:APF_TARGET_USER = Read-Host "Usuário a associar (nome/identificador exato)"
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:APF_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    node scripts/executar-associacao-interativa.mjs
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Remove-Item Env:APF_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:APF_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:APF_TARGET_APPLICATION -ErrorAction SilentlyContinue
    Remove-Item Env:APF_TARGET_SPRINT -ErrorAction SilentlyContinue
    Remove-Item Env:APF_TARGET_USER -ErrorAction SilentlyContinue
}
