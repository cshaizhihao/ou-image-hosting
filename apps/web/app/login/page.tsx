"use client";

import { AuthShell } from "@/components/auth-shell";
import {
  ApiError,
  apiRequest,
  clearStoredWorkspaceId,
  type SessionUser
} from "@/lib/api";
import { Button } from "@ou-image/ui";
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<{
      setupComplete: boolean;
      site: { registrationEnabled: boolean } | null;
    }>("/setup/status")
      .then((status) => {
        if (!status.setupComplete) {
          window.location.replace("/install");
          return;
        }
        setRegistrationEnabled(status.site?.registrationEnabled ?? false);
      })
      .catch(() => setError("无法连接后端服务，请确认 API 已启动"));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await apiRequest<{ user: SessionUser }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password")
        })
      });
      clearStoredWorkspaceId();
      window.location.replace(
        response.user.onboardingCompleted ? "/overview" : "/onboarding"
      );
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "登录失败，请稍后再试"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <form className="auth-card auth-form-view" onSubmit={submit}>
        <div className="auth-heading">
          <span className="auth-heading__icon"><LockKeyhole size={21} /></span>
          <h2>欢迎回来</h2>
          <p>登录后继续管理你的图片空间。</p>
        </div>

        <label className="field">
          <span>邮箱地址</span>
          <input autoComplete="email" inputMode="email" name="email" placeholder="name@example.com" required type="email" />
        </label>
        <label className="field">
          <span className="field__label-row">
            密码
            <Link href="/forgot-password">忘记密码？</Link>
          </span>
          <span className="field__input-action">
            <input autoComplete="current-password" name="password" placeholder="输入你的密码" required type={showPassword ? "text" : "password"} />
            <button
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>

        {error && <div className="form-message is-error">{error}</div>}

        <Button className="auth-submit" disabled={submitting} type="submit">
          {submitting ? <LoaderCircle className="spin" size={17} /> : "登录"}
          {!submitting && <ArrowRight size={17} />}
        </Button>

        {registrationEnabled && (
          <p className="auth-alt">还没有账号？<Link href="/register">创建账号</Link></p>
        )}
        <p className="auth-security-note">会话凭证仅通过 HttpOnly Cookie 保存。</p>
      </form>
    </AuthShell>
  );
}
