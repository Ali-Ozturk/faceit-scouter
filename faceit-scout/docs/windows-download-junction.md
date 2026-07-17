# Windows Chrome Download Junction

Chrome extensions cannot download directly to arbitrary absolute paths. They can only choose a filename relative to Chrome's configured Downloads folder.

For FACEIT Scout, the recommended Windows setup is:

- Chrome extension downloads to `C:\Users\<user>\Downloads\FaceitScout\incoming`
- That path is a junction pointing to this repo's `data\incoming`
- Docker keeps using `/data/incoming`, so file claiming is a fast same-filesystem rename

This avoids the slow cross-mount copy from `/downloads/incoming` to `/data/processing`.

## 1. Stop the Processor

From the repo root:

```powershell
docker compose stop processor
```

## 2. Move Existing Downloaded Demos First

If this folder already contains demos, move them somewhere safe before replacing it with a junction:

```powershell
$downloadIncoming = "$env:USERPROFILE\Downloads\FaceitScout\incoming"
Get-ChildItem -LiteralPath $downloadIncoming -Force
```

If files are listed, either let the processor finish them first or move them manually.

## 3. Create the Junction

Run PowerShell as your normal user from anywhere:

```powershell
$repoIncoming = "C:\Users\AliOz\Documents\Projects\faceit-stack-analysis\faceit-scout\data\incoming"
$downloadIncoming = "$env:USERPROFILE\Downloads\FaceitScout\incoming"

New-Item -ItemType Directory -Force -Path (Split-Path $downloadIncoming) | Out-Null
New-Item -ItemType Directory -Force -Path $repoIncoming | Out-Null

if (Test-Path -LiteralPath $downloadIncoming) {
  $existing = Get-ChildItem -LiteralPath $downloadIncoming -Force
  if ($existing.Count -gt 0) {
    throw "Refusing to replace non-empty folder: $downloadIncoming"
  }
  Remove-Item -LiteralPath $downloadIncoming -Force
}

New-Item -ItemType Junction -Path $downloadIncoming -Target $repoIncoming
```

After this, Chrome can keep writing to:

```text
C:\Users\<user>\Downloads\FaceitScout\incoming
```

but the files physically land in:

```text
data\incoming
```

## 4. Use the Normal Docker Mount

With the junction setup, the processor should use `/data/incoming` again.

In `docker-compose.yml`, the processor should have:

```yaml
environment:
  INCOMING_DIRECTORY: /data/incoming
volumes:
  - ./data:/data
```

You do not need a separate `C:/Users/.../Downloads/...:/downloads/incoming` mount.

## 5. Recreate the Processor

```powershell
docker compose up -d --force-recreate processor
```

Check logs:

```powershell
docker compose logs -f processor
```

You should see:

```json
{"incoming_directory": "/data/incoming"}
```

## 6. Extension Setting

In the Chrome extension popup, keep:

```text
Download subdirectory: FaceitScout/incoming
```

Chrome will save to its Downloads folder, the junction redirects it to `data\incoming`, and the processor sees the file under `/data/incoming`.

## Undo

Stop the processor, remove the junction, and recreate a normal folder:

```powershell
docker compose stop processor

$downloadIncoming = "$env:USERPROFILE\Downloads\FaceitScout\incoming"
Remove-Item -LiteralPath $downloadIncoming -Force
New-Item -ItemType Directory -Force -Path $downloadIncoming
```
