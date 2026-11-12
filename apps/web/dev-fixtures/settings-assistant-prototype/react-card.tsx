import { LoadingButton } from '../../src/components/loading-button';
import type { View } from './model';

export function ReactCard({ view, confirm, cancel }: { view: View; confirm: () => void; cancel: () => void }) {
  return <div className="proposal">
    <h3>{view.title}</h3>
    <div className="change"><div><small>Зараз</small><strong>{view.before}</strong></div><span aria-hidden="true">→</span><div><small>Після підтвердження</small><strong>{view.after}</strong></div></div>
    <p>{view.note}</p>
    <div className="actions"><LoadingButton type="button" pending={view.pending} pendingLabel="Застосовуємо…" disabled={view.disabled} onClick={confirm}>Підтвердити зміну</LoadingButton><button type="button" className="secondary-button" disabled={view.pending} onClick={cancel}>Скасувати</button></div>
  </div>;
}
