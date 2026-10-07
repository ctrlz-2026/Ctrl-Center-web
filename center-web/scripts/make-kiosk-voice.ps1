# Kiosk voice clips.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-kiosk-voice.ps1
#
# Reads lib/kiosk-voice-lines.json (the single place the sentences live) and
# writes one WAV per line to public/kiosk-voice/<key>.wav, using the Korean
# voice that ships with Windows (Microsoft Heami). Re-run after editing a line.
#
# Why files instead of the browser's speechSynthesis: the kiosk screen runs on
# the Jetson (Linux Chromium), which usually has no Korean voice installed.
# A clip sounds the same on every device.
#
# This file is ASCII on purpose - Windows PowerShell 5.1 misreads UTF-8 scripts
# that have no BOM. The Korean text is only ever read from the JSON file.

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$root = Split-Path -Parent $PSScriptRoot
$lines = Get-Content -Raw -Encoding UTF8 (Join-Path $root "lib/kiosk-voice-lines.json") | ConvertFrom-Json
$outDir = Join-Path $root "public/kiosk-voice"
New-Item -ItemType Directory -Force $outDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq "ko-KR" } | Select-Object -First 1
if (-not $voice) { throw "No Korean voice is installed on this PC." }
$synth.SelectVoice($voice.VoiceInfo.Name)
$synth.Rate = 1
$synth.Volume = 100

# 22.05 kHz, 16-bit, mono: clear on a small speaker, about 40 KB per second.
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($p in $lines.PSObject.Properties) {
  $file = Join-Path $outDir ($p.Name + ".wav")
  $synth.SetOutputToWaveFile($file, $format)
  $synth.Speak([string]$p.Value)
  $synth.SetOutputToNull()
  "{0,-14} {1,7:N0} bytes" -f $p.Name, (Get-Item $file).Length
}
$synth.Dispose()
"voice: " + $voice.VoiceInfo.Name
