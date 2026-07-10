import Link from "next/link";
import { Button } from "@ou-image/ui";
import { AppShell } from "@/components/app-shell";

export default function NotFound() {
  return (
    <AppShell activeKey="">
      <main className="status-page">
        <span className="status-code">404</span>
        <h1>没有找到这个页面</h1>
        <p>链接可能已经失效，或者页面地址有误。</p>
        <Button asChild>
          <Link href="/">返回上传工作台</Link>
        </Button>
      </main>
    </AppShell>
  );
}
