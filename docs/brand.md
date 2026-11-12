# Gallium visual identity

The logo is a transparent square outline containing Ga and atomic number 31. Use the same monochrome tile at small sizes and reverse it on dark surfaces. Arial Bold sets Ga, with regular Arial for 31. The frame has sharp 90-degree corners.

| Role | Color | Use |
| --- | --- | --- |
| Graphite | `#11181c` | Hero and workflow backgrounds |
| Paper | `#f6f7f5` | Reading surfaces |
| Ink | `#172126` | Text on light surfaces |
| Platinum | `#e4e9e9` | Supporting panels and tiles |
| Signal cyan | `#a6f0ed` | Primary action, focus on dark surfaces, and selected element highlights |

Use the system sans stack for reading and headings. Reserve monospace for commands and element data. Keep metallic reflections inside the artwork so copy and controls sit on solid surfaces.

- [Monochrome mark](../site/mark.svg) works on light or dark backgrounds with a single color.
- [Hero still](../site/media/gallium-rest.webp) matches the opening frame. The full melt ends in a liquid pool, then a [reflective WebGL tile](../site/hero-metal.js) rises from it.
- [Cover source](../site/og-card.svg) renders the [README and social card](../site/og-card.png).
- [Site styles](../site/styles.css) define the palette and type.
- [Render script](../scripts/render-hero.py) reproduces the local fallback loop using librsvg and FFmpeg.

Play the hero video while it is visible. Keep a pause and replay control and use the still for reduced motion.

The periodic table uses the hero’s graphite and silver material. It pivots as it enters view, reflects a soft pointer light, and lifts the selected tile. The label below the table shows the element’s position. The picker and arrow-key navigation offer the same selection. Reduced motion presents a flat table with a static highlight.

Use signal cyan to follow task steps and execution routes. Keep those sequences short, and leave setup instructions and results readable at rest.
