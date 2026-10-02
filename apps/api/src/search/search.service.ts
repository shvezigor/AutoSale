import type {
  ManagerOrder,
  WorkspaceSearchCustomer,
  WorkspaceSearchQuery,
  WorkspaceSearchResponse,
} from '@autosale/contracts';

import type { CatalogueService } from '../catalogue/catalogue.service.js';
import type { OrdersService } from '../orders/orders.service.js';

export class SearchService {
  constructor(
    private readonly orders: Pick<OrdersService, 'list'>,
    private readonly catalogue: Pick<CatalogueService, 'list'>,
  ) {}

  async search(tenantId: string, query: WorkspaceSearchQuery): Promise<WorkspaceSearchResponse> {
    const [orders, products] = await Promise.all([
      this.orders.list(tenantId, {
        search: query.q,
        page: 1,
        pageSize: query.limit,
        sort: 'date',
        direction: 'desc',
      }),
      this.catalogue.list(tenantId, {
        search: query.q,
        page: 1,
        pageSize: query.limit,
        sort: 'name',
        direction: 'asc',
      }),
    ]);

    const customers = new Map<string, WorkspaceSearchCustomer>();
    for (const order of orders.items) {
      const customer = customerResult(order);
      if (customer && !customers.has(customer.key)) customers.set(customer.key, customer);
    }

    return {
      query: query.q,
      customers: [...customers.values()].slice(0, query.limit),
      orders: orders.items.slice(0, query.limit).map((order) => ({
        id: order.id,
        publicNumber: order.publicNumber,
        customerName: clean(order.customer.name),
        productSummary: clean(order.items[0]?.productName) ?? clean(order.items[0]?.originalText),
        status: order.status,
        href: `/orders/${order.id}`,
      })),
      products: products.items
        .filter((product) => Boolean(product.id))
        .slice(0, query.limit)
        .map((product) => ({
          id: product.id!,
          sku: product.sku,
          name: product.name,
          price: product.price ?? null,
          currency: product.currency ?? null,
          stockQuantity: product.stockQuantity ?? null,
          href: filteredHref('/catalogue', product.sku),
        })),
    };
  }
}

function customerResult(order: ManagerOrder): WorkspaceSearchCustomer | null {
  const phone = clean(order.customer.phone);
  const username = clean(order.customer.instagramUsername)?.replace(/^@/, '');
  const name = clean(order.customer.name);
  if (phone) {
    return { key: `phone:${phone}`, name: name ?? (username ? `@${username}` : phone), context: phone, href: filteredHref('/orders', phone) };
  }
  if (username) {
    const normalizedUsername = username.toLocaleLowerCase('uk-UA');
    return { key: `instagram:${normalizedUsername}`, name: name ?? `@${username}`, context: name ? `@${username}` : 'Instagram', href: filteredHref('/orders', `@${username}`) };
  }
  if (name) {
    return { key: `name:${name.toLocaleLowerCase('uk-UA')}`, name, context: null, href: filteredHref('/orders', name) };
  }
  return null;
}

function filteredHref(path: string, search: string): string {
  return `${path}?${new URLSearchParams({ search }).toString()}`;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
