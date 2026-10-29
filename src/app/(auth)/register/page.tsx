import { Suspense } from "react";
import AuthForm, { AuthFormSkeleton } from "@/components/AuthForm";
import AuthShell from "@/components/AuthShell";

export const metadata = {
  title: "Create an account — SPARKServ",
  description: "Create a SPARKServ account to file a repair request or offer repair work.",
};

export default function RegisterPage() {
  return (
    <AuthShell
      headline="Join SPARKServ"
      subhead="Request appliance repairs or apply to join the technician network in Cagayan de Oro."
    >
      {/* Same Suspense requirement as /login — see the note there. The register
          form is taller than the login form (name, role selector, two consent
          rows), so the skeleton is given more rows to keep the swap from
          shifting the page. */}
      <Suspense fallback={<AuthFormSkeleton rows={5} />}>
        <AuthForm mode="register" />
      </Suspense>
    </AuthShell>
  );
}
