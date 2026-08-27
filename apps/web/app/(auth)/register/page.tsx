'use client';

import { register } from '../../../src/auth/auth-api';
import { RegisterForm } from '../../../src/components/auth-form';

export default function RegisterPage() { return <RegisterForm submit={register} />; }
