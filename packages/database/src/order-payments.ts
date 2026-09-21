export interface PaymentAmountRow {
  amount: string;
  cancelledAt: Date | null;
}

export interface PaymentAmounts {
  expectedAmount: string;
  paidAmount: string;
  remainingAmount: string;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';
}

const MONEY_PATTERN = /^(0|[1-9]\d*)\.\d{2}$/;

export function calculateOrderPaymentSummary(expectedAmount: string, payments: readonly PaymentAmountRow[]): PaymentAmounts {
  const expected = toMinorUnits(expectedAmount);
  const paid = payments
    .filter((payment) => payment.cancelledAt === null)
    .reduce((sum, payment) => sum + toMinorUnits(payment.amount), 0n);
  return {
    expectedAmount: fromMinorUnits(expected),
    paidAmount: fromMinorUnits(paid),
    remainingAmount: fromMinorUnits(expected - paid),
    status: paid === 0n ? 'UNPAID' : paid < expected ? 'PARTIALLY_PAID' : paid === expected ? 'PAID' : 'OVERPAID',
  };
}

function toMinorUnits(value: string): bigint {
  if (!MONEY_PATTERN.test(value)) throw new Error('Money must use canonical two-decimal format');
  return BigInt(value.replace('.', ''));
}

function fromMinorUnits(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
