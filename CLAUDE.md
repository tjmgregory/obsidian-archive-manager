# Archive Manager - Obsidian Plugin

An Obsidian plugin for archiving and unarchiving files/folders with automatic metadata tracking.

## Development

```bash
bun install        # Install dependencies
bun run dev        # Build with watch mode
bun run build      # Production build
bun run typecheck  # Type checking
bun run lint       # Lint with Biome
bun run lint:fix   # Auto-fix lint issues
```

## Testing in Obsidian

Symlink the built plugin to your vault:

```bash
ln -s ~/projects/obsidian-archive-manager ~/Documents/Obsidian/main/.obsidian/plugins/archive-manager
```

Then enable the plugin in Obsidian settings.

## Project Structure

```
├── src/
│   └── main.ts       # Plugin entry point (all code in single file)
├── manifest.json     # Obsidian plugin manifest
├── main.js           # Built output (gitignored)
├── SPEC.md           # Feature specification
└── README.md         # User documentation
```

## Key Concepts

- **Archive metadata**: Stored in frontmatter for .md files, sidecar files for others
- **Folder indexing**: Creates `_archive.md` in archived folders
- **Conflict handling**: Modals for path conflicts during archive/unarchive

## Release Process

1. Update version: `bun version patch/minor/major`
2. Build: `bun run build`
3. Commit and tag: `git commit && git tag 1.x.x`
4. Push with tags: `git push --follow-tags`
5. Create GitHub release with `main.js` and `manifest.json`

## Obsidian API Notes

- Runs in browser context (no Node.js APIs)
- Use `vault.rename()` for file moves
- Use `fileManager.processFrontMatter()` for YAML manipulation
- `moment` is provided by Obsidian globally
