# Gallium visual identity

The logo is a transparent square outline containing Ga and atomic number 31. Use the same monochrome tile at small sizes and reverse it on dark surfaces. Arial Bold sets Ga, with regular Arial for 31. The frame has sharp 90-degree corners.

| Role | Color | Use |
| --- | --- | --- |
| Graphite | `#11181c` | Hero, terminal output, and command blocks |
| Paper | `#f4f5f6` | Setup surfaces and tab controls |
| Ink | `#172126` | Text on light surfaces |
| Signal cyan | `#a6f0ed` | Primary action, focus on dark surfaces, and selected element highlights |

Use the system sans stack for reading and headings. Reserve monospace for commands and element data. Keep metallic reflections inside the artwork so copy and controls sit on solid surfaces.

- [Monochrome mark](../site/mark.svg) works on light or dark backgrounds with a single color.
- The [chrome Ga tile](../site/hero-metal.js) melts in place. Its frame catches reflected light as it settles and turns with the pointer. The [hero still](../site/media/gallium-chrome.webp) is a render of the same model.
- [Cover source](../site/og-card.svg) renders the [README and social card](../site/og-card.png).
- [Site styles](../site/styles.css) define the palette and type.
- [Render script](../scripts/render-hero.py) reproduces the local fallback loop using librsvg and FFmpeg.

Animate the hero while it is visible. Keep a pause and replay control and use the still for reduced motion or unavailable WebGL.

The periodic table uses the hero’s graphite and silver material. It pivots as it enters view, highlights the selected row, and lifts the chosen tile. The label below the table shows the element’s position. The picker and arrow-key navigation offer the same selection. Reduced motion presents a flat table with a static highlight.

Use signal cyan to follow task steps and execution routes. Keep those sequences short, and leave setup instructions and results readable at rest.
