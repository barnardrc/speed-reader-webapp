from __future__ import annotations

import os
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable, Dict, List, Tuple

import fitz
from bs4 import BeautifulSoup

from .text_utils import normalize_text, process_headers

ProgressCallback = Callable[[int], None]


class ParseError(Exception):
    pass


def parse_book(file_path: str | Path, progress_callback: ProgressCallback | None = None) -> dict:
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        words, chapters, page_map, footnotes = _parse_pdf(path, progress_callback)
    elif suffix == ".epub":
        words, chapters, page_map, footnotes = _parse_epub(path, progress_callback)
    else:
        raise ParseError(f"Unsupported file format: {suffix}")

    if progress_callback:
        progress_callback(100)

    return {
        "words": words,
        "chapters": chapters,
        "page_map": page_map,
        "footnotes": footnotes,
    }


def _parse_pdf(path: Path, progress_callback: ProgressCallback | None) -> tuple[list[str], list[list], dict[int, int], dict[int, str]]:
    words_list: List[str] = []
    chapters: List[List] = []
    footnotes_map: Dict[int, str] = {}
    page_map: Dict[int, int] = {}

    current_word_count = 0

    with fitz.open(path) as doc:
        total_pages = len(doc)

        for i, page in enumerate(doc):
            if progress_callback:
                progress_callback(int((i / max(total_pages, 1)) * 100))

            page_num = i + 1
            page_map[page_num] = current_word_count

            page_dict = page.get_text("dict", flags=0)
            blocks = page_dict.get("blocks", [])
            page_height = page.rect.height

            font_sizes: Dict[float, int] = {}
            for block in blocks:
                if block.get("type") != 0:
                    continue
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        size = round(span.get("size", 0.0), 1)
                        text = span.get("text", "")
                        weight = len(text.strip())
                        if weight > 0:
                            font_sizes[size] = font_sizes.get(size, 0) + weight

            body_size = max(font_sizes, key=font_sizes.get) if font_sizes else 12.0

            main_text_blocks: List[str] = []
            footnote_blocks: List[str] = []

            for block in blocks:
                if block.get("type") != 0:
                    continue

                block_text: List[str] = []
                block_size_sum = 0.0
                char_count = 0

                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span.get("text", "")
                        size = span.get("size", 0.0)
                        block_text.append(text)
                        block_size_sum += size * len(text)
                        char_count += len(text)

                full_block_text = " ".join(block_text).strip()
                if not full_block_text:
                    continue

                avg_size = (block_size_sum / char_count) if char_count > 0 else 0.0
                y_pos = block.get("bbox", [0, 0, 0, 0])[1]

                is_low = y_pos > (page_height * 0.60)
                is_small = avg_size < (body_size - 0.5)
                is_page_num = (y_pos > page_height * 0.93) and (len(full_block_text) < 5)

                if is_page_num:
                    continue
                if is_low and is_small:
                    footnote_blocks.append(full_block_text)
                else:
                    main_text_blocks.append(full_block_text)

            if footnote_blocks:
                footnotes_map[page_num] = "\n\n".join(footnote_blocks)

            full_page_text = normalize_text(" ".join(main_text_blocks))
            processed_words = process_headers(full_page_text.split())
            words_list.extend(processed_words)
            current_word_count += len(processed_words)

        toc = doc.get_toc()
        for item in toc:
            if len(item) < 3:
                continue
            title = item[1]
            page_num = item[2]
            if page_num > 0 and page_num in page_map:
                chapters.append([title, page_map[page_num]])

        if not chapters:
            for page_num, start_index in page_map.items():
                chapters.append([f"Page {page_num}", start_index])

    return words_list, chapters, page_map, footnotes_map


def _parse_epub(path: Path, progress_callback: ProgressCallback | None) -> tuple[list[str], list[list], dict[int, int], dict[int, str]]:
    words_list: List[str] = []
    chapters: List[List] = []
    current_word_count = 0

    with zipfile.ZipFile(path, "r") as archive:
        container_xml = archive.read("META-INF/container.xml")
        container_root = ET.fromstring(container_xml)

        rootfile_path = next(
            node.attrib["full-path"]
            for node in container_root.iter()
            if "full-path" in node.attrib
        )

        opf_data = archive.read(rootfile_path)
        opf_root = ET.fromstring(opf_data)
        opf_dir = os.path.dirname(rootfile_path)

        manifest = {
            item.attrib["id"]: item.attrib["href"]
            for item in opf_root.findall(".//{*}manifest/{*}item")
            if "id" in item.attrib and "href" in item.attrib
        }

        toc_titles: Dict[str, str] = {}
        try:
            spine_node = opf_root.find(".//{*}spine")
            toc_id = spine_node.attrib.get("toc") if spine_node is not None else None
            if toc_id and toc_id in manifest:
                toc_full_path = os.path.join(opf_dir, manifest[toc_id]).replace("\\", "/")
                toc_root = ET.fromstring(archive.read(toc_full_path))
                for nav in toc_root.findall(".//{*}navPoint"):
                    label = nav.find(".//{*}navLabel/{*}text")
                    content = nav.find(".//{*}content")
                    if label is None or content is None:
                        continue
                    src = content.attrib.get("src", "").split("#")[0]
                    if src and label.text:
                        toc_titles[src] = label.text.strip()
        except Exception:
            pass

        spine_ids = [
            item.attrib["idref"]
            for item in opf_root.findall(".//{*}spine/{*}itemref")
            if "idref" in item.attrib
        ]

        total_items = len(spine_ids)
        for i, item_id in enumerate(spine_ids):
            if progress_callback:
                progress_callback(int((i / max(total_items, 1)) * 100))

            rel_path = manifest.get(item_id)
            if not rel_path:
                continue

            full_path = os.path.join(opf_dir, rel_path).replace("\\", "/")
            try:
                soup = BeautifulSoup(archive.read(full_path), "html.parser")
            except KeyError:
                continue

            title = toc_titles.get(rel_path)
            if not title and soup.title and soup.title.string:
                title = soup.title.string.strip()
            if not title:
                heading = soup.find(["h1", "h2", "h3"])
                if heading:
                    title = heading.get_text().strip()[:40]
            if not title:
                title = f"Section {len(chapters) + 1}"

            chapters.append([title, current_word_count])

            raw_text = soup.get_text(separator=" ")
            normalized = normalize_text(raw_text)
            processed_words = process_headers(normalized.split())

            words_list.extend(processed_words)
            current_word_count += len(processed_words)

    words_per_page = 300
    page_map: Dict[int, int] = {}
    page_num = 1
    for idx in range(0, len(words_list), words_per_page):
        page_map[page_num] = idx
        page_num += 1

    return words_list, chapters, page_map, {}
