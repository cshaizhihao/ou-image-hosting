"use client";

import { AuthShell } from "@/components/auth-shell";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@ou-image/ui";
import { ArrowLeft, ArrowRight, CircleCheck, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export default function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{
        message: string;
        developmentResetToken?: string;
      }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") })
      });
      setDevelopmentToken(result.developmentResetToken ?? "");
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card auth-form-view">
        {!sent ? (
          <form className="auth-form-view" onSubmit={submit}>
            <div className="auth-heading">
              <span className="auth-heading__icon"><Mail size={21} /></span>
              <h2>找回密码</h2>
              <p>输入管理员邮箱，我们会创建一次性重置请求。</p>
            </div>
            <label className="field">
              <span>邮箱地址</span>
              <input autoComplete="email" name="email" placeholder="name@example.com" required type="email" />
            </label>
            {error && <div className="form-message is-error">{error}</div>}
            <Button className="auth-submit" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="spin" size={17} /> : "创建重置请求"}
              {!submitting && <ArrowRight size={17} />}
            </Button>
            <Button asChild variant="ghost"><Link href="/login"><ArrowLeft size={16} />返回登录</Link></Button>
          </form>
        ) : (
          <div className="auth-result">
            <span><CircleCheck size={28} /></span>
            <h2>请求已经处理</h2>
            <p>如果该邮箱存在，系统已经创建密码重置请求。</p>
            {developmentToken && (
              <div className="development-reset">
                <strong>本地开发恢复入口</strong>
                <small>该入口仅在明确启用开发令牌时出现，生产环境不会显示。</small>
                <Button asChild><Link href={`/reset-password?token=${encodeURIComponent(developmentToken)}`}>继续重置密码</Link></Button>
              </div>
            )}
            <Button asChild className="auth-submit" variant="secondary"><Link href="/login">返回登录</Link></Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
