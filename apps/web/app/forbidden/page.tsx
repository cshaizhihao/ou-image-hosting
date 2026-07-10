import Link from "next/link";
import { Button } from "@ou-image/ui";
import { AppShell } from "@/components/app-shell";

export default function ForbiddenPage() {
  return (
    <AppShell activeKey="">
      <main className="status-page">
        <span className="status-code">403</span>
        <h1>你没有访问权限</h1>
        <p>此页面需要更高的工作区权限。</p>
        <Button asChild variant="secondary">
          <Link href="/">返回工作台</Link>
        </Button>
      </main>
    </AppShell>
  );
}
