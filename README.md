# Archive Manager

An Obsidian plugin to archive and unarchive files and folders with automatic metadata tracking.

## Features

- **One-command archiving**: Move files or folders to your archive with a single command
- **Automatic metadata**: Tracks original location and archive date, so you can always restore items to where they came from
- **Smart unarchiving**: Restore items to their original location with conflict handling
- **Browse archive**: Fuzzy search through archived items to quickly find and restore what you need
- **Undo support**: Accidentally archived something? Undo within a configurable time window
- **Context menu integration**: Right-click any file or folder to archive/unarchive

## Usage

### Archive an Item

1. Open a file or select a folder in the file explorer
2. Use one of these methods:
   - **Command palette**: `Archive item`
   - **Right-click**: Select "Archive" from the context menu
   - **Hotkey**: Assign your own in Settings → Hotkeys

The item will be moved to your archive folder with metadata recording its original location.

### Unarchive an Item

1. Navigate to an archived item, or use the "Browse archive" command
2. Use one of these methods:
   - **Command palette**: `Unarchive item`
   - **Right-click**: Select "Unarchive" from the context menu
   - **Browse archive**: Search and select an item to restore

The item will be moved back to its original location. If the original location no longer exists, you'll be prompted to recreate it.

### Browse Archive

Use the command `Browse archive` to open a fuzzy search modal showing all archived items. Select any item to unarchive it instantly.

## How Metadata Works

### For Markdown Files

Archive metadata is stored in the file's frontmatter:

```yaml
---
archived: 2025-01-05T14:30:00.000Z
archived_from: 02 Projects/My Project/notes.md
---
```

### For Folders

An index file (default: `_archive.md`) is created at the folder root:

```yaml
---
archived: 2025-01-05T14:30:00.000Z
archived_from: 02 Projects/My Project
is_archive_index: true
---

# My Project

This folder was archived on 2025-01-05.

## Contents at archive time
- file1.md
- file2.md
- subfolder/
```

### For Non-Markdown Files

A sidecar file is created alongside the archived file (e.g., `image.png._archive.md`).

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Archive folder | Where archived items are stored | `05 Archive` |
| Confirm before archive | Show confirmation dialog | Off |
| Confirm before unarchive | Show confirmation dialog | On |
| Undo timeout | Seconds to allow undo after archiving | 5 |
| Show in context menu | Add Archive/Unarchive to right-click menu | On |
| Index file name | Name of metadata file for folders | `_archive.md` |
| Record contents in index | List folder contents when archiving | On |

### Changing the Index File Name

Click the button in settings to change the index file name. The plugin will:
1. Check for any naming conflicts
2. Rename all existing index files to the new name
3. Use the new name for future archives

## Edge Cases

### Conflict at Destination

If a file already exists at the archive or restore location, you can:
- **Replace existing**: Move the existing item to trash
- **Keep both**: Append a number to the name (e.g., "My Project 2")
- **Cancel**: Abort the operation

### Original Path Missing

If the original folder structure was deleted, you can:
- **Create path and restore**: Recreate the folder structure
- **Cancel**: Keep the item in the archive

## Installation

### From Obsidian Community Plugins

1. Open Settings → Community plugins
2. Click "Browse" and search for "Archive Manager"
3. Click "Install", then "Enable"

### Manual Installation

1. Download `main.js` and `manifest.json` from the latest release
2. Create a folder `archive-manager` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into this folder
4. Enable the plugin in Settings → Community plugins

## Support

- [Report issues](https://github.com/tjmgregory/obsidian-plugins/issues)
- [Source code](https://github.com/tjmgregory/obsidian-plugins)

## License

MIT
