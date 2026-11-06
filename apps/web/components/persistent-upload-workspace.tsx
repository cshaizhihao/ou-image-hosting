"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { UploadWorkbench } from "./upload-workbench";

// The root layout survives client navigation. Keep the queue engine mounted
// after its first visit, and render its workspace chrome only on /upload.
export function PersistentUploadWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === "/upload";
  const [visited, setVisited] = useState(active);
  const [sessionEnded, setSessionEnded] = useState(false);
  useEffect(() => { if (active) { setVisited(true); setSessionEnded(false); } }, [active]);
  useEffect(() => {
    const reset = () => { setSessionEnded(true); setVisited(false); };
    window.addEventListener("ou:session-ended", reset);
    return () => window.removeEventListener("ou:session-ended", reset);
  }, []);
  return <>
    {!active && children}
    {(active || visited) && !sessionEnded && <UploadWorkbench active={active} />}
  </>;
}
