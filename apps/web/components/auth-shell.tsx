"use client";

import { cn } from "@ou-image/ui";
import { Check, ImageIcon, Moon, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={cn("auth-brand", compact && "auth-brand--compact")} href="/">
      <span className="auth-brand__mark">
        <img
          alt="OU-Image Hosting 官方 Logo"
          height={62}
          src="/brand/ou-image-hosting-logo.jpg"
          width={62}
        />
      </span>
      <span>
        <strong>OU-Image Hosting</strong>
        <small>欧记图床</small>
      </span>
    </Link>
  );
}

export function AuthShell({
  children,
  mode = "auth"
}: {
  children: ReactNode;
  mode?: "auth" | "install";
}) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("ou-theme");
    const nextDark =
      saved === "dark" ||
      (saved !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(nextDark);
    document.documentElement.dataset.theme = nextDark ? "dark" : "light";
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    window.localStorage.setItem("ou-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
  };

  return (
    <main
      className={cn("auth-layout", mode === "install" && "auth-layout--install")}
      id="main-content"
      tabIndex={-1}
    >
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <section className="auth-story" aria-label="产品介绍">
        <div className="auth-story__top">
          <BrandLockup />
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="auth-theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="auth-story__content">
          <span className="auth-eyebrow">BEAUTIFUL SELF-HOSTED IMAGE HUB</span>
          <h1>让图片管理，<br />从第一眼就舒服。</h1>
          <p>
            上传、整理、分享和维护图片资产。清晰的操作路径，加上克制、耐看的界面。
          </p>
          <div className="auth-benefits">
            <div>
              <span><ImageIcon size={17} /></span>
              <p><strong>专注图片</strong><small>围绕高频操作设计，不堆砌无关功能。</small></p>
            </div>
            <div>
              <span><ShieldCheck size={17} /></span>
              <p><strong>数据自持</strong><small>部署在自己的环境，凭证与数据由你掌握。</small></p>
            </div>
            <div>
              <span><Check size={17} /></span>
              <p><strong>细节可靠</strong><small>响应式布局、深色模式与完整状态反馈。</small></p>
            </div>
          </div>
        </div>

        <p className="auth-story__footer">OU-Image Hosting · Built for your own space</p>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__mobile-head">
          <BrandLockup compact />
          <button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            className="auth-theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
        <div className="auth-panel__content">{children}</div>
      </section>
    </main>
  );
}
