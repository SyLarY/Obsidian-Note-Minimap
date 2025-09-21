import { MarkdownView, WorkspaceLeaf } from "obsidian";
import type { MinimapHost } from "./types";

export class MinimapRenderer {
  private host: MinimapHost;
  private leaf: WorkspaceLeaf;

  private canvas: HTMLCanvasElement | null = null;

  constructor(host: MinimapHost, leaf: WorkspaceLeaf) {
    this.host = host;
    this.leaf = leaf;
  }

  /** Create DOM (canvas + resize handle) and attach listeners */
  attach(): void {
    if (!(this.leaf.view instanceof MarkdownView)) return;
    if (this.canvas) return; // already attached

    const container = this.leaf.view.containerEl;

    // Canvas
    const canvas = document.createElement("canvas");
    canvas.classList.add("minimap");
    canvas.style.setProperty("--minimap-opacity", `${this.host.settings.minimapOpacity}`);
    canvas.style.cssText = `
      position: fixed;
      top: 50px;
      right: 12px;
      width: ${this.host.settings.width}px;
      height: calc(100vh - 50px);
      z-index: 1000;
      background: var(--background-primary);
      cursor: pointer;
      transition: opacity 0.2s ease-in-out;
      border-left: 0px;
    `;
    
    const editorElement = this.leaf.view.containerEl.querySelector(".cm-scroller");
    if (editorElement) {
      editorElement.addEventListener("scroll", this.onEditorScroll, { passive: true });
    }

    // minimap drag scroll
    canvas.addEventListener("mousedown", (e) => {
      this.host.isDragging = true;
      this.scrollToMinimapPosition(e);
    });
    canvas.addEventListener("mousemove", (e) => {
      if (this.host.isDragging) this.scrollToMinimapPosition(e);
    });
    document.addEventListener("mouseup", () => (this.host.isDragging = false));
    document.addEventListener("mouseleave", () => (this.host.isDragging = false));

    // context menu
    canvas.addEventListener("contextmenu", (e) => {
      this.createContextMenu(e, canvas);
    });

    container.appendChild(canvas);
    //container.appendChild(handle);

    this.canvas = canvas;
    //this.resizeHandle = handle;

    this.update(); // initial paint
  }

  /** Detach DOM and listeners */
  detach(): void {
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }
 
