import { RouteSkeleton } from '../../../src/components/route-skeleton';

export default function LoadingConversations() {
  return <div className="conversation-detail-transition conversation-detail-loading">
    <RouteSkeleton variant="conversation" />
  </div>;
}
