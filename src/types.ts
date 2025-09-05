import type { App } from "obsidian";

/** Settings shape for the plugin */
export interface MinimapSettings {
  disabledFiles: string[];
  width: number;
  lineHeight: number;
  minimapOpacity: number;
  showMinimap: boolean;
  showHeaders: boolean;
  showLists: boolean;
  showCodeBlocks: boolean;
  headerColor: string;
  textColor: string;
  codeBlockColor: string;
  indicatorColor: string;
  indicatorOpacity: number;
  header1Color: string;
  header2Color: string;
  header3Color: string;
  header4Color: string;
  header5Color: string;
  header6Color: string;
  imageColor: string;
  tableColor: string;
  minElementWidth: number;
  minElementHeight: number;
  embedColor: string;
  density: number;
  minimapScaling: number; // overall minimap size
  lineSpacing: number;    // vertical spacing multiplier
  textDensity: number;    // horizontal density multiplier
}

export const DEFAULT_SETTINGS: MinimapSettings = {
  disabledFiles: [],
  width: 150,
  lineHeight: 4,
  minimapOpacity: 0.5,
  showMinimap: true,
  showHeaders: true,
  showLists: true,
  showCodeBlocks: true,
  headerColor: "#00BADA",
  textColor: "#808080",
  codeBlockColor: "#0000FF",
  indicatorColor: "#4444FF",
  indicatorOpacity: 0.2,
  header1Color: "#FF0000",
  header2Color: "#00FF00",
  header3Color: "#0000FF",
  header4Color: "#FFFF00",
  header5Color: "#FF00FF",
  header6Color: "#00FFFF",
  imageColor: "#A0A0A0",
  tableColor: "#808080",
  minElementWidth: 4,
  minElementHeight: 1,
  embedColor: "#6A9955",
  density: 1,
  minimapScaling: 0.5,
  lineSpacing: 1.2,
  textDensity: 1.5,
};

export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".svg",
  ".webp",
];

/** Host contract that the renderer needs from the plugin */
export interface MinimapHost {
  app: App;
  settings: MinimapSettings;
  isDragging: boolean;
  saveSettings(): Promise<void>;
  refreshMinimaps(): void;
  isMinimapEnabledForFile(filePath: string): boolean;
}
