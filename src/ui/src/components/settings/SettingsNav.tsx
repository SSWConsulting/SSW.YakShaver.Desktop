import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ScrollArea } from "../ui/scroll-area";
import { SettingsNavHealthIndicator } from "./SettingsNavHealthIndicator";
import type { SettingsHealthMap } from "./settings-health";
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
  /** #878 — per-tab critical-configuration state; renders a warning indicator on
   * the affected tab. Optional so callers without health checks stay simple. */
  tabHealth?: SettingsHealthMap;
}

/**
 * Keyboard-accessible Settings options list.
 *
 * Fixes #803:
 *  - `min-h-0` lets the nav shrink inside its flex row so the scroll container
 *    actually engages and every tab (e.g. "Account") stays reachable instead of
 *    overflowing and being clipped.
 *  - Roving-tabindex + Up/Down/Home/End arrow navigation (the list previously
 *    had no arrow-key handling). Activation stays on Enter/Space (native button
 *    behaviour) so arrowing through tabs never triggers the unsaved-changes
 *    leave handler — only an explicit selection does.
 *  - The roving target tracks *actual* focus via `onFocus`, so it stays correct
 *    however focus moved — keyboard, a pointer click, or a click whose tab change
 *    was vetoed by the unsaved-changes guard (where `activeIndex` doesn't change
 *    and the resync effect below wouldn't fire). A later Arrow press then steps
 *    from where the user visibly is, not a stale keyboard position.
 *
 * Fixes #785:
 *  - The list previously scrolled via plain `overflow-y-auto`, which relies on
 *    the OS/browser's native scrollbar. That scrollbar can render with zero
 *    visible width (seen on Linux/GTK themes, and macOS's default
 *    hidden-until-scroll setting), leaving no visual affordance that the list
 *    has more content below the fold even though wheel/trackpad scrolling
 *    mechanically works. Wrapping the tablist in the same `ScrollArea` used by
 *    the settings panel gives it the app's styled, always-visible scrollbar
 *    thumb consistently across OSes, matching AC3/AC4/AC5.
 */
export function SettingsNav({ tabs, activeTabId, panelId, onSelect, tabHealth }: SettingsNavProps) {
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
    <ScrollArea type="auto" className="w-48 h-full flex-shrink-0 min-h-0">
      <div
        aria-label="Settings sections"
        role="tablist"
        aria-orientation="vertical"
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-1 pr-3"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const health = tabHealth?.[tab.id];
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
              onFocus={() => setFocusIndex(index)}
              onClick={() => onSelect(tab.id)}
              className={`group relative flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-md transition-colors border border-transparent ${
                isActive
                  ? "bg-white/10 border-white/20 text-white"
                  : "text-white/80 hover:bg-white/5 hover:text-white"
              }`}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              {health ? <SettingsNavHealthIndicator health={health} /> : null}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
