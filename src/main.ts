// src/main.ts
import {
  App,
  MarkdownView,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";
import { MinimapRenderer } from "./MinimapRenderer";
import {
  DEFAULT_SETTINGS,
  IMAGE_EXTENSIONS,
  MinimapHost,
  MinimapSettings,
} from "./types";

export default class MinimapPlugin extends Plugin implements MinimapHost {
  settings!: MinimapSettings;

  /** leaf → renderer */
  private minimaps: Map<WorkspaceLeaf, MinimapRenderer> = new Map();

  /** image src → HTMLImageElement (optional preloading) */
  private minimapCache: Map<string, HTMLImageElement> = new Map();

  /** shared dragging flag (used by renderer while dragging on minimap) */
  public isDragging = false;

  // ---------------- lifecycle ----------------

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addSettingTab(new MinimapSettingTab(this.app, this));

    // command: toggle minimap for current file
    this.addCommand({
      id: "toggle-minimap-for-current-file",
      name: "Toggle Minimap for Current Note",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return;
        const p = file.path;
        const idx = this.settings.disabledFiles.indexOf(p);
        if (idx === -1) this.settings.disabledFiles.push(p);
        else this.settings.disabledFiles.splice(idx, 1);
        void this.saveSettings();
        this.refreshMinimaps();
      },
    });

    // Global/document scroll → update active minimap (safe & typed)
    this.registerDomEvent(document, "scroll", () => {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf && leaf.view instanceof MarkdownView && !this.isDragging) {
        this.updateMinimap(leaf);
      }
    });

    // Create initial minimap if a markdown view is already active
    {
      const leaf = this.app.workspace.activeLeaf;
      if (leaf && leaf.view instanceof MarkdownView) {
        this.createMinimap(leaf);
      }
    }

    // React to layout/leaf/editor changes
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.handleLayoutChange())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          this.createMinimap(leaf);
          this.updateMinimap(leaf);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        const leaf = this.app.workspace.activeLeaf;
        if (leaf && leaf.view instanceof MarkdownView) {
          this.updateMinimap(leaf);
        }
      })
    );

    // Use the typed helper instead of the string event literal
    this.app.workspace.onLayoutReady(() => {
      // Optional: preload images visible in the active doc, then refresh
      void this.prerenderMinimap();
    });
  }

  onunload(): void {
    this.minimaps.forEach((r) => r.detach());
    this.minimaps.clear();
  }

  // ---------------- settings ----------------

  async loadSettings(): Promise<void> {
    try {
      const data = await this.loadData();
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      if (data) {
        this.settings.disabledFiles = Array.isArray(data.disabledFiles)
          ? data.disabledFiles
          : [];
        for (const key of Object.keys(data)) {
          if (key !== "disabledFiles") {
            // @ts-expect-error dynamic assignment of known keys
            this.settings[key] = data[key];
          }
        }
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ---------------- host API for renderer ----------------

  isMinimapEnabledForFile(filePath: string): boolean {
    return (
      this.settings.showMinimap &&
      !this.settings.disabledFiles.includes(filePath)
    );
  }

  refreshMinimaps(): void {
    this.minimaps.forEach((renderer) => renderer.syncVisibility());
  }

  // ---------------- internal helpers ----------------

  private updateMinimap(leaf: WorkspaceLeaf): void {
    const r = this.minimaps.get(leaf);
    if (!r) return;
    r.update();
  }

  private handleLayoutChange(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");

    // remove detached leaves
    for (const [leaf, renderer] of this.minimaps) {
      if (!leaves.includes(leaf)) {
        renderer.detach();
        this.minimaps.delete(leaf);
      }
    }

    // create for new leaves
    leaves.forEach((leaf) => {
      if (!this.minimaps.has(leaf)) {
        this.createMinimap(leaf);
      }
    });
  }

  private createMinimap(leaf: WorkspaceLeaf | null): void {
    if (!leaf || !(leaf.view instanceof MarkdownView)) return;
    if (this.minimaps.has(leaf)) return;

    const renderer = new MinimapRenderer(this, leaf);

    // Attach and hook an editor-level scroll listener (typed)
    renderer.attach();

    // Also listen on the editor scroller via DOM for continuous updates
    const scroller = leaf.view.containerEl.querySelector<HTMLElement>(
      ".cm-scroller"
    );
    if (scroller) {
      this.registerDomEvent(scroller, "scroll", () => {
        if (!this.isDragging) this.updateMinimap(leaf);
      });
    }

    this.minimaps.set(leaf, renderer);
    renderer.syncVisibility();
  }

  // ---------- optional image preloading for minimap ----------

  private isImagePath(path: string): boolean {
    const lower = path.toLowerCase();
    return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  private parseContentForImages(content: string): string[] {
    const results: string[] = [];
    // Markdown image: ![alt](path)
    const mdImg = /!\[[^\]]*]\((.*?)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdImg.exec(content)) !== null) {
      const src = m[1]?.trim();
      if (src && this.isImagePath(src)) results.push(src);
    }
    // Wiki image: ![[path]]
    const wikiImg = /!\[\[(.*?)\]\]/g;
    while ((m = wikiImg.exec(content)) !== null) {
      const src = m[1]?.trim();
      if (src && this.isImagePath(src)) results.push(src);
    }
    return results;
  }

  private async prerenderMinimap(): Promise<void> {
    if (!this.settings.showMinimap) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const content = view.getViewData();
    const images = this.parseContentForImages(content);

    await Promise.all(
      images.map(async (src) => {
        if (this.minimapCache.has(src)) return;
        const img = new Image();
        img.src = src;
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
        });
        this.minimapCache.set(src, img);
      })
    );

    this.refreshMinimaps();
  }
}

