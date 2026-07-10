"use client";

import { AuthShell } from "@/components/auth-shell";
import { PasswordMeter } from "@/components/password-meter";
import { ApiError, apiRequest } from "@/lib/api";
import { Button } from "@ou-image/ui";
import { ArrowRight, CircleCheck, KeyRound, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

export function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      setComplete(true);
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "重置失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <div className="auth-card auth-form-view">
        {complete ? (
          <div className="auth-result">
            <span><CircleCheck size={28} /></span>
            <h2>密码已经更新</h2>
            <p>所有旧会话均已退出，现在可以使用新密码登录。</p>
            <Button asChild className="auth-submit"><Link href="/login">前往登录 <ArrowRight size={17} /></Link></Button>
          </div>
        ) : (
          <form className="auth-form-view" onSubmit={submit}>
            <div className="auth-heading">
              <span className="auth-heading__icon"><KeyRound size={21} /></span>
              <h2>设置新密码</h2>
              <p>重置链接有效期为 30 分钟，且只能使用一次。</p>
            </div>
            <label className="field">
              <span>新密码</span>
              <input
                autoComplete="new-password"
                disabled={!token}
                maxLength={128}
                minLength={12}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <PasswordMeter value={password} />
            {!token && <div className="form-message is-error">重置令牌缺失，请重新创建请求。</div>}
            {error && <div className="form-message is-error">{error}</div>}
            <Button className="auth-submit" disabled={!token || submitting} type="submit">
              {submitting ? <LoaderCircle className="spin" size={17} /> : "更新密码"}
              {!submitting && <ArrowRight size={17} />}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
