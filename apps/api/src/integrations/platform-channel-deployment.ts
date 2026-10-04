import type { ApiEnv } from '@autosale/config/api-env';
import type { PlatformChannelDeploymentAvailability } from '@autosale/database';

export function platformChannelDeployment(
  env: ApiEnv,
): PlatformChannelDeploymentAvailability {
  return {
    FACEBOOK_MESSENGER: env.FACEBOOK_MESSENGER_ENABLED
      && Boolean(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),
    TIKTOK_BUSINESS_MESSAGING: env.TIKTOK_BUSINESS_MESSAGING_ENABLED
      && Boolean(env.TIKTOK_CLIENT_ID && env.TIKTOK_CLIENT_SECRET && env.TIKTOK_AUTHORIZATION_URL),
  };
}
