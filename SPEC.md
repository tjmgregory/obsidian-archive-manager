# Archive Manager Plugin Specification

An Obsidian plugin to manage archiving and unarchiving of files and folders with automatic metadata tracking.

## Overview

This plugin provides frictionless archiving that:
- Moves items to a configurable archive folder with a single command
- Automatically records original location and metadata
- Supports unarchiving back to original location
- Works with both files and folders
- Requires no manual renaming or reorganisation
- Works with any folder structure or workflow

## Commands

### Archive

**Command:** `Archive item`
**Trigger:** Command palette, right-click context menu, hotkey

**Behaviour:**
1. Move selected file or folder to the archive folder
2. Add archive metadata (see Metadata section)
3. Show confirmation toast with undo option (5 seconds)

### Unarchive

**Command:** `Unarchive item`
**Trigger:** Command palette, right-click context menu, hotkey
**Availability:** Only shown for items in the archive folder

**Behaviour:**
1. Read original path from metadata
2. If original path exists, prompt for conflict resolution (see Edge Cases)
3. Move item back to original location
4. Remove archive metadata (or mark as `archived: false`)
5. Show confirmation toast

### Browse Archive

**Command:** `Browse archive`
**Trigger:** Command palette

**Behaviour:**
Opens a modal view showing archived items with:
- Grouping options: by date archived, by original folder, flat list
- Search/filter capability
- Quick unarchive action per item
- Original path shown for each item

## Metadata

### For Single Files

When archiving a single `.md` file, add to frontmatter:

```yaml
archived: 2026-01-05
archived_from: Projects/Some Project/file.md
```

### For Folders: Use Index File

When archiving a folder, create or update an `_archive.md` file at the folder root:

```yaml
---
archived: 2026-01-05
archived_from: Projects/Some Project
is_archive_index: true
---

# Some Project

This project was archived on 2026-01-05.

## Contents at archive time
- file1.md
- file2.md
- subfolder/
```

**Do NOT update metadata in every file within the folder.**

#### Rationale: Index File vs Per-File Metadata

| Approach | Pros | Cons |
|----------|------|------|
| **Index file (recommended)** | Single source of truth; less file churn; projects archived as units; cleaner | Extra file; won't work if single file extracted |
| **Per-file metadata** | Self-contained files; works for individual extraction | Noisy; must update every file; slow for large folders; inconsistent if interrupted |

**Decision: Index file**

Projects and folders are archived and unarchived as units. You don't unarchive a single file from within an archived project - you unarchive the whole thing. Therefore, metadata belongs at the folder level, not repeated in every file.

The `_archive.md` file:
- Uses underscore prefix to sort first in file list
- Contains the archive metadata in frontmatter
- Optionally lists contents at archive time (for reference)
- Is removed or cleared when unarchived

## File Operations

### Archive Flow

```
User triggers "Archive" on: Projects/My Project/

1. Validate: Is item already in archive? → Abort with message
2. Move: Projects/My Project/ → Archive/My Project/
3. Metadata:
   - If folder: Create Archive/My Project/_archive.md
   - If file: Update frontmatter of the file
4. Toast: "Archived 'My Project'" [Undo]
```

### Unarchive Flow

```
User triggers "Unarchive" on: Archive/My Project/

1. Read metadata:
   - If folder: Read from _archive.md
   - If file: Read from frontmatter
2. Get original_path: "Projects/My Project"
3. Check conflicts:
   - Does Projects/My Project/ exist? → Prompt user
4. Move: Archive/My Project/ → Projects/My Project/
5. Clean metadata:
   - If folder: Delete _archive.md
   - If file: Remove archived/archived_from from frontmatter
6. Toast: "Unarchived 'My Project' to Projects/"
```

## Edge Cases

### Original Path No Longer Exists

If parent folders were deleted (e.g., `Projects/Client Work/` no longer exists):

1. Show modal: "Original location no longer exists: `Projects/Client Work/My Project`"
2. Options:
   - "Create path and restore" (recreate parent folders)
   - "Choose new location" (folder picker)
   - "Cancel"

### Conflict at Original Path

If something now exists at the original path:

1. Show modal: "A file/folder already exists at `Projects/My Project`"
2. Options:
   - "Replace existing" (move existing to trash first)
   - "Choose new location" (folder picker)
   - "Keep both" (append number: `My Project 2`)
   - "Cancel"

### Item Already Archived

If user tries to archive something already in the archive folder:

- Show toast: "Item is already archived"
- No action taken

### Non-Markdown Files

For non-markdown files (images, PDFs, etc.):
- Cannot store frontmatter
- Create a sidecar `filename.ext._archive.md` with the metadata
- On unarchive, delete the sidecar

### Nested Archives

If archiving a folder that contains items with their own `_archive.md` (previously archived and moved):
- Preserve existing metadata
- Only create new `_archive.md` at the top level being archived

## Settings

```typescript
interface ArchiveManagerSettings {
  archivePath: string;            // Default: "Archive"
  confirmBeforeArchive: boolean;  // Default: false
  confirmBeforeUnarchive: boolean; // Default: true
  undoTimeoutSeconds: number;     // Default: 5
  showInContextMenu: boolean;     // Default: true
  indexFileName: string;          // Default: "_archive.md"
  recordContentsInIndex: boolean; // Default: true
}
```

## UI Components

### Context Menu Items

When right-clicking a file/folder:
- In active folders: "Archive"
- In archive folder: "Unarchive"

### Ribbon Icon (Optional)

Archive icon that opens the Browse Archive modal.

### Status Bar (Optional)

Show archive stats: "Archive: 47 items"

## Technical Notes

### File Operations

Use Obsidian's `vault.rename()` for moves to ensure:
- Links are updated (if Obsidian setting enabled)
- File watchers are notified
- Undo history is maintained

### Frontmatter Manipulation

Use a YAML parser (e.g., `gray-matter` or Obsidian's `processFrontMatter`) to:
- Preserve existing frontmatter
- Add/remove archive fields cleanly
- Handle edge cases (no frontmatter, malformed YAML)

### Performance

For large folders:
- Show progress indicator
- Process files in batches
- Don't update every file's metadata (use index file approach)

## Future Enhancements

- **Auto-archive:** Prompt to archive items marked as "completed" in frontmatter
- **Archive expiry:** Flag items archived > 1 year for review
- **Bulk operations:** Archive/unarchive multiple items at once
- **Archive search:** Dedicated search scoped to archive only
- **Statistics view:** Charts showing archive growth over time