// ---------------- Settings tab ----------------

class MinimapSettingTab extends PluginSettingTab {
  plugin: MinimapPlugin;

  constructor(app: App, plugin: MinimapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Minimap Settings" });

    // General
    containerEl.createEl("h3", { text: "General Settings" });

    new Setting(containerEl)
      .setName("Minimap Scaling")
      .setDesc("Adjust minimap detail level (lower = more precise)")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1.0, 0.1)
          .setValue(this.plugin.settings.minimapScaling)
          .onChange(async (value) => {
            this.plugin.settings.minimapScaling = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Text Density")
      .setDesc("Adjust text representation density")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 3.0, 0.1)
          .setValue(this.plugin.settings.textDensity)
          .onChange(async (value) => {
            this.plugin.settings.textDensity = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Show Minimap")
      .setDesc("Toggle minimap visibility")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showMinimap)
          .onChange(async (value) => {
            this.plugin.settings.showMinimap = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Minimap Width")
      .setDesc("Width of the minimap in pixels")
      .addSlider((slider) =>
        slider
          .setLimits(50, 300, 10)
          .setValue(this.plugin.settings.width)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.width = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Line Height")
      .setDesc("Height of each line in the minimap")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 0.5)
          .setValue(this.plugin.settings.lineHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lineHeight = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Minimap Opacity")
      .setDesc("Overall opacity of the minimap")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.1)
          .setValue(this.plugin.settings.minimapOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.minimapOpacity = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    // Visibility
    containerEl.createEl("h3", { text: "Element Visibility" });

    new Setting(containerEl)
      .setName("Show Headers")
      .setDesc("Show headers in the minimap")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHeaders)
          .onChange(async (value) => {
            this.plugin.settings.showHeaders = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Show Lists")
      .setDesc("Show list items in the minimap")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showLists)
          .onChange(async (value) => {
            this.plugin.settings.showLists = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Show Code Blocks")
      .setDesc("Show code blocks in the minimap")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showCodeBlocks)
          .onChange(async (value) => {
            this.plugin.settings.showCodeBlocks = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    // Colors
    containerEl.createEl("h3", { text: "Color Settings" });

    new Setting(containerEl)
      .setName("Header 1 Color")
      .setDesc("Color for level 1 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header1Color)
          .onChange(async (value) => {
            this.plugin.settings.header1Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Header 2 Color")
      .setDesc("Color for level 2 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header2Color)
          .onChange(async (value) => {
            this.plugin.settings.header2Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Header 3 Color")
      .setDesc("Color for level 3 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header3Color)
          .onChange(async (value) => {
            this.plugin.settings.header3Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Header 4 Color")
      .setDesc("Color for level 4 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header4Color)
          .onChange(async (value) => {
            this.plugin.settings.header4Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Header 5 Color")
      .setDesc("Color for level 5 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header5Color)
          .onChange(async (value) => {
            this.plugin.settings.header5Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Header 6 Color")
      .setDesc("Color for level 6 headers")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.header6Color)
          .onChange(async (value) => {
            this.plugin.settings.header6Color = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Text Color")
      .setDesc("Color for regular text")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.textColor)
          .onChange(async (value) => {
            this.plugin.settings.textColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Code Block Color")
      .setDesc("Color for code blocks")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.codeBlockColor)
          .onChange(async (value) => {
            this.plugin.settings.codeBlockColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Image Color")
      .setDesc("Color for images")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.imageColor)
          .onChange(async (value) => {
            this.plugin.settings.imageColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Table Color")
      .setDesc("Color for tables")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.tableColor)
          .onChange(async (value) => {
            this.plugin.settings.tableColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Indicator Color")
      .setDesc("Color for the scroll indicator")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.indicatorColor)
          .onChange(async (value) => {
            this.plugin.settings.indicatorColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Indicator Opacity")
      .setDesc("Opacity of the scroll indicator")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1, 0.1)
          .setValue(this.plugin.settings.indicatorOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.indicatorOpacity = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Embed Color")
      .setDesc("Color for Obsidian embeds (![[]])")
      .addColorPicker((color) =>
        color
          .setValue(this.plugin.settings.embedColor)
          .onChange(async (value) => {
            this.plugin.settings.embedColor = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );

    new Setting(containerEl)
      .setName("Density")
      .setDesc("Controls spacing between elements (lower = more compact)")
      .addSlider((slider) =>
        slider
          .setLimits(0.5, 2.5, 0.1)
          .setValue(this.plugin.settings.density)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.density = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMinimaps();
          })
      );
  }
}
