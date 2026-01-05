/**
 * Archive Manager Plugin for Obsidian
 * Archive and unarchive files/folders with automatic metadata tracking
 */

import {
  type App,
  FuzzySuggestModal,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type TAbstractFile,
  TFile,
  TFolder,
} from 'obsidian';

declare const moment: typeof import('moment');

interface ArchiveManagerSettings {
  archivePath: string;
  confirmBeforeArchive: boolean;
  confirmBeforeUnarchive: boolean;
  undoTimeoutSeconds: number;
  showInContextMenu: boolean;
  indexFileName: string;
  recordContentsInIndex: boolean;
}

const DEFAULT_SETTINGS: ArchiveManagerSettings = {
  archivePath: '05 Archive',
  confirmBeforeArchive: false,
  confirmBeforeUnarchive: true,
  undoTimeoutSeconds: 5,
  showInContextMenu: true,
  indexFileName: '_archive.md',
  recordContentsInIndex: true,
};

interface ArchiveMetadata {
  archived: string;
  archivedFrom: string;
}

interface UndoAction {
  type: 'archive' | 'unarchive';
  originalPath: string;
  newPath: string;
  file: TAbstractFile;
  timeoutId: ReturnType<typeof setTimeout>;
}

export default class ArchiveManagerPlugin extends Plugin {
  settings: ArchiveManagerSettings = DEFAULT_SETTINGS;
  private pendingUndo: UndoAction | null = null;

