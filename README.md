# Obsidian Minimap Plugin

A feature-rich, VS Code–style minimap for Obsidian that gives you a bird’s-eye view of your notes and lets you navigate them instantly.

> **Credits:**  
> Original plugin created by [**Th0rGarden**](https://github.com/Th0rGarden/obsidian-minimap).  
> This fork adds major refactors of ts files, fixes bugs for improved usability and customization.

## ✨ Features
- **Visual Overview:** Compact canvas showing headers, lists, code blocks, images, tables, and embeds with distinct colors.
- **Per-File Control:** Toggle the minimap on/off for individual notes with a single command.
- **Interactive Navigation:** Click within the minimap to jump to any section of the document.
- **Context Menu:** Right-click to adjust scaling and opacity on the fly.
- **Customizable Settings:** Fine-tune width, opacity, line height, text density, colors, and element visibility from a dedicated settings tab.

## 📦 Installation
**Manual install:** Copy the built plugin folder into `<your-vault>/.obsidian/plugins/minimap/`.

## 🚀 Usage
- The minimap appears on the right side of markdown notes by default.
- Use **Command Palette → Toggle Minimap for Current Note** to enable/disable it per file.
- Right-click the minimap to adjust scale or opacity.
- Configure appearance under **Settings → Minimap Settings**.

## ⚙️ Settings
- **General:** Width, opacity, line height, density, scaling.
- **Element Visibility:** Toggle headers, lists, and code blocks.
- **Colors:** Fully customizable for headers (1–6), text, code blocks, tables, embeds, images, and scroll indicator.

## 🛠 Development
```bash
git clone <repository-url>
npm install
npm run build
```

## 🤝Contributing
- Report issues or suggest features via GitHub Issues.
- Submit pull requests with improvements or bug fixes.

## License
MIT License
