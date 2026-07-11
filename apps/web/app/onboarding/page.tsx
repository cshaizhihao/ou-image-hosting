"use client";

import { AuthShell } from "@/components/auth-shell";
import {
  ApiError,
  apiRequest,
  applyTheme,
  type SessionUser,
  type ThemePreference
} from "@/lib/api";
import { Button } from "@ou-image/ui";
import {
  ArrowRight,
  Check,
  FolderCog,
  ImageUp,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Sparkles,
  Sun
} from "lucide-react";
import { useEffect, useState } from "react";

const themes: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  { value: "light", label: "浅色", description: "明亮、干净，适合白天使用" },
  { value: "dark", label: "深色", description: "低亮度环境更舒适" },
  { value: "system", label: "跟随系统", description: "自动匹配设备外观" }
];

export default function OnboardingPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<{ user: SessionUser }>("/auth/session")
      .then(({ user: sessionUser }) => {
        setUser(sessionUser);
        setTheme(sessionUser.theme);
      })
      .catch(() => window.location.replace("/login"));
  }, []);

  const finish = async () => {
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/me", {
        method: "PATCH",
        body: JSON.stringify({ theme, onboardingCompleted: true })
      });
      applyTheme(theme);
      window.location.replace("/overview");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "保存失败");
      setSubmitting(false);
    }
  };

  return (
    <AuthShell mode="install">
      <div className="onboarding-card">
        <div className="onboarding-hero">
          <span><Sparkles size={19} /></span>
          <p>欢迎，{user?.displayName ?? "新用户"}</p>
          <h2>把工作区调成你喜欢的样子</h2>
          <small>这些设置以后都可以在设置中心修改。</small>
        </div>

        <section className="onboarding-section">
          <div className="onboarding-section__head">
            <span>01</span>
            <div><strong>选择外观</strong><small>立即预览你的界面偏好</small></div>
          </div>
          <div className="onboarding-themes">
            {themes.map((item) => (
              <button
                className={theme === item.value ? "is-selected" : ""}
                key={item.value}
                onClick={() => {
                  setTheme(item.value);
                  applyTheme(item.value);
                }}
                type="button"
              >
                <span className={`theme-preview theme-preview--${item.value}`}>
                  {item.value === "light" ? <Sun size={18} /> : item.value === "dark" ? <Moon size={18} /> : "◐"}
                </span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
                {theme === item.value && <Check className="theme-check" size={16} />}
              </button>
            ))}
          </div>
        </section>

        <section className="onboarding-section">
          <div className="onboarding-section__head">
            <span>02</span>
            <div><strong>认识三个起点</strong><small>不需要一次配置所有功能</small></div>
          </div>
          <div className="onboarding-paths">
            <div><span><ImageUp size={19} /></span><p><strong>上传工作台</strong><small>拖入图片并检查上传队列</small></p></div>
            <div><span><FolderCog size={19} /></span><p><strong>存储设置</strong><small>下一轮接入真实存储适配器</small></p></div>
            <div><span><LayoutDashboard size={19} /></span><p><strong>工作区概览</strong><small>集中查看容量与活动状态</small></p></div>
          </div>
        </section>

        {error && <div className="form-message is-error">{error}</div>}
        <Button className="auth-submit" disabled={!user || submitting} onClick={finish}>
          {submitting ? <LoaderCircle className="spin" size={17} /> : "进入工作区"}
          {!submitting && <ArrowRight size={17} />}
        </Button>
      </div>
    </AuthShell>
  );
}
