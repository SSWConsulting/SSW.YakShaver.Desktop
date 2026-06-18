import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { nextRovingIndex } from "./settings-nav-keys";

export interface SettingsNavTab {
  id: string;
  label: string;
}

interface SettingsNavProps {
  tabs: SettingsNavTab[];
  activeTabId: string;
  /** Stable id of the panel region these tabs control (for aria-controls). */
  panelId?: string;
  onSelect: (tabId: string) => void;
}

/**
 * Keyboard-accessible Settings options list.
 *
 * Fixes #803:
 *  - `min-h-0` lets the nav shrink inside its flex row so `overflow-y-auto`
 *    actually engages and every tab (e.g. "Account") stays reachable instead of
 *    overflowing and being clipped.
 *  - Roving-tabindex + Up/Down/Home/End arrow navigation (the list previously
 *    had no arrow-key handling). Activation stays on Enter/Space (native button
 *    behaviour) so arrowing through tabs never triggers the unsaved-changes
 *    leave handler — only an explicit selection does.
 */
export function SettingsNav({ tabs, activeTabId, panelId, onSelect }: SettingsNavProps) {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeTabId),
  );
  const [focusIndex, setFocusIndex] = useState(activeIndex);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  // Keep the roving-tabindex target aligned with the active tab when it changes
  // externally (click, programmatic open-settings-tab, or leave handler).
  useEffect(() => {
    setFocusIndex(activeIndex);
  }, [activeIndex]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const next = nextRovingIndex(event.key, focusIndex, tabs.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    setFocusIndex(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div
      aria-label="Settings sections"
      role="tablist"
      aria-orientation="vertical"
      onKeyDown={handleKeyDown}
      className="w-48 flex flex-col gap-1 flex-shrink-0 overflow-y-auto pr-1 min-h-0"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            ref={(el: HTMLButtonElement | null) => {
              buttonsRef.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={`text-left px-3 py-2.5 rounded-md transition-colors border border-transparent ${
              isActive
                ? "bg-white/10 border-white/20 text-white"
                : "text-white/80 hover:bg-white/5 hover:text-white"
            }`}
          >
            <div className="text-sm font-medium">{tab.label}</div>
          </button>
        );
      })}
    </div>
  );
}
