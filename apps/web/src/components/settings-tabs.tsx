'use client';

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';

export type SettingsTabId = 'social' | 'google' | 'orders';

type SettingsTab = {
  id: SettingsTabId;
  label: string;
  description: string;
  content: ReactNode;
};

export function SettingsTabs({ initialTab = 'social', tabs }: { initialTab?: SettingsTabId; tabs: SettingsTab[] }) {
  const available = tabs.some((tab) => tab.id === initialTab) ? initialTab : tabs[0]?.id ?? 'social';
  const [activeTab, setActiveTab] = useState<SettingsTabId>(available);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const legacyHash = window.location.hash.slice(1) as SettingsTabId;
    if (tabs.some((tab) => tab.id === legacyHash)) setActiveTab(legacyHash);
  }, [tabs]);

  function selectTab(id: SettingsTabId) {
    setActiveTab(id);
    window.history.replaceState(null, '', `/settings?tab=${id}`);
  }

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    selectTab(next.id);
    tabRefs.current[nextIndex]?.focus();
  }

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  if (!active) return null;

  return <>
    <div className="settings-tabs" role="tablist" aria-label="Розділи налаштувань">
      {tabs.map((tab, index) => <button
        key={tab.id}
        ref={(node) => { tabRefs.current[index] = node; }}
        id={`settings-tab-${tab.id}`}
        className="settings-tab"
        type="button"
        role="tab"
        aria-controls={`settings-panel-${tab.id}`}
        aria-selected={active.id === tab.id}
        tabIndex={active.id === tab.id ? 0 : -1}
        onClick={() => selectTab(tab.id)}
        onKeyDown={(event) => handleKeys(event, index)}
      >
        <span>{tab.label}</span>
        <small>{tab.description}</small>
      </button>)}
    </div>
    <div
      id={`settings-panel-${active.id}`}
      className="settings-tab-panel"
      role="tabpanel"
      aria-labelledby={`settings-tab-${active.id}`}
    >{active.content}</div>
  </>;
}
