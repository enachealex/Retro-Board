# RetroBoard Auto-Deploy Script
# Polls GitHub for new commits, downloads, builds, and deploys
# Runs as a scheduled task on the host machine

$ErrorActionPreference = "Continue"

# --- Config ---
$GITHUB_TOKEN = $env:RETROBOARD_GITHUB_TOKEN
$REPO = "enachealex/Retro-Board"
$BRANCH = "main"
$SERVER_IP = "192.168.1.48"
$API_PORT = "5000"
$DEPLOY_DIR = "C:\RetroBoard"
$BACKEND_DIR = "C:\RetroBoard\backend"
$WORK_DIR = "C:\RetroBoard\_deploy"
$STATE_FILE = "C:\RetroBoard\_deploy\last_sha.txt"
$LOG_FILE = "C:\RetroBoard\_deploy\deploy.log"

# Cache-clearing snippet (wipes old localStorage on first visit)
$CACHE_CLEAR_SCRIPT = @"
<script>
(function(){
  var v = 'retro-v2-mysql';
  if(localStorage.getItem('_retro_version') !== v){
    localStorage.clear();
    localStorage.setItem('_retro_version', v);
    location.reload();
  }
})();
</script>
"@

# Socket.io injection snippet with real-time board refresh
$SOCKET_SCRIPT = @"
<script src="http://${SERVER_IP}:${API_PORT}/socket.io/socket.io.js"></script>
<script>
(function(){
  var sock = io('http://${SERVER_IP}:${API_PORT}', {transports:['websocket','polling']});
  var refreshing = false;
  function refreshBoard() {
    if (refreshing) return;
    refreshing = true;
    setTimeout(function(){
      var items = document.querySelectorAll('.board-list > li:not(.creating-board-item)');
      var active = document.querySelector('.board-list > li.active');
      if (!active || items.length < 1) { refreshing = false; return; }
      if (items.length >= 2) {
        var other = null;
        for (var i = 0; i < items.length; i++) {
          if (items[i] !== active) { other = items[i]; break; }
        }
        if (other) {
          other.click();
          setTimeout(function(){ active.click(); refreshing = false; }, 150);
        } else { refreshing = false; }
      } else {
        active.classList.remove('active');
        active.click();
        refreshing = false;
      }
    }, 300);
  }
  var events = ['board:created','board:updated','board:deleted','column:created','column:updated','column:deleted','card:created','card:updated','card:deleted'];
  events.forEach(function(ev){ sock.on(ev, function(){ refreshBoard(); }); });
  sock.on('connect', function(){ console.log('RetroBoard realtime connected'); });
})();
</script>
"@

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $LOG_FILE -Value $line
    Write-Host $line
}

function Get-LatestSha {
    $headers = @{Accept = "application/vnd.github+json"}
    if ($GITHUB_TOKEN) { $headers.Authorization = "token $GITHUB_TOKEN" }
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/commits/$BRANCH" -Headers $headers
    return $r.sha
}

function Get-LastDeployedSha {
    if (Test-Path $STATE_FILE) { return (Get-Content $STATE_FILE -Raw).Trim() }
    return ""
}

function Save-DeployedSha($sha) {
    Set-Content -Path $STATE_FILE -Value $sha -NoNewline
}

function Download-Repo($sha) {
    $headers = @{}
    if ($GITHUB_TOKEN) { $headers.Authorization = "token $GITHUB_TOKEN" }
    $zipPath = "$WORK_DIR\repo.zip"
    $extractDir = "$WORK_DIR\extract"

    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

    Write-Log "Downloading repo ZIP for $($sha.Substring(0,8))..."
    Invoke-WebRequest -Uri "https://api.github.com/repos/$REPO/zipball/$BRANCH" -Headers $headers -OutFile $zipPath -UseBasicParsing

    Write-Log "Extracting..."
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
    Remove-Item $zipPath -Force

    # GitHub zips have a top-level folder like "owner-repo-sha/"
    $inner = Get-ChildItem $extractDir -Directory | Select-Object -First 1
    return $inner.FullName
}

function Build-Frontend($repoRoot) {
    $feDir = Join-Path $repoRoot "frontend"
    Write-Log "Installing frontend dependencies..."
    Push-Location $feDir
    & "C:\Progra~1\nodejs\node.exe" "C:\Progra~1\nodejs\node_modules\npm\bin\npm-cli.js" install 2>&1 | Out-Null
    Write-Log "Building frontend..."
    $buildOutput = & "C:\Progra~1\nodejs\node.exe" "C:\Progra~1\nodejs\node_modules\npm\bin\npx-cli.js" vite build 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Vite build output: $($buildOutput -join "`n")"
    }
    Pop-Location

    $distDir = Join-Path $feDir "dist"
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
        Write-Log "ERROR: Build failed - no dist/index.html found"
        return $null
    }
    Write-Log "Frontend build succeeded"
    return $distDir
}

