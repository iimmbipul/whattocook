import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Header from '@/components/Header';
import DashboardContent from '@/components/DashboardContent';

export default async function Home() {
  // Note: For server-side auth check, we'll rely on client-side redirect
  // as Firebase auth is primarily client-side

  return <DashboardContent />;
}
