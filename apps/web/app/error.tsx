"use client";

import { useEffect } from "react";
import { Button } from "@ou-image/ui";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className="status-page status-page--standalone">
          <span className="status-code">500</span>
          <h1>页面暂时无法打开</h1>
          <p>刷新没有解决问题时，可以稍后再试。</p>
          <Button onClick={reset}>重新加载</Button>
        </main>
      </body>
    </html>
  );
}
