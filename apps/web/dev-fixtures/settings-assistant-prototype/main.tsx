import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { FormField } from '../../src/components/form-field';
import { LoadingButton } from '../../src/components/loading-button';
import { clearFieldError, focusFirstInvalid } from '../../src/components/form-validation';
import { ReactCard } from './react-card';
import { errors, isUnchanged, prompts, proposal, type Scenario, type Settings, type Variant } from './model';
import '../../app/globals.css';
import './style.css';

const A2uiCard = lazy(() => import('./a2ui-card'));
type Environment = 'success' | 'forbidden' | 'conflict' | 'outage';
function Experiment({ variant, request, environment, onBusy }: { variant: Variant; request: { scenario: Scenario; sequence: number } | null; environment: Environment; onBusy: (variant: Variant, pending: boolean) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => { onBusy(variant, pending); }, [variant, pending, onBusy]);
  async function load() {
    try { const r = await fetch(`/__prototype/${variant}`); if (!r.ok) throw new Error(); setSettings(await r.json()); setError(''); }
    catch { setError('Не вдалося завантажити тестові налаштування. Оновіть сторінку.'); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setActive(Boolean(request)); setError(''); setNotice(''); }, [request]);
  async function confirm() {
    if (!request || !settings || lock.current || isUnchanged(request.scenario, settings)) return;
    lock.current = true; setPending(true); setError(''); setNotice('');
    try {
      const r = await fetch(`/__prototype/${variant}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: request.scenario, revision: settings.revision, environment }) });
      if (!r.ok) { setError(errors[r.status] ?? 'Не вдалося застосувати зміну. Спробуйте ще раз.'); return; }
      setSettings(await r.json()); setActive(false); setNotice('Зміну збережено в локальному прототипі.');
    } catch { setError('Немає зв’язку з локальним прототипом. Спробуйте ще раз.'); }
    finally { setPending(false); lock.current = false; }
  }
  async function reset() {
    if (lock.current) return;
    lock.current = true; setPending(true);
    try {
      const r = await fetch(`/__prototype/${variant}/reset`, { method: 'POST', body: '{}' });
      if (!r.ok) throw new Error();
      setSettings(await r.json()); setActive(false); setError(''); setNotice('Тестові дані скинуто.');
    } catch { setError('Не вдалося скинути тестові дані.'); }
    finally { setPending(false); lock.current = false; }
  }
  const cancel = () => { if (lock.current) return; setActive(false); setError(''); setNotice('Пропозицію скасовано. Налаштування без змін.'); };
  const view = request && settings ? { ...proposal(request.scenario, settings), pending, disabled: pending || isUnchanged(request.scenario, settings) } : null;
  return <section className="experiment settings-card" aria-label={variant === 'react' ? 'React-картка' : 'A2UI-картка'}>
    <header className="experiment-heading"><div><span className="eyebrow">{variant === 'react' ? 'A · ЯВНИЙ JSX' : 'B · ПРОТОКОЛ 1.0'}</span><h2>{variant === 'react' ? 'React-картка' : 'A2UI-картка'}</h2></div><span className="tech">{variant === 'react' ? 'React 19' : 'SDK 0.15.0'}</span></header>
    <p className="muted">{variant === 'react' ? 'Заздалегідь написана структура картки.' : 'Структура з JSON → офіційний renderer → наші компоненти.'}</p>
    {!settings && <p role="status">Завантажуємо тестові налаштування…</p>}
    {settings && <>
      <div className="snapshot"><span>Поточні тестові налаштування</span><dl><div><dt>Погодження</dt><dd>{settings.approvalMode === 'ALWAYS' ? 'Підтвердження менеджером' : 'Без підтвердження'}</dd></div><div><dt>Розпізнавання</dt><dd>AI пропонує замовлення</dd></div></dl></div>
      {active && view ? <Suspense fallback={<p role="status">Завантажуємо картку A2UI…</p>}>{variant === 'react' ? <ReactCard view={view} confirm={() => void confirm()} cancel={cancel} /> : <A2uiCard view={view} confirm={() => void confirm()} cancel={cancel} />}</Suspense> : <div className="empty"><span aria-hidden="true">✦</span><p>Оберіть приклад або напишіть запит.<br/>Тут з’явиться пропозиція для підтвердження.</p></div>}
      <div aria-live="polite">{notice && <p className="save-success">{notice}</p>}{error && <p role="alert" className="save-error">{error}</p>}</div>
      <div className="experiment-footer"><LoadingButton type="button" className="text-button" disabled={pending} onClick={() => void load()}>Оновити дані</LoadingButton><LoadingButton type="button" className="text-button" pending={pending && !active} pendingLabel="Скидаємо…" disabled={pending} onClick={() => void reset()}>Скинути приклад</LoadingButton></div>
      <details className="protocol"><summary>Стан прототипу</summary><pre>{JSON.stringify({ settings, scenario: request?.scenario ?? null, active, pending, environment }, null, 2)}</pre></details>
    </>}
  </section>;
}
function App() {
  const [text, setText] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ prompt?: string }>({});
  const [request, setRequest] = useState<{ scenario: Scenario; sequence: number } | null>(null);
  const [environment, setEnvironment] = useState<Environment>('success');
  const [variant, setVariant] = useState(new URLSearchParams(location.search).get('variant') ?? 'both');
  const [busyState, setBusyState] = useState({ react: false, a2ui: false });
  const busy = busyState.react || busyState.a2ui;
  const onBusy = useCallback((key: Variant, pending: boolean) => setBusyState(previous => ({ ...previous, [key]: pending })), []);
  function choose(scenario: Scenario) { setText(prompts[scenario]); setFieldErrors({}); setRequest(previous => ({ scenario, sequence: (previous?.sequence ?? 0) + 1 })); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = text.trim().toLowerCase();
    if (!normalized) { setFieldErrors({ prompt: 'Напишіть, що ви хочете змінити.' }); focusFirstInvalid(event.currentTarget, ['prompt']); return; }
    const scenario = /перевір|кожн|підтверд/.test(normalized) ? 'review' : /пропон/.test(normalized) ? 'suggestion' : null;
    if (!scenario) { setFieldErrors({ prompt: 'У прототипі доступні два приклади нижче. Спробуйте один із них.' }); focusFirstInvalid(event.currentTarget, ['prompt']); return; }
    setFieldErrors({}); setRequest(previous => ({ scenario, sequence: (previous?.sequence ?? 0) + 1 }));
  }
  function switchVariant(value: string) { setVariant(value); const url = new URL(location.href); url.searchParams.set('variant', value); history.replaceState(null, '', url); }
  return <div className="prototype-shell"><aside className="prototype-sidebar"><div className="brand">sales<span>aito</span><b>LAB</b></div><div className="workspace-name">Демо-компанія</div><p>Робочий простір</p><span>Огляд</span><span>Діалоги</span><span>Замовлення</span><span>Каталог</span><strong>Налаштування</strong><small>Локальний прототип<br/>Вигадані дані</small></aside>
    <main className="prototype-main"><header className="page-heading"><div><p className="eyebrow">НАЛАШТУВАННЯ / ДОСЛІДЖЕННЯ ІНТЕРФЕЙСУ</p><h1>Помічник, який показує дію</h1><p>Один запит. Два способи показати ту саму пропозицію.</p></div><span className="prototype-badge">ПРОТОТИП</span></header>
      <div className="scope-note">Відповіді заготовлені, AI-модель не підключена. Зміни зберігаються лише в пам’яті локального сервера до його перезапуску.</div>
      <section className="prompt-panel settings-card" aria-label="Запит помічнику"><fieldset className="prompt-controls" disabled={busy}><legend className="sr-only">Запит і сценарії прототипу</legend><form noValidate onSubmit={submit}><FormField id="prompt" label="Що змінити в налаштуваннях?" error={fieldErrors.prompt}><input name="prompt" placeholder="Наприклад: хочу перевіряти кожне замовлення" value={text} onChange={e => { setText(e.target.value); setFieldErrors(previous => clearFieldError(previous, 'prompt')); }} /></FormField><button className="primary-button" type="submit">Показати пропозицію</button></form><div className="examples"><span>Спробуйте:</span><button className="secondary-button" type="button" onClick={() => choose('review')}>Перевіряти кожне замовлення</button><button className="secondary-button" type="button" onClick={() => choose('suggestion')}>AI лише пропонує</button></div><div className="scenario-control"><label htmlFor="environment">Сценарій підтвердження</label><select id="environment" value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="success">Успішне збереження</option><option value="forbidden">Немає прав власника · 403</option><option value="conflict">Конфлікт налаштувань · 409</option><option value="outage">Сервіс недоступний · 503</option></select></div></fieldset></section>
      <div className="experiments" data-variant={variant} aria-busy={busy || undefined}>{['react', 'a2ui'].map(key => <div key={key} hidden={variant !== 'both' && variant !== key}><Experiment variant={key as Variant} request={request} environment={environment} onBusy={onBusy} /></div>)}</div>
      <p className="comparison-note">Однакові кнопки, текст і локальний API. Відмінність — у способі побудови картки. Підтвердження кожного варіанта незалежне.</p>
    </main><nav className="variant-switcher" aria-label="Варіанти прототипу">{[['both', 'Поруч'], ['react', 'A · React'], ['a2ui', 'B · A2UI']].map(([value, label]) => <button type="button" className={variant === value ? 'primary-button' : 'secondary-button'} aria-pressed={variant === value} key={value} onClick={() => switchVariant(value)}>{label}</button>)}</nav>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
