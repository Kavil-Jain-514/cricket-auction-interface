"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** A header link marked aria-current on its own page. */
export function NavLink({ href, className, activeClassName, children }: {
  href: string;
  className: string;
  activeClassName: string;
  children: React.ReactNode;
}) {
  const active = usePathname() === href;
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active && activeClassName)}>
      {children}
    </Link>
  );
}
