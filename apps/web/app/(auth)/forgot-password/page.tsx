'use client';

import { authRequest } from '../../../src/auth/auth-api';
import { ForgotPasswordForm } from '../../../src/components/auth-form';

export default function ForgotPasswordPage() { return <ForgotPasswordForm submit={(input) => authRequest('forgot-password', input)} />; }
