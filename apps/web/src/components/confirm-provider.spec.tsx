import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmProvider, useConfirm } from './confirm-provider';

afterEach(cleanup);

function Harness({ action }: { action: () => void }) {
  const confirm = useConfirm();
  return <button type="button" onClick={() => void confirm({ title: 'Очистити всі товари?', description: 'Цю дію неможливо скасувати.', confirmLabel: 'Так, очистити', tone: 'danger' }).then((approved) => approved && action())}>Очистити</button>;
}

describe('ConfirmProvider', () => {
  it('traps focus, cancels with Escape, and restores focus without deleting', async () => {
    const action = vi.fn();
    render(<ConfirmProvider><Harness action={action} /></ConfirmProvider>);
    const trigger = screen.getByRole('button', { name: 'Очистити' });
    trigger.focus();
    fireEvent.click(trigger);
    const cancel = screen.getByRole('button', { name: 'Скасувати' });
    const approve = screen.getByRole('button', { name: 'Так, очистити' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(approve).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(action).not.toHaveBeenCalled();
  });

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
