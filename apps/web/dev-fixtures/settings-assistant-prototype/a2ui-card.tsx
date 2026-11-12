import { useEffect, useRef, useState } from 'react';
import { A2uiSurface, createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react';
import { Catalog, MessageProcessor } from '@a2ui/web_core';
import { CommonSchemas } from '@a2ui/web_core/v1_0';
import { z } from 'zod';
import { LoadingButton } from '../../src/components/loading-button';
import type { View } from './model';

// Narrow, product-owned catalog. No HTML, URLs, HTTP tool or arbitrary component.
const Section = createComponentImplementation({ name: 'Section', schema: z.object({ children: CommonSchemas.ChildList }) }, ({ props, buildChild }) => <div className="proposal">{props.children.map(child => typeof child === 'string' ? buildChild(child) : buildChild(child.id, child.basePath))}</div>);
const Heading = createComponentImplementation({ name: 'Heading', schema: z.object({ text: CommonSchemas.DynamicString }) }, ({ props }) => <h3>{props.text}</h3>);
const Change = createComponentImplementation({ name: 'Change', schema: z.object({ before: CommonSchemas.DynamicString, after: CommonSchemas.DynamicString }) }, ({ props }) => <div className="change"><div><small>Зараз</small><strong>{props.before}</strong></div><span aria-hidden="true">→</span><div><small>Після підтвердження</small><strong>{props.after}</strong></div></div>);
const Note = createComponentImplementation({ name: 'Note', schema: z.object({ text: CommonSchemas.DynamicString }) }, ({ props }) => <p>{props.text}</p>);
const Actions = createComponentImplementation({ name: 'Actions', schema: z.object({ pending: CommonSchemas.DynamicBoolean, disabled: CommonSchemas.DynamicBoolean, confirm: CommonSchemas.Action, cancel: CommonSchemas.Action }) }, ({ props }) => <div className="actions"><LoadingButton type="button" pending={props.pending} pendingLabel="Застосовуємо…" disabled={props.disabled} onClick={() => void props.confirm()}>Підтвердити зміну</LoadingButton><button type="button" className="secondary-button" disabled={props.pending} onClick={() => void props.cancel()}>Скасувати</button></div>);
const catalog = new Catalog('https://sales-aito.invalid/prototype/settings-v1.json', '1.0', [Section, Heading, Change, Note, Actions], []);
export const messages = [
  { version: '1.0' as const, createSurface: { surfaceId: 'settings', catalogId: catalog.id } },
  { version: '1.0' as const, updateComponents: { surfaceId: 'settings', components: [
    { id: 'root', component: 'Section', children: ['title', 'change', 'note', 'actions'] },
    { id: 'title', component: 'Heading', text: { '@path': '/title' } },
    { id: 'change', component: 'Change', before: { '@path': '/before' }, after: { '@path': '/after' } },
    { id: 'note', component: 'Note', text: { '@path': '/note' } },
    { id: 'actions', component: 'Actions', pending: { '@path': '/pending' }, disabled: { '@path': '/disabled' }, confirm: { event: { name: 'confirm' } }, cancel: { event: { name: 'cancel' } } },
  ] } },
];
export default function A2uiCard({ view, confirm, cancel }: { view: View; confirm: () => void; cancel: () => void }) {
  const handlers = useRef({ confirm, cancel });
  handlers.current = { confirm, cancel };
  const [processor] = useState(() => {
    const p = new MessageProcessor<ReactCatalogComponent>([catalog], action => {
      if (action.name === 'confirm') handlers.current.confirm();
      if (action.name === 'cancel') handlers.current.cancel();
    });
    p.processMessages(messages);
    p.processMessages({ version: '1.0', updateDataModel: { surfaceId: 'settings', path: '/', value: view } });
    return p;
  });
  useEffect(() => { processor.processMessages({ version: '1.0', updateDataModel: { surfaceId: 'settings', path: '/', value: view } }); }, [processor, view]);
  useEffect(() => () => processor.dispose(), [processor]);
  return <><A2uiSurface surface={processor.model.surfacesMap.get('settings')!} /><details className="protocol"><summary>Повідомлення A2UI 1.0</summary><pre>{JSON.stringify([...messages, { version: '1.0', updateDataModel: { surfaceId: 'settings', path: '/', value: view } }], null, 2)}</pre></details></>;
}
