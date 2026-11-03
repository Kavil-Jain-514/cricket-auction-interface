import { Providers } from "../providers";

// Every signed-in or live route: Clerk, Convex and the single Toaster.
// Kept out of the root layout so app/(marketing) stays static and light.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
