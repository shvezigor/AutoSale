import type { ReactNode } from 'react';

export default function WorkspaceTemplate({ children }: { children: ReactNode }) {
  return <div className="workspace-route-transition">{children}</div>;
}
