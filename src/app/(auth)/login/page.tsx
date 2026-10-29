import { Suspense } from "react";
import AuthForm, { AuthFormSkeleton } from "@/components/AuthForm";
import AuthShell from "@/components/AuthShell";

export const metadata = {
  title: "Log in — SPARKServ",
  description: "Log in to track a repair, review an estimate, or manage your bookings.",
};

export default function LoginPage() {
  return (
    <AuthShell
      headline="Good to see you again."
      subhead="Log back in to track a repair, review an estimate, or pick up where you left off."
    >
      {/* `AuthForm` reads `?redirectTo=` with `useSearchParams()`, which requires
          a Suspense boundary on a statically-rendered route. The root layout's
          former `force-dynamic` made every page dynamic and hid the requirement;
          without it this boundary is what keeps /login prerenderable. */}
      <Suspense fallback={<AuthFormSkeleton />}>
        <AuthForm mode="login" />
      </Suspense>
    </AuthShell>
  );
}
