import DashboardContent from '@/components/DashboardContent';

export default function Home() {
  // Auth is resolved client-side (see AuthProvider); the dashboard redirects
  // to /login when there is no session.
  return <DashboardContent />;
}
