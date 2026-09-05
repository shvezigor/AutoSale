import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider, useConfirm } from './confirm-provider';

afterEach(cleanup);

function Harness({ action }: { action: () => void }) {
  const confirm = useConfirm();
  return <button type="button" onClick={() => void confirm({ title: 'Очистити всі товари?', description: 'Цю дію неможливо скасувати.', confirmLabel: 'Так, очистити', tone: 'danger' }).then((approved) => approved && action())}>Очистити</button>;
}

describe('ConfirmProvider', () => {
  it('resolves a reusable confirmation without requiring typed text', async () => {
    const action = vi.fn();
    render(<ConfirmProvider><Harness action={action} /></ConfirmProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Очистити' }));
    expect(screen.getByRole('dialog', { name: 'Очистити всі товари?' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Так, очистити' }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
  });
});
