# ItemTraxx Index articles

Create one Markdown file for each piece in this folder. By default, the filename becomes the displayed title and its lowercase, hyphenated form becomes `/index/<slug>`. Use optional `title` and `slug` fields when a short filename or a specific URL is preferred.

```md
---
title: How We Secure ItemTraxx
slug: how-we-secure-itemtraxx
category: Security
format: Article
date: 2026-11-13
cover: sage
draft: false
---
```

Allowed categories: `Company`, `Product`, `Guides`, `Security`, and `Updates`. Allowed formats: `Article`, `Guide`, `Disclosure`, and `Update`. Set the date shown on the article and its listing order with `date: YYYY-MM-DD`. The optional `cover` field selects a muted color: `stone`, `sage`, `clay`, `sand`, `slate`, or `mauve`. If omitted, the category chooses a matching default. Generated covers appear on the Index listing and in social previews; article pages do not repeat the artwork.

`title` is optional; when supplied it overrides the filename as the displayed title. `slug` is optional; when supplied it determines the `/index/<slug>` URL. You can leave the body empty while planning an article. `draft: true` keeps it hidden on public hosts and visible only on localhost; change it to `draft: false` when it is ready to publish. `summary` and `cover` are optional.

An optional `image: /path/to/image.webp` field can be added if a real cover is useful later. Without one, the Index uses a solid-color cover. Keep titles short and avoid using `About` as an article title because `/index/about` is reserved for the Index About page.

Published articles automatically get a social sharing image at build time, using their title, a darker version of their cover color, subtle texture, and the locally installed Inter font. No image file or external font service is needed.