  async onload() {
    await this.loadSettings();

    // Add settings tab
    this.addSettingTab(new ArchiveManagerSettingTab(this.app, this));

    // Archive command
    this.addCommand({
      id: 'archive-item',
      name: 'Archive item',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && !this.isInArchive(file)) {
          if (!checking) {
            void this.archiveItem(file);
          }
          return true;
        }
        return false;
      },
    });

    // Unarchive command
    this.addCommand({
      id: 'unarchive-item',
      name: 'Unarchive item',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.isInArchive(file)) {
          if (!checking) {
            void this.unarchiveItem(file);
          }
          return true;
        }
        return false;
      },
    });

    // Browse archive command
    this.addCommand({
      id: 'browse-archive',
      name: 'Browse archive',
      callback: () => {
        new BrowseArchiveModal(this.app, this).open();
      },
    });

    // Context menu items
    if (this.settings.showInContextMenu) {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu, file) => {
          if (this.isInArchive(file)) {
            menu.addItem((item) => {
              item
                .setTitle('Unarchive')
                .setIcon('archive-restore')
                .onClick(() => this.unarchiveItem(file));
            });
          } else {
            menu.addItem((item) => {
              item
                .setTitle('Archive')
                .setIcon('archive')
                .onClick(() => this.archiveItem(file));
            });
          }
        })
      );
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  isInArchive(file: TAbstractFile): boolean {
    const archivePath = this.settings.archivePath;
    return file.path === archivePath || file.path.startsWith(`${archivePath}/`);
  }

  private getArchivePath(): string {
    return this.settings.archivePath;
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private formatDisplayDate(isoString: string): string {
    return moment(isoString).format('YYYY-MM-DD');
  }

  async archiveItem(file: TAbstractFile) {
    if (this.isInArchive(file)) {
      new Notice('Item is already archived');
      return;
    }

    const originalPath = file.path;
    const fileName = file.name;
    const archivePath = this.getArchivePath();
    let newPath = `${archivePath}/${fileName}`;

    // Ensure archive folder exists
    await this.ensureFolderExists(archivePath);

    // Check for conflicts
    const existingFile = this.app.vault.getAbstractFileByPath(newPath);
    if (existingFile) {
      const result = await this.showConflictModal(newPath, 'archive');
      if (!result) return;
      newPath = result;
    }

    try {
      // Move the file/folder
      await this.app.vault.rename(file, newPath);

      // Get the moved file reference
      const movedFile = this.app.vault.getAbstractFileByPath(newPath);
      if (!movedFile) {
        throw new Error('Failed to find moved file');
      }

      // Add metadata
      await this.addArchiveMetadata(movedFile, originalPath);

      // Show undo notice
      this.showUndoNotice('archive', originalPath, newPath, movedFile, fileName);
    } catch (error) {
      new Notice(`Failed to archive: ${error instanceof Error ? error.message : String(error)}`);
      console.error('Archive error:', error);
    }
  }

  async unarchiveItem(file: TAbstractFile) {
    if (!this.isInArchive(file)) {
      new Notice('Item is not in archive');
      return;
    }

    try {
      // Read original path from metadata
      const metadata = this.readArchiveMetadata(file);
      if (!metadata) {
        new Notice('No archive metadata found. Cannot determine original location.');
        return;
      }

      const originalPath = metadata.archivedFrom;
      const parentPath = originalPath.substring(0, originalPath.lastIndexOf('/'));

      // Check if parent folder exists
      if (parentPath && !this.app.vault.getAbstractFileByPath(parentPath)) {
        const result = await this.showPathMissingModal(originalPath);
        if (!result) return;
        if (result === 'create') {
          await this.ensureFolderExists(parentPath);
        } else {
          // User chose new location
          // For simplicity, we'll just create the original path
          await this.ensureFolderExists(parentPath);
        }
      }

      // Check for conflicts at destination
      let targetPath = originalPath;
      const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (existingFile) {
        const result = await this.showConflictModal(targetPath, 'unarchive');
        if (!result) return;
        targetPath = result;
      }

      const currentPath = file.path;

      // Move the file/folder
      await this.app.vault.rename(file, targetPath);

      // Get the moved file reference
      const movedFile = this.app.vault.getAbstractFileByPath(targetPath);
      if (!movedFile) {
        throw new Error('Failed to find moved file');
      }

      // Remove metadata
      await this.removeArchiveMetadata(movedFile);

      // Show undo notice
      this.showUndoNotice('unarchive', currentPath, targetPath, movedFile, file.name);
    } catch (error) {
      new Notice(`Failed to unarchive: ${error instanceof Error ? error.message : String(error)}`);
      console.error('Unarchive error:', error);
    }
  }

  private async addArchiveMetadata(file: TAbstractFile, originalPath: string) {
    const timestamp = this.getTimestamp();

    if (file instanceof TFile) {
      if (file.extension === 'md') {
        // Add frontmatter for markdown files
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          frontmatter.archived = timestamp;
          frontmatter.archived_from = originalPath;
        });
      } else {
        // Create sidecar file for non-markdown files
        await this.createSidecarFile(file, originalPath, timestamp);
      }
    } else if (file instanceof TFolder) {
      // Create index file for folders
      await this.createFolderIndexFile(file, originalPath, timestamp);
    }
  }

  private readArchiveMetadata(file: TAbstractFile): ArchiveMetadata | null {
    if (file instanceof TFile) {
      if (file.extension === 'md') {
        // Read from frontmatter
        const cache = this.app.metadataCache.getFileCache(file);
        const frontmatter = cache?.frontmatter;
        if (frontmatter?.archived_from) {
          return {
            archived: frontmatter.archived,
            archivedFrom: frontmatter.archived_from,
          };
        }
      } else {
        // Read from sidecar file
        return this.readSidecarFile(file);
      }
    } else if (file instanceof TFolder) {
      // Read from index file
      return this.readFolderIndexFile(file);
    }
    return null;
  }

  private async removeArchiveMetadata(file: TAbstractFile) {
    if (file instanceof TFile) {
      if (file.extension === 'md') {
        // Remove from frontmatter
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          delete frontmatter.archived;
          delete frontmatter.archived_from;
        });
      } else {
        // Delete sidecar file
        await this.deleteSidecarFile(file);
      }
    } else if (file instanceof TFolder) {
      // Delete index file
      await this.deleteFolderIndexFile(file);
    }
  }

  private async createSidecarFile(file: TFile, originalPath: string, timestamp: string) {
    const sidecarPath = `${file.path}.${this.settings.indexFileName}`;
    const displayDate = this.formatDisplayDate(timestamp);
    const content = `---
archived: ${timestamp}
archived_from: ${originalPath}
is_archive_sidecar: true
---

# Archive Metadata

This is a sidecar file for \`${file.name}\`.

Archived on ${displayDate} from \`${originalPath}\`.
`;
    await this.app.vault.create(sidecarPath, content);
  }

  private readSidecarFile(file: TFile): ArchiveMetadata | null {
    const sidecarPath = `${file.path}.${this.settings.indexFileName}`;
    const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
    if (sidecar instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(sidecar);
      const frontmatter = cache?.frontmatter;
      if (frontmatter?.archived_from) {
        return {
          archived: frontmatter.archived,
          archivedFrom: frontmatter.archived_from,
        };
      }
    }
    return null;
  }

  private async deleteSidecarFile(file: TFile) {
    const sidecarPath = `${file.path}.${this.settings.indexFileName}`;
    const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
    if (sidecar instanceof TFile) {
      await this.app.fileManager.trashFile(sidecar);
    }
  }

  private async createFolderIndexFile(folder: TFolder, originalPath: string, timestamp: string) {
    const indexPath = `${folder.path}/${this.settings.indexFileName}`;
    const displayDate = this.formatDisplayDate(timestamp);

    let contentsSection = '';
    if (this.settings.recordContentsInIndex) {
      const contents = this.listFolderContents(folder);
      contentsSection = `\n## Contents at archive time\n${contents}`;
    }

    const folderName = folder.name;
    const content = `---
archived: ${timestamp}
archived_from: ${originalPath}
is_archive_index: true
---

# ${folderName}

This folder was archived on ${displayDate}.
${contentsSection}
`;
    await this.app.vault.create(indexPath, content);
  }

  private listFolderContents(folder: TFolder, prefix = ''): string {
    let result = '';
    for (const child of folder.children) {
      if (child.name === this.settings.indexFileName) continue;
      if (child instanceof TFolder) {
        result += `${prefix}- ${child.name}/\n`;
        result += this.listFolderContents(child, `${prefix}  `);
      } else {
        result += `${prefix}- ${child.name}\n`;
      }
    }
    return result;
  }

  private readFolderIndexFile(folder: TFolder): ArchiveMetadata | null {
    const indexPath = `${folder.path}/${this.settings.indexFileName}`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    if (indexFile instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(indexFile);
      const frontmatter = cache?.frontmatter;
      if (frontmatter?.archived_from) {
        return {
          archived: frontmatter.archived,
          archivedFrom: frontmatter.archived_from,
        };
      }
    }
    return null;
  }

  private async deleteFolderIndexFile(folder: TFolder) {
    const indexPath = `${folder.path}/${this.settings.indexFileName}`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
    if (indexFile instanceof TFile) {
      await this.app.fileManager.trashFile(indexFile);
    }
  }

  private async ensureFolderExists(path: string) {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      await this.app.vault.createFolder(path);
    }
  }

  private showUndoNotice(
    type: 'archive' | 'unarchive',
    originalPath: string,
    newPath: string,
    file: TAbstractFile,
    fileName: string
  ) {
    // Cancel any pending undo
    if (this.pendingUndo) {
      clearTimeout(this.pendingUndo.timeoutId);
      this.pendingUndo = null;
    }

    const action = type === 'archive' ? 'Archived' : 'Unarchived';
    const destination =
      type === 'archive'
        ? this.settings.archivePath
        : newPath.substring(0, newPath.lastIndexOf('/')) || 'root';

    // Create a fragment with undo button
    const fragment = document.createDocumentFragment();
    const text = document.createElement('span');
    text.textContent = `${action} '${fileName}' to ${destination}. `;
    fragment.appendChild(text);

    const undoButton = document.createElement('a');
    undoButton.textContent = 'Undo';
    undoButton.addClass('archive-manager-undo-link');
    undoButton.onclick = () => this.performUndo();
    fragment.appendChild(undoButton);

    new Notice(fragment, this.settings.undoTimeoutSeconds * 1000);

    // Set up undo action
    const timeoutId = setTimeout(() => {
      this.pendingUndo = null;
    }, this.settings.undoTimeoutSeconds * 1000);

    this.pendingUndo = {
      type,
      originalPath,
      newPath,
      file,
      timeoutId,
    };
  }

  private async performUndo() {
    if (!this.pendingUndo) {
      new Notice('Nothing to undo');
      return;
    }

    const { type, originalPath, newPath, file } = this.pendingUndo;
    clearTimeout(this.pendingUndo.timeoutId);
    this.pendingUndo = null;

    try {
      // Get current file reference (path may have changed)
      const currentFile = this.app.vault.getAbstractFileByPath(newPath);
      if (!currentFile) {
        new Notice('Cannot undo: file no longer exists at expected location');
        return;
      }

      // Remove metadata before moving back
      await this.removeArchiveMetadata(currentFile);

      // Move back
      await this.app.vault.rename(currentFile, originalPath);

      const action = type === 'archive' ? 'archive' : 'unarchive';
      new Notice(`Undid ${action} of '${file.name}'`);
    } catch (error) {
      new Notice(`Failed to undo: ${error instanceof Error ? error.message : String(error)}`);
      console.error('Undo error:', error);
    }
  }

  private async showConflictModal(
    path: string,
    operation: 'archive' | 'unarchive'
  ): Promise<string | null> {
    return new Promise((resolve) => {
      new ConflictModal(this.app, path, operation, resolve).open();
    });
  }

  private async showPathMissingModal(originalPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      new PathMissingModal(this.app, originalPath, resolve).open();
    });
  }

  getArchivedItems(): { file: TAbstractFile; metadata: ArchiveMetadata }[] {
    const archiveFolder = this.app.vault.getAbstractFileByPath(this.settings.archivePath);
    if (!(archiveFolder instanceof TFolder)) {
      return [];
    }

    const items: { file: TAbstractFile; metadata: ArchiveMetadata }[] = [];

    const processFolder = (folder: TFolder) => {
      for (const child of folder.children) {
        // Skip index files
        if (child.name === this.settings.indexFileName) continue;
        if (child.name.endsWith(`.${this.settings.indexFileName}`)) continue;

        if (child instanceof TFolder) {
          // Check if folder has index file (is an archived folder)
          const indexPath = `${child.path}/${this.settings.indexFileName}`;
          const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
          if (indexFile instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(indexFile);
            const fm = cache?.frontmatter;
            if (fm?.is_archive_index) {
              items.push({
                file: child,
                metadata: {
                  archived: fm.archived,
                  archivedFrom: fm.archived_from,
                },
              });
              continue; // Don't recurse into archived folders
            }
          }
          // Recurse into non-archived subfolders
          processFolder(child);
        } else if (child instanceof TFile) {
          if (child.extension === 'md') {
            const cache = this.app.metadataCache.getFileCache(child);
            const fm = cache?.frontmatter;
            if (fm?.archived_from && !fm?.is_archive_index && !fm?.is_archive_sidecar) {
              items.push({
                file: child,
                metadata: {
                  archived: fm.archived,
                  archivedFrom: fm.archived_from,
                },
              });
            }
          } else {
            // Check for sidecar file
            const sidecarPath = `${child.path}.${this.settings.indexFileName}`;
            const sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
            if (sidecar instanceof TFile) {
              const cache = this.app.metadataCache.getFileCache(sidecar);
              const fm = cache?.frontmatter;
              if (fm?.archived_from) {
                items.push({
                  file: child,
                  metadata: {
                    archived: fm.archived,
                    archivedFrom: fm.archived_from,
                  },
                });
              }
            }
          }
        }
      }
    };

    processFolder(archiveFolder);
    return items;
  }

  /**
   * Find all existing index/sidecar files in the archive
   */
  findAllIndexFiles(): TFile[] {
    const archiveFolder = this.app.vault.getAbstractFileByPath(this.settings.archivePath);
    if (!(archiveFolder instanceof TFolder)) {
      return [];
    }

    const indexFiles: TFile[] = [];
    const currentIndexName = this.settings.indexFileName;

    const processFolder = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          // Check for folder index file
          const indexPath = `${child.path}/${currentIndexName}`;
          const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
          if (indexFile instanceof TFile) {
            indexFiles.push(indexFile);
          }
          processFolder(child);
        } else if (child instanceof TFile) {
          // Check if it's a sidecar file
          if (child.name.endsWith(`.${currentIndexName}`)) {
            indexFiles.push(child);
          }
          // Check if it's a folder index file at archive root level
          if (child.name === currentIndexName) {
            indexFiles.push(child);
          }
        }
      }
    };

    processFolder(archiveFolder);
    return indexFiles;
  }

  /**
   * Check if renaming index files would cause conflicts
   */
  checkIndexFileRenameConflicts(newName: string): string[] {
    const indexFiles = this.findAllIndexFiles();
    const conflicts: string[] = [];

    for (const file of indexFiles) {
      let newPath: string;
      if (file.name.endsWith(`.${this.settings.indexFileName}`)) {
        // Sidecar file: replace suffix
        const basePath = file.path.slice(0, -this.settings.indexFileName.length);
        newPath = `${basePath}${newName}`;
      } else {
        // Folder index file: replace name in folder
        const parentPath = file.path.slice(0, -file.name.length);
        newPath = `${parentPath}${newName}`;
      }

      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing && existing !== file) {
        conflicts.push(newPath);
      }
    }

    return conflicts;
  }

  /**
   * Rename all index files to use new name
   */
  async renameAllIndexFiles(newName: string): Promise<number> {
    const indexFiles = this.findAllIndexFiles();
    let renamed = 0;

    for (const file of indexFiles) {
      let newPath: string;
      if (file.name.endsWith(`.${this.settings.indexFileName}`)) {
        // Sidecar file: replace suffix
        const basePath = file.path.slice(0, -this.settings.indexFileName.length);
        newPath = `${basePath}${newName}`;
      } else {
        // Folder index file: replace name in folder
        const parentPath = file.path.slice(0, -file.name.length);
        newPath = `${parentPath}${newName}`;
      }

      try {
        await this.app.vault.rename(file, newPath);
        renamed++;
      } catch (error) {
        console.error(`Failed to rename ${file.path} to ${newPath}:`, error);
      }
    }

    return renamed;
  }

  onunload() {
    if (this.pendingUndo) {
      clearTimeout(this.pendingUndo.timeoutId);
    }
  }
}

