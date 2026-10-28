param([Parameter(Mandatory=$true)][string]$Workbook)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $Workbook).Path
if ([IO.Path]::GetExtension($resolved) -ne '.xlsx') { throw 'Expected a disposable .xlsx fixture.' }
$excel = $null
$book = $null
$functions = $null
$summary = $null
$metadata = $null
function Assert-Equal($actual, $expected, $label) {
  if ($actual -ne $expected) { throw "$label expected $expected, actual $actual" }
}
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $book = $excel.Workbooks.Open($resolved, 0, $false)
  $functions = $book.Worksheets.Item('Funções')
  $summary = $book.Worksheets.Item('Sumário')
  $metadata = $book.Worksheets.Item('Contagem')
  $excel.CalculateFullRebuild()
  Assert-Equal $summary.Range('B6').Value2 24 'Initial PF base'
  Assert-Equal $summary.Range('B7').Value2 11.1 'Initial PF equivalent'
  $functions.Range('H13').Value2 = 'SE'
  $functions.Range('J13').Value2 = 6
  $functions.Range('K13').Value2 = 4
  $excel.CalculateFullRebuild()
  Assert-Equal $functions.Range('L13').Value2 'SEH' 'Updated complexity code'
  Assert-Equal $functions.Range('N13').Value2 'Alta' 'Updated complexity'
  Assert-Equal $functions.Range('O13').Value2 7 'Updated PF base'
  Assert-Equal $functions.Range('P13').Value2 7 'Updated PF equivalent'
  Assert-Equal $summary.Range('B6').Value2 28 'Updated total PF base'
  Assert-Equal $summary.Range('B7').Value2 15.1 'Updated total PF equivalent'
  $metadata.Range('C10').Value2 = 0.5
  $excel.CalculateFullRebuild()
  Assert-Equal $functions.Range('P13').Value2 3.5 'Updated explicit multiplier'
  Assert-Equal $summary.Range('B7').Value2 11.6 'Updated factor total'
  $metadata.Range('B11').Value2 = 'Pendente'
  $excel.CalculateFullRebuild()
  Assert-Equal $functions.Range('P15').Value2 '' 'Missing factor stays blank'
  Assert-Equal $summary.Range('B7').Value2 'Pendente' 'Missing factor total exposed'
  $book.Save()
  Write-Output 'Native Excel: opened without repair, full recalculation, changed type/TD/AR, changed factor, pending factor and saved caches passed.'
} finally {
  if ($null -ne $book) { $book.Close($false) }
  foreach ($object in @($metadata, $summary, $functions, $book)) {
    if ($null -ne $object) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) }
  }
  if ($null -ne $excel) {
    $excel.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
