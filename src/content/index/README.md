# ItemTraxx Index articles

Create one Markdown file for each piece in this folder. The filename becomes the displayed title; its lowercase, hyphenated form becomes `/index/<slug>`.

```md
---
category: Security
format: Article
date: 2026-11-12
cover: sage
draft: true
---
```

Allowed categories: `Company`, `Product`, `Guides`, `Security`, and `Updates`. Allowed formats: `Article`, `Guide`, `Disclosure`, and `Update`. The optional `cover` field selects a muted flat color: `stone`, `sage`, `clay`, `sand`, `slate`, or `mauve`. If omitted, the category chooses a matching default. Cover color and subtle grain appear on the Index listing only; article pages do not repeat the artwork.

The filename supplies the title, so keep it short. You can leave the body empty while planning an article. `draft: true` keeps it hidden in every environment; change it to `draft: false` when it is ready to publish. `summary` and `cover` are optional.

An optional `image: /path/to/image.webp` field can be added if a real cover is useful later. Without one, the Index uses a solid-color cover. Keep titles short and avoid using `About` as an article title because `/index/about` is reserved for the Index About page.

