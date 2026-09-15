import type { FC } from "react";

import type { ChapterEntry } from "../../lib/types";

interface ChapterSidebarProps {
  chapters: ChapterEntry[];
  currentIndex: number;
  onJump: (startIndex: number) => void;
  onClose: () => void;
}

export const ChapterSidebar: FC<ChapterSidebarProps> = ({ chapters, currentIndex, onJump, onClose }) => {
  return (
    <aside className="chapter-sidebar">
      <div className="chapter-sidebar-header">
        <h3>Chapters</h3>
        <button type="button" className="chapter-sidebar-close" onClick={onClose} aria-label="Collapse chapter browser">
          x
        </button>
      </div>
      <ul>
        {chapters.map(([title, start], idx) => {
          const nextStart = idx + 1 < chapters.length ? chapters[idx + 1][1] : Number.MAX_SAFE_INTEGER;
          const active = currentIndex >= start && currentIndex < nextStart;
          return (
            <li key={`${title}-${start}`}>
              <button
                type="button"
                className={active ? "active" : ""}
                onClick={() => onJump(start)}
              >
                {title}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
