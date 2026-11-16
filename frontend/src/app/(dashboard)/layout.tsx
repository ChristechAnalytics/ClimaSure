import { AuthGate } from "@/components/auth-gate";

// Every page in this group needs a signed-in client; AuthGate handles that in the browser.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return <AuthGate>{children}</AuthGate>;
}
