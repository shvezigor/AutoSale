import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ActivityProvider, useActivity } from './activity-provider';

let resolveFirst: (() => void) | undefined;
let resolveSecond: (() => void) | undefined;
function Harness() {
  const activity = useActivity();
  return <><button onClick={() => void activity.run('Перша операція', () => new Promise<void>((resolve) => { resolveFirst = resolve; }))}>First</button><button onClick={() => void activity.run('Друга операція', () => new Promise<void>((resolve) => { resolveSecond = resolve; }))}>Second</button></>;
}

afterEach(cleanup);

describe('ActivityProvider', () => {
  it('stays busy until every parallel operation settles', async () => {
    render(<ActivityProvider><Harness /></ActivityProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '2 активні операції');
    resolveFirst?.();
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 активна операція'));
    resolveSecond?.();
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  });
});
