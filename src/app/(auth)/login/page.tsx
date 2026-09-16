import AuthForm from "@/components/AuthForm";
import AuthShell from "@/components/AuthShell";

export default function LoginPage() {
  return (
    <AuthShell
      headline="Good to see you again."
      subhead="Log back in to track a repair, review an estimate, or pick up where you left off."
    >
      <AuthForm mode="login" />
    </AuthShell>
  );
}