class ArchiveManagerSettingTab extends PluginSettingTab {
  plugin: ArchiveManagerPlugin;

  constructor(app: App, plugin: ArchiveManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Archive folder')
      .setDesc('The folder where archived items will be moved to')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.archivePath)
          .onChange(async (value) => {
            this.plugin.settings.archivePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Confirm before archive')
      .setDesc('Show a confirmation dialog before archiving items')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.confirmBeforeArchive).onChange(async (value) => {
          this.plugin.settings.confirmBeforeArchive = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Confirm before unarchive')
      .setDesc('Show a confirmation dialog before unarchiving items')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.confirmBeforeUnarchive).onChange(async (value) => {
          this.plugin.settings.confirmBeforeUnarchive = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Undo timeout')
      .setDesc('How many seconds the undo option is available after archiving')
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.undoTimeoutSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.undoTimeoutSeconds = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Show in context menu')
      .setDesc('Add archive/unarchive options to the right-click context menu')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showInContextMenu).onChange(async (value) => {
          this.plugin.settings.showInContextMenu = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Index file name')
      .setDesc('Name of the metadata file created for archived folders')
      .addButton((button) =>
        button.setButtonText(this.plugin.settings.indexFileName).onClick(() => {
          new ChangeIndexFileNameModal(this.app, this.plugin, () => this.display()).open();
        })
      );

    new Setting(containerEl)
      .setName('Record contents in index')
      .setDesc('Include a list of folder contents when creating the archive index file')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.recordContentsInIndex).onChange(async (value) => {
          this.plugin.settings.recordContentsInIndex = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

class ConflictModal extends Modal {
  private path: string;
  private operation: 'archive' | 'unarchive';
  private resolve: (value: string | null) => void;

  constructor(
    app: App,
    path: string,
    operation: 'archive' | 'unarchive',
    resolve: (value: string | null) => void
  ) {
    super(app);
    this.path = path;
    this.operation = operation;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'File conflict' });
    contentEl.createEl('p', {
      text: `A file or folder already exists at: ${this.path}`,
    });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    // Replace existing
    const replaceBtn = buttonContainer.createEl('button', { text: 'Replace existing' });
    replaceBtn.onclick = async () => {
      const existing = this.app.vault.getAbstractFileByPath(this.path);
      if (existing) {
        if (existing instanceof TFile) {
          await this.app.fileManager.trashFile(existing);
        } else {
          await this.app.vault.trash(existing, true);
        }
      }
      this.close();
      this.resolve(this.path);
    };

    // Keep both (append number)
    const keepBothBtn = buttonContainer.createEl('button', { text: 'Keep both' });
    keepBothBtn.onclick = () => {
      const newPath = this.generateUniquePath(this.path);
      this.close();
      this.resolve(newPath);
    };

    // Cancel
    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.close();
      this.resolve(null);
    };
  }

  private generateUniquePath(path: string): string {
    const lastDot = path.lastIndexOf('.');
    const lastSlash = path.lastIndexOf('/');

    let basePath: string;
    let extension: string;

    if (lastDot > lastSlash) {
      // Has extension
      basePath = path.substring(0, lastDot);
      extension = path.substring(lastDot);
    } else {
      // No extension (folder)
      basePath = path;
      extension = '';
    }

    let counter = 2;
    let newPath = `${basePath} ${counter}${extension}`;
    while (this.app.vault.getAbstractFileByPath(newPath)) {
      counter++;
      newPath = `${basePath} ${counter}${extension}`;
    }
    return newPath;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class PathMissingModal extends Modal {
  private originalPath: string;
  private resolve: (value: string | null) => void;

  constructor(app: App, originalPath: string, resolve: (value: string | null) => void) {
    super(app);
    this.originalPath = originalPath;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Original location missing' });
    contentEl.createEl('p', {
      text: `The original location no longer exists: ${this.originalPath}`,
    });

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    // Create path and restore
    const createBtn = buttonContainer.createEl('button', { text: 'Create path and restore' });
    createBtn.onclick = () => {
      this.close();
      this.resolve('create');
    };

    // Cancel
    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.close();
      this.resolve(null);
    };
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class ChangeIndexFileNameModal extends Modal {
  private plugin: ArchiveManagerPlugin;
  private onSave: () => void;
  private newName: string;

  constructor(app: App, plugin: ArchiveManagerPlugin, onSave: () => void) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.newName = plugin.settings.indexFileName;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Change index file name' });

    const existingCount = this.plugin.findAllIndexFiles().length;
    if (existingCount > 0) {
      contentEl.createEl('p', {
        text: `There are ${existingCount} existing index file(s) that will be renamed.`,
        cls: 'mod-warning',
      });
    }

    new Setting(contentEl)
      .setName('New file name')
      .setDesc('Must end with .md')
      .addText((text) =>
        text.setValue(this.newName).onChange((value) => {
          this.newName = value;
        })
      );

    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

    const saveBtn = buttonContainer.createEl('button', {
      text: 'Save',
      cls: 'mod-cta',
    });
    saveBtn.onclick = async () => {
      await this.handleSave();
    };

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.onclick = () => {
      this.close();
    };
  }

  private async handleSave() {
    const newName = this.newName.trim();

    // Validate
    if (!newName) {
      new Notice('File name cannot be empty');
      return;
    }

    if (!newName.endsWith('.md')) {
      new Notice('File name must end with .md');
      return;
    }

    if (newName === this.plugin.settings.indexFileName) {
      this.close();
      return;
    }

    // Check for conflicts
    const conflicts = this.plugin.checkIndexFileRenameConflicts(newName);
    if (conflicts.length > 0) {
      new Notice(
        `Cannot rename: ${conflicts.length} conflict(s) found. Files already exist at:\n${conflicts.slice(0, 3).join('\n')}${conflicts.length > 3 ? '\n...' : ''}`
      );
      return;
    }

    // Rename existing files
    const existingFiles = this.plugin.findAllIndexFiles();
    if (existingFiles.length > 0) {
      const renamed = await this.plugin.renameAllIndexFiles(newName);
      new Notice(`Renamed ${renamed} index file(s)`);
    }

    // Update setting
    this.plugin.settings.indexFileName = newName;
    await this.plugin.saveSettings();

    this.close();
    this.onSave();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

class BrowseArchiveModal extends FuzzySuggestModal<{
  file: TAbstractFile;
  metadata: ArchiveMetadata;
}> {
  private plugin: ArchiveManagerPlugin;
  private items: { file: TAbstractFile; metadata: ArchiveMetadata }[];

  constructor(app: App, plugin: ArchiveManagerPlugin) {
    super(app);
    this.plugin = plugin;
    this.items = plugin.getArchivedItems();
    this.setPlaceholder('Search archived items...');
  }

  getItems(): { file: TAbstractFile; metadata: ArchiveMetadata }[] {
    return this.items;
  }

  getItemText(item: { file: TAbstractFile; metadata: ArchiveMetadata }): string {
    return `${item.file.name} (from ${item.metadata.archivedFrom})`;
  }

  onChooseItem(item: { file: TAbstractFile; metadata: ArchiveMetadata }) {
    void this.plugin.unarchiveItem(item.file);
  }

  onNoSuggestion() {
    this.resultContainerEl.empty();
    this.resultContainerEl.createEl('div', {
      text: 'No archived items found',
      cls: 'suggestion-empty',
    });
  }
}
