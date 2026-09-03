'use client';

import { useState } from 'react';

export type GooglePickerSelection = { fileId: string; name: string };
export type GooglePickerLauncher = () => Promise<GooglePickerSelection | null>;

export function GooglePickerButton({
  disabled = false,
  onSelected,
  pickerLauncher = openGooglePicker,
}: {
  disabled?: boolean;
  onSelected: (selection: GooglePickerSelection) => void;
  pickerLauncher?: GooglePickerLauncher;
}) {
  const [pending, setPending] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose() {
    setPending(true);
    setError(null);
    try {
      const selection = await pickerLauncher();
      if (selection) {
        setSelectedName(selection.name);
        onSelected(selection);
      }
    } catch {
      setError('Не вдалося відкрити Google Picker');
    } finally {
      setPending(false);
    }
  }

  return <div className="google-picker-control">
    <button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => void choose()}>
      {pending ? 'Відкриваємо Google…' : 'Обрати Google таблицю'}
    </button>
    {selectedName && <span className="save-success">Обрано: {selectedName}</span>}
    {error && <span className="save-error" role="alert">{error}</span>}
  </div>;
}

let pickerScriptPromise: Promise<void> | null = null;

async function openGooglePicker(): Promise<GooglePickerSelection | null> {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!apiKey || !clientId) throw new Error('Google Picker is not configured');

  const tokenResponse = await fetch('/api/integrations/google/access-token', { cache: 'no-store' });
  if (!tokenResponse.ok) throw new Error('Google access token unavailable');
  const tokenBody = await tokenResponse.json() as { accessToken?: unknown };
  if (typeof tokenBody.accessToken !== 'string') throw new Error('Google access token invalid');

  await loadPickerScript();
  return await buildPicker(tokenBody.accessToken, apiKey, clientId.split('-')[0] ?? '');
}

function loadPickerScript(): Promise<void> {
  if (pickerScriptPromise) return pickerScriptPromise;
  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-autosale-google-picker]');
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = 'https://apis.google.com/js/api.js';
      script.async = true;
      script.dataset.autosaleGooglePicker = 'true';
      document.head.appendChild(script);
    }
    const loadModule = () => window.gapi.load('picker', { callback: () => resolve(), onerror: reject });
    if (window.gapi) loadModule();
    else {
      script.addEventListener('load', loadModule, { once: true });
      script.addEventListener('error', reject, { once: true });
    }
  }).catch((error) => {
    pickerScriptPromise = null;
    throw error;
  });
  pickerScriptPromise = promise;
  return promise;
}

function buildPicker(accessToken: string, apiKey: string, appId: string): Promise<GooglePickerSelection | null> {
  return new Promise((resolve) => {
    const view = new window.google.picker.DocsView()
      .setMimeTypes('application/vnd.google-apps.spreadsheet')
      .setSelectFolderEnabled(false);
    const builder = new window.google.picker.PickerBuilder()
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .addView(view)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) {
          const document = data.docs?.[0];
          resolve(document && typeof document.id === 'string'
            ? { fileId: document.id, name: typeof document.name === 'string' ? document.name : 'Google таблиця' }
            : null);
        } else if (data.action === window.google.picker.Action.CANCEL) resolve(null);
      });
    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
}

declare global {
  interface Window {
    gapi: { load: (module: string, options: { callback: () => void; onerror: (error?: unknown) => void }) => void };
    google: {
      picker: {
        Action: { PICKED: string; CANCEL: string };
        DocsView: new () => GooglePickerDocsView;
        PickerBuilder: new () => GooglePickerBuilder;
      };
    };
  }
}

type GooglePickerBuilder = {
  setOAuthToken(value: string): GooglePickerBuilder;
  setDeveloperKey(value: string): GooglePickerBuilder;
  setAppId(value: string): GooglePickerBuilder;
  addView(value: unknown): GooglePickerBuilder;
  setCallback(value: (data: { action?: string; docs?: Array<{ id?: unknown; name?: unknown }> }) => void): GooglePickerBuilder;
  build(): { setVisible(value: boolean): void };
};

type GooglePickerDocsView = {
  setMimeTypes(value: string): GooglePickerDocsView;
  setSelectFolderEnabled(value: boolean): GooglePickerDocsView;
};
