import { SignIn } from "@clerk/clerk-react";

export function AuthPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-background">
      <SignIn routing="path" path="/auth" />
    </div>
  );
}
