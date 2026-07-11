"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

const publicSegments = new Set([
  "",
  "forgot-password",
  "install",
  "login",
  "register",
  "reset-password",
  "share"
]);

function LoadingIndicator() {
  return (
    <main className="page-loading__main" role="status" aria-live="polite">
      <span className="sr-only">正在切换页面</span>
      <div className="page-loading__ring" aria-hidden="true" />
      <div className="page-loading__fake-progress" aria-hidden="true">
        <i />
      </div>
    </main>
  );
}

export default function Loading() {
  const pathname = usePathname();
  const activeKey = pathname.split("/").filter(Boolean)[0] ?? "overview";

  if (publicSegments.has(activeKey)) {
    return (
      <div className="page-loading" aria-label="正在加载">
        <LoadingIndicator />
      </div>
    );
  }

  return (
    <AppShell activeKey={activeKey}>
      <LoadingIndicator />
    </AppShell>
  );
}
