'use client';

import { register } from '../../../src/auth/auth-api';
import { RegisterForm } from '../../../src/components/auth-form';
import { useI18n } from '../../../src/i18n/i18n-provider';
import { ConversionPageSignal } from '../../../src/marketing/components/conversion-signal';

export default function RegisterPage() {
  const { locale } = useI18n();
  return <><ConversionPageSignal event="registration_arrival" locale={locale} /><RegisterForm submit={register} /></>;
}
