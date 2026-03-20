#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/runbooks/new-developer-onboarding.md"
OUTPUT = ROOT / "output/pdf/new-developer-onboarding.pdf"


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="ITXTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=28,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=14,
    ))
    styles.add(ParagraphStyle(
        name="ITXH1",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=16,
        leading=21,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=12,
        spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="ITXH2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=18,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=10,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="ITXBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10,
        leading=15,
        alignment=TA_LEFT,
        textColor=colors.HexColor("#1f2937"),
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        name="ITXCode",
        parent=styles["Code"],
        fontName="Courier",
        fontSize=8.5,
        leading=11,
        backColor=colors.HexColor("#e5eefc"),
        borderPadding=8,
        borderRadius=4,
        spaceBefore=4,
        spaceAfter=8,
    ))
    return styles


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def flush_list(story, items, ordered, styles):
    if not items:
        return
    if ordered:
        for number, item in items:
            story.append(Paragraph(f"{number}. {esc(item)}", styles["ITXBody"]))
    else:
        for item in items:
            story.append(Paragraph(f"• {esc(item)}", styles["ITXBody"]))
    story.append(Spacer(1, 0.06 * inch))
    items.clear()


def markdown_to_story(text: str, styles):
    story = []
    in_code = False
    code_lines: list[str] = []
    bullet_items: list[str] = []
    ordered_items: list[tuple[str, str]] = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()

        if line.startswith("```"):
            flush_list(story, bullet_items, False, styles)
            flush_list(story, ordered_items, True, styles)
            if in_code:
                story.append(Preformatted("\n".join(code_lines), styles["ITXCode"]))
                code_lines = []
                in_code = False
            else:
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        if not line.strip():
            flush_list(story, bullet_items, False, styles)
            flush_list(story, ordered_items, True, styles)
            story.append(Spacer(1, 0.04 * inch))
            continue

        if line.startswith("# "):
            flush_list(story, bullet_items, False, styles)
            flush_list(story, ordered_items, True, styles)
            story.append(Paragraph(esc(line[2:].strip()), styles["ITXTitle"]))
            continue

        if line.startswith("## "):
            flush_list(story, bullet_items, False, styles)
            flush_list(story, ordered_items, True, styles)
            story.append(Paragraph(esc(line[3:].strip()), styles["ITXH1"]))
            continue

        if line.startswith("### "):
            flush_list(story, bullet_items, False, styles)
            flush_list(story, ordered_items, True, styles)
            story.append(Paragraph(esc(line[4:].strip()), styles["ITXH2"]))
            continue

        if line.startswith("- "):
            flush_list(story, ordered_items, True, styles)
            bullet_items.append(line[2:].strip())
            continue

        ordered_match = re.match(r"^(\d+)\. (.+)$", line)
        if ordered_match:
            flush_list(story, bullet_items, False, styles)
            ordered_items.append((ordered_match.group(1), ordered_match.group(2).strip()))
            continue

        flush_list(story, bullet_items, False, styles)
        flush_list(story, ordered_items, True, styles)
        story.append(Paragraph(esc(line), styles["ITXBody"]))

    flush_list(story, bullet_items, False, styles)
    flush_list(story, ordered_items, True, styles)
    return story


def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.drawRightString(7.25 * inch, 0.55 * inch, f"Page {doc.page}")
    canvas.drawString(0.75 * inch, 0.55 * inch, "ItemTraxx Developer Onboarding")
    canvas.restoreState()


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = build_styles()
    story = markdown_to_story(SOURCE.read_text(), styles)
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=LETTER,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="ItemTraxx New Developer Onboarding",
        author="OpenAI Codex",
    )
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(OUTPUT)


if __name__ == "__main__":
    main()
