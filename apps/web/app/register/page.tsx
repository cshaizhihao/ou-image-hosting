"use client";

import { AuthShell } from "@/components/auth-shell";
import { PasswordMeter } from "@/components/password-meter";
import { ApiError, apiRequest, clearStoredWorkspaceId } from "@/lib/api";
import { Button } from "@ou-image/ui";
import { ArrowLeft, ArrowRight, LoaderCircle, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export default function RegisterPage() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<{ setupComplete: boolean; site: { registrationEnabled: boolean } | null }>(
      "/setup/status"
    )
      .then((status) => {
        if (!status.setupComplete) window.location.replace("/install");
        else if (!status.site?.registrationEnabled) window.location.replace("/login");
      })
      .catch(() => setError("无法读取站点注册状态"));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: form.get("displayName"),
          email: form.get("email"),
          password
        })
      });
      clearStoredWorkspaceId();
      window.location.replace("/?welcome=1");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "注册失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <form className="auth-card auth-form-view" onSubmit={submit}>
        <div className="auth-heading">
          <span className="auth-heading__icon"><UserPlus size={21} /></span>
          <h2>创建账号</h2>
          <p>加入这个 OU-Image Hosting 图片空间。</p>
        </div>
        <label className="field">
          <span>显示名称</span>
          <input autoComplete="name" maxLength={40} minLength={2} name="displayName" required />
        </label>
        <label className="field">
          <span>邮箱地址</span>
          <input autoComplete="email" name="email" required type="email" />
        </label>
        <label className="field">
          <span>密码</span>
          <input
            autoComplete="new-password"
            maxLength={128}
            minLength={12}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <PasswordMeter value={password} />
        {error && <div className="form-message is-error">{error}</div>}
        <Button className="auth-submit" disabled={submitting} type="submit">
          {submitting ? <LoaderCircle className="spin" size={17} /> : "创建账号"}
          {!submitting && <ArrowRight size={17} />}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login"><ArrowLeft size={16} />返回登录</Link>
        </Button>
      </form>
    </AuthShell>
  );
}
