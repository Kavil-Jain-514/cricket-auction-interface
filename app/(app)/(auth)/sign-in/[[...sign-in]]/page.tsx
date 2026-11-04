import { SignIn } from "@clerk/nextjs";
import { BackToHomeLink } from "@/components/layout/BackToHomeLink";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col items-center justify-center gap-3 p-4">
      <BackToHomeLink />
      <SignIn 
        appearance={{
          elements: {
            rootBox: "mx-auto",
            card: "bg-slate-900 border border-slate-800",
          }
        }}
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        redirectUrl="/dashboard"
      />
    </div>
  );
}