    const editorElement =
      this.leaf.view instanceof MarkdownView
        ? this.leaf.view.containerEl.querySelector(".cm-scroller")
        : null;
    if (editorElement) {
      editorElement.removeEventListener("scroll", this.onEditorScroll);
    }
  }

  /** Update drawing to reflect current editor state */
  update(): void {
    if (!this.canvas) return;

    this.canvas.style.setProperty("--minimap-opacity", `${this.host.settings.minimapOpacity}`);

    if (!(this.leaf.view instanceof MarkdownView)) return;

    const editor = this.leaf.view.editor;
    const editorElement = this.leaf.view.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
    if (!editorElement) return;

    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    if (!this.host.settings.showMinimap) {
      this.canvas.style.display = "none";
      return;
    } else {
      this.canvas.style.display = "block";
    }

    // Sizing
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.floor(this.host.settings.width * this.host.settings.minimapScaling);
    const displayHeight = Math.floor((window.innerHeight - 32) * this.host.settings.minimapScaling);

    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;

    ctx.scale(dpr, dpr);

    // background
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--background-primary");
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    const cmEditor: any = (editor as any).cm;
    if (!cmEditor) return;

    const totalLines: number = cmEditor.state.doc.lines;
    const editorHeight = editorElement.scrollHeight;
    const scale = displayHeight / editorHeight;

    // density/line height
    const baseLineHeight = Math.max(1, Math.floor(this.host.settings.lineHeight * this.host.settings.lineSpacing));
    const effectiveLineHeight = Math.max(1, baseLineHeight * scale);

    const getContentWidth = (content: string, indent = 0) => {
      const textLength = content.trim().length;
      return Math.min(
        textLength * this.host.settings.textDensity,
        displayWidth - 8 - indent * this.host.settings.textDensity
      );
    };

    const batchSize = 50;

    const processLines = (start: number, end: number) => {
      for (let lineNo = start; lineNo <= end; lineNo++) {
        if (lineNo > totalLines) break;

        const line = cmEditor.state.doc.line(lineNo);
        const lineInfo = cmEditor.lineBlockAt(line.from);

        const top = lineInfo.top;
        const y = Math.floor(top * scale);
        const height = Math.max(effectiveLineHeight, Math.floor(lineInfo.height * scale));

        if (y < -height || y > displayHeight + height) continue;

        const content: string = line.text;

        // Embeds & images: ![[...]]
        const wikiMatch = content.match(/!\[\[(.*?)\]\]/);
        if (wikiMatch) {
          const embedPath = wikiMatch[1];
          if (this.isImagePath(embedPath)) {
            // image block
            ctx.fillStyle = this.host.settings.imageColor;
            const imageHeight = height * 1.5;
            ctx.fillRect(8, y, displayWidth - 16, imageHeight);
          } else {
            // generic embed block
            ctx.fillStyle = this.host.settings.embedColor;
            const embedHeight = height * 2;
            ctx.fillRect(4, y, displayWidth - 8, embedHeight);
            ctx.strokeStyle = "#000000";
            ctx.strokeRect(4, y, displayWidth - 8, embedHeight);
          }
          continue;
        }

        // Headers
        if (content.startsWith("#") && this.host.settings.showHeaders) {
          const headerLevel = (content.match(/^#+/)?.[0].length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
          const color =
            (this.host.settings as any)[`header${headerLevel}Color`] ||
            this.host.settings.headerColor;
          ctx.fillStyle = color;

          const headerText = content.replace(/^#+\s*/, "");
          const headerWidth = Math.min(ctx.measureText(headerText).width + 16, displayWidth - 8);
          const headerHeight = Math.max(height * 1.2, 3);
          ctx.fillRect(4, y, headerWidth, headerHeight);
          continue;
        }

        // Code block fence
        if (content.trim().startsWith("```") && this.host.settings.showCodeBlocks) {
          ctx.fillStyle = this.host.settings.codeBlockColor;
          ctx.fillRect(4, y, displayWidth - 8, Math.max(1.5, height));
          continue;
        }

        // table row (naive)
        if (content.includes("|")) {
          ctx.fillStyle = this.host.settings.tableColor;
          const cells = content.split("|").filter((c) => c.trim());
          const tableWidth = Math.min(cells.length * 20, displayWidth - 16);
          ctx.fillRect(8, y, tableWidth, Math.max(1, height));
          continue;
        }

        // normal text
        if (content.trim().length > 0) {
          ctx.fillStyle = this.host.settings.textColor;
          const indent = content.search(/\S/) || 0;
          const width = getContentWidth(content, indent);
          const x = Math.floor(4 + indent * this.host.settings.textDensity);
          ctx.fillRect(x, y, width, Math.max(1, height * 0.8));
        }
      }
    };

    for (let i = 1; i <= totalLines; i += batchSize) {
      processLines(i, i + batchSize - 1);
    }

    // viewport indicator
    const scrollTop = editorElement.scrollTop;
    const viewportHeight = editorElement.clientHeight;

    const indicatorHeight = viewportHeight * scale;
    const indicatorY = scrollTop * scale;

    if (this.host.settings.indicatorOpacity > 0) {
      ctx.fillStyle = this.host.settings.indicatorColor;
      ctx.globalAlpha = this.host.settings.indicatorOpacity;
      ctx.fillRect(0, indicatorY, displayWidth, indicatorHeight);

      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = this.host.settings.indicatorColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(0, indicatorY, displayWidth, indicatorHeight);

      ctx.globalAlpha = 1;
    }
  }

  /** Show/hide based on per-file toggle and update if shown */
  syncVisibility(): void {
    if (!this.canvas) return;
    const file = this.leaf.view instanceof MarkdownView ? this.leaf.view.file : null;
    if (!file || !this.host.isMinimapEnabledForFile(file.path)) {
      this.canvas.style.display = "none";
      return;
    }
    this.canvas.style.display = "block";
    this.update();
  }

  /** ---------------- private helpers ---------------- */

  private onEditorScroll = () => {
    if (!this.host.isDragging) this.update();
  };

  private scrollToMinimapPosition(e: MouseEvent): void {
    if (!this.canvas) return;
    if (!(this.leaf.view instanceof MarkdownView)) return;

    const editor = this.leaf.view.editor;
    const editorElement = this.leaf.view.containerEl.querySelector(".cm-scroller") as HTMLElement | null;
    if (!editorElement) return;

    const rect = this.canvas.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const canvasHeight = rect.height;

    const totalHeight = editorElement.scrollHeight;
    const viewportHeight = editorElement.clientHeight;

    const scrollRatio = clickY / canvasHeight;
    const newScrollTop = Math.max(
      0,
      Math.min(scrollRatio * totalHeight - viewportHeight / 2, totalHeight - viewportHeight)
    );

    editorElement.scrollTop = newScrollTop;
    this.update();
  }

  private createContextMenu(e: MouseEvent, canvas: HTMLCanvasElement): void {
    e.preventDefault();

    const existing = document.querySelector(".minimap-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "minimap-context-menu";
    menu.style.cssText = `
      position: fixed;
      z-index: 1001;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 4px;
      padding: 4px 0;
      min-width: 150px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      left: ${e.clientX}px;
      top: ${e.clientY}px;
    `;

    // Sections
    const scaleSection = this.createMenuSection("Scale");
    const opacitySection = this.createMenuSection("Opacity");

    const scaleOptions = Array.from({ length: 10 }, (_, i) => ({
      label: `Scale: ${(i + 1) * 10}%`,
      value: (i + 1) * 0.1,
    }));
    const opacityOptions = Array.from({ length: 10 }, (_, i) => ({
      label: `Opacity: ${(i + 1) * 10}%`,
      value: (i + 1) * 0.1,
    }));

    scaleOptions.forEach((opt) => {
      this.addMenuItem(
        scaleSection,
        opt.label,
        async () => {
          this.host.settings.minimapScaling = opt.value;
          await this.host.saveSettings();
          this.host.refreshMinimaps();
        },
        this.host.settings.minimapScaling === opt.value
      );
    });

    opacityOptions.forEach((opt) => {
      this.addMenuItem(
        opacitySection,
        opt.label,
        async () => {
          this.host.settings.minimapOpacity = opt.value;
          await this.host.saveSettings();
          this.host.refreshMinimaps();
        },
        this.host.settings.minimapOpacity === opt.value
      );
    });

    menu.appendChild(scaleSection);
    menu.appendChild(opacitySection);

    document.body.appendChild(menu);
    const closeMenu = (evt: MouseEvent) => {
      if (!menu.contains(evt.target as Node)) {
        menu.remove();
        document.removeEventListener("click", closeMenu);
      }
    };
    document.addEventListener("click", closeMenu);
  }

  private createMenuSection(title: string): HTMLDivElement {
    const section = document.createElement("div");
    section.className = "minimap-menu-section";
    section.style.cssText = `
      padding: 4px 0;
      border-bottom: 1px solid var(--background-modifier-border);
    `;
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.cssText = `
      padding: 2px 8px;
      color: var(--text-muted);
      font-size: 0.8em;
    `;
    section.appendChild(titleEl);
    return section;
  }

  private addMenuItem(
    container: HTMLElement,
    label: string,
    onClick: () => void | Promise<void>,
    isActive = false
  ): void {
    const item = document.createElement("div");
    item.className = "minimap-menu-item";
    item.style.cssText = `
      padding: 4px 8px;
      cursor: pointer;
      color: var(--text-normal);
      ${isActive ? "background-color: var(--background-modifier-hover);" : ""}
    `;
    item.textContent = label;

    item.addEventListener("click", () => void onClick());
    item.addEventListener("mouseenter", () => {
      item.style.backgroundColor = "var(--background-modifier-hover)";
    });
    item.addEventListener("mouseleave", () => {
      if (!isActive) item.style.backgroundColor = "";
    });

    container.appendChild(item);
  }

  private isImagePath(path: string): boolean {
    const lower = path.toLowerCase();
    return [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp"].some((ext) =>
      lower.endsWith(ext)
    );
  }
}
