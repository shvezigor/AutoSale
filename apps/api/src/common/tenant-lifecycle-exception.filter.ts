import { TenantLifecycleFrozenError } from '@autosale/database';
import { metrics } from '@autosale/observability';
import { ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';

@Catch(TenantLifecycleFrozenError)
export class TenantLifecycleExceptionFilter implements ExceptionFilter {
  catch(exception: TenantLifecycleFrozenError, host: ArgumentsHost): void {
    metrics.increment('autosale_tenant_lifecycle_freeze_rejections_total', {
      surface: exception.surface,
      safe_reason: 'lifecycle_frozen',
    });
    host.switchToHttp().getResponse().status(409).json({
      statusCode: 409,
      code: exception.code,
      message: exception.code,
    });
  }
}