function Patch-Frontend($distDir) {
    Write-Log "Patching frontend for deployment..."

    # Patch JS bundles - replace localhost:5000 with server IP
    Get-ChildItem "$distDir\assets\*.js" | ForEach-Object {
        $content = [System.IO.File]::ReadAllText($_.FullName)
        if ($content -match "localhost:5000") {
            $content = $content.Replace("http://localhost:5000/api", "http://${SERVER_IP}:${API_PORT}/api")
            [System.IO.File]::WriteAllText($_.FullName, $content)
            Write-Log "  Patched API URL in $($_.Name)"
        }
    }

    # Inject cache-clearing script into <head>
    $indexPath = Join-Path $distDir "index.html"
    $html = [System.IO.File]::ReadAllText($indexPath)
    if ($html -notmatch "_retro_version") {
        $html = $html.Replace('<meta charset="UTF-8" />', "<meta charset=`"UTF-8`" />`n    $CACHE_CLEAR_SCRIPT")
        Write-Log "  Injected cache-clearing script"
    }

    # Inject Socket.io into index.html
    if ($html -notmatch "socket\.io") {
        $html = $html.Replace("</body>", "$SOCKET_SCRIPT`n  </body>")
        Write-Log "  Injected Socket.io client into index.html"
    }
    [System.IO.File]::WriteAllText($indexPath, $html)
}

function Deploy-Frontend($distDir) {
    Write-Log "Deploying frontend to $DEPLOY_DIR..."

    # Keep backend dir and deploy metadata
    $preserve = @("backend", "_deploy", "web.config")

    # Remove old frontend files
    Get-ChildItem $DEPLOY_DIR | Where-Object {
        $preserve -notcontains $_.Name
    } | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force
    }

    # Copy new frontend
    Get-ChildItem $distDir | Copy-Item -Destination $DEPLOY_DIR -Recurse -Force
    Write-Log "Frontend deployed"
}

function Deploy-Backend($repoRoot) {
    $srcBackend = Join-Path $repoRoot "backend"
    $srcServer = Join-Path $srcBackend "server.js"

    if (-not (Test-Path $srcServer)) {
        Write-Log "No backend/server.js in repo, keeping existing backend"
        return $false
    }

    # Check if backend changed (compare server.js)
    $existingServer = Join-Path $BACKEND_DIR "server.js"
    if (Test-Path $existingServer) {
        $oldHash = (Get-FileHash $existingServer).Hash
        $newHash = (Get-FileHash $srcServer).Hash
        if ($oldHash -eq $newHash) {
            Write-Log "Backend unchanged, skipping"
            return $false
        }
    }

    Write-Log "Backend changed, updating..."

    # Install backend deps
    Push-Location $srcBackend
    & "C:\Progra~1\nodejs\node.exe" "C:\Progra~1\nodejs\node_modules\npm\bin\npm-cli.js" install 2>&1 | Out-Null
    Pop-Location

    # Stop current backend
    taskkill /im node.exe /f 2>$null

    # Preserve the database
    $dbPath = Join-Path $BACKEND_DIR "retro.db"
    $dbBackup = "$WORK_DIR\retro.db.bak"
    if (Test-Path $dbPath) { Copy-Item $dbPath $dbBackup -Force }

    # Copy new backend (preserve node_modules if deps unchanged)
    # Copy all backend files and subdirectories (auth/, config/, db/, etc.)
    Get-ChildItem $srcBackend -Exclude 'node_modules','.env','uploads' | ForEach-Object {
        if ($_.PSIsContainer) {
            Copy-Item $_.FullName (Join-Path $BACKEND_DIR $_.Name) -Recurse -Force
        } else {
            Copy-Item $_.FullName (Join-Path $BACKEND_DIR $_.Name) -Force
        }
    }

    # Reinstall deps in target
    Push-Location $BACKEND_DIR
    & "C:\Progra~1\nodejs\node.exe" "C:\Progra~1\nodejs\node_modules\npm\bin\npm-cli.js" install 2>&1 | Out-Null
    Pop-Location

    # Restore DB
    if (Test-Path $dbBackup) { Copy-Item $dbBackup $dbPath -Force }

    # Restart backend
    Start-Process -FilePath "C:\Progra~1\nodejs\node.exe" -ArgumentList "$BACKEND_DIR\server.js" -WorkingDirectory $BACKEND_DIR -WindowStyle Hidden
    Write-Log "Backend restarted"
    return $true
}

# --- Main ---
New-Item -ItemType Directory -Path $WORK_DIR -Force | Out-Null

Write-Log "=== Deploy check started ==="

try {
    $latestSha = Get-LatestSha
    $lastSha = Get-LastDeployedSha

    Write-Log "Latest: $($latestSha.Substring(0,8)), Deployed: $(if($lastSha){$lastSha.Substring(0,8)}else{'none'})"

    if ($latestSha -eq $lastSha) {
        Write-Log "No changes, nothing to deploy"
        exit 0
    }

    $repoRoot = Download-Repo $latestSha
    $distDir = Build-Frontend $repoRoot
    if (-not $distDir) {
        Write-Log "Build failed, aborting deploy"
        exit 1
    }

    Patch-Frontend $distDir
    Deploy-Frontend $distDir
    Deploy-Backend $repoRoot
    Save-DeployedSha $latestSha

    # Cleanup
    $extractDir = "$WORK_DIR\extract"
    if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }

    Write-Log "=== Deploy complete: $($latestSha.Substring(0,8)) ==="
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    Write-Log $_.ScriptStackTrace
    exit 1
}
