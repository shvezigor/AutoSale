import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SocialChannelHub } from './social-channel-hub';

const instagram = {
  status: 'ACTIVE' as const,
  accountId: 'fictional-instagram', username: 'fictional_shop', tokenExpiresAt: null,
  lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE' as const,
  cleanupErrorCode: null, cleanupAbandonEligible: false,
};
const facebook = {
  status: 'NOT_CONNECTED' as const,
  platformAvailability: 'AVAILABLE' as const,
  pageId: null, pageName: null, tokenExpiresAt: null, lastVerifiedAt: null,
  lastErrorCode: null, cleanupStatus: 'NONE' as const, cleanupErrorCode: null,
};
const tiktok = {
  status: 'NOT_CONNECTED' as const,
  platformAvailability: 'AVAILABLE' as const,
  accountId: null, displayName: null, capabilities: null, tokenExpiresAt: null,
  lastVerifiedAt: null, lastErrorCode: null, cleanupStatus: 'NONE' as const,
};

afterEach(cleanup);

describe('SocialChannelHub', () => {
  it('hides channels unavailable to tenants and counts only visible channels', () => {
    render(<SocialChannelHub
      instagram={instagram}
      facebook={{ ...facebook, platformAvailability: 'ADMIN_DISABLED' }}
      tiktok={{ ...tiktok, platformAvailability: 'DEPLOYMENT_UNAVAILABLE' }}
      membershipRole="OWNER"
    />);

    expect(screen.queryByRole('button', { name: /Facebook/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TikTok/ })).not.toBeInTheDocument();
    expect(screen.getByText('1 із 1')).toBeVisible();
  });

  it('keeps both channels collapsed and opens only Facebook on click', () => {
    render(<SocialChannelHub instagram={instagram} facebook={facebook} tiktok={tiktok} membershipRole="OWNER" />);
    const instagramButton = screen.getByRole('button', { name: /Instagram.*Активне/ });
    const facebookButton = screen.getByRole('button', { name: /Facebook.*Не підключено/ });
    const tiktokButton = screen.getByRole('button', { name: /TikTok.*Не підключено/ });

    expect(instagramButton).toHaveAttribute('aria-expanded', 'false');
    expect(facebookButton).toHaveAttribute('aria-expanded', 'false');
    expect(tiktokButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(facebookButton);
    expect(facebookButton).toHaveAttribute('aria-expanded', 'true');
    expect(instagramButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'Facebook' })).toBeVisible();
    expect(screen.getByText('1 із 3')).toBeVisible();
    fireEvent.click(tiktokButton);
    expect(tiktokButton).toHaveAttribute('aria-expanded', 'true');
    expect(facebookButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('region', { name: 'TikTok' })).toBeVisible();
  });
});
