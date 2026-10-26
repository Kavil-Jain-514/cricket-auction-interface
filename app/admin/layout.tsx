"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldAlert, Users, ScrollText } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { useUserRole } from '@/hooks/useUserRole';

const TABS = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

/**
 * Back office shell. proxy.ts requires sign-in; this gate shows everyone who
 * isn't an admin a 403. Every query and mutation behind it re-checks on the
 * server, so the gate is a convenience, not the protection.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useUserRole();
  const pathname = usePathname();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" aria-label="Loading" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <main className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
          <ShieldAlert className="w-12 h-12 text-red-400" />
          <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">403</p>
          <h1 className="text-2xl font-bold">Admins only</h1>
          <p className="max-w-sm text-slate-400">Your account doesn&apos;t have access to the back office. Ask an admin to promote you.</p>
          <Link href="/dashboard" className="mt-2 text-blue-400 hover:underline">Back to dashboard</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Navbar />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-4">Back office</h1>
        <nav className="mb-6 flex gap-1 border-b border-slate-800" aria-label="Back office">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${active ? 'border-blue-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </div>
  );
}
