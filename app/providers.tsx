'use client';
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode } from "react";
import { Toaster } from "sonner";


const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL! as string);

function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        elements: {
          formButtonPrimary:
            "bg-purple-600 hover:bg-purple-700 text-white",
          card: "shadow-lg",
          headerTitle: "text-gray-900",
          headerSubtitle: "text-gray-600",
          socialButtonsBlockButton:
            "border-gray-300 hover:bg-gray-50",
          formFieldInput:
            "border-gray-300 focus:border-purple-500 focus:ring-purple-500",
          footerActionLink: "text-purple-600 hover:text-purple-700",
        },
      }}
    >
      <ConvexClientProvider>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "white",
              border: "1px solid #e5e7eb",
            },
            classNames: {
              success: "border-green-500",
              error: "border-red-500",
            },
          }}
        />
      </ConvexClientProvider>
    </ClerkProvider>
  );
}