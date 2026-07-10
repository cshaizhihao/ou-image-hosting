"use client";

import { AuthShell } from "@/components/auth-shell";
import { PasswordMeter } from "@/components/password-meter";
import { ApiError, apiRequest, type ThemePreference } from "@/lib/api";
import { Button } from "@ou-image/ui";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  LoaderCircle,
  ServerCog,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

type EnvironmentCheck = {
  key: string;
  label: string;
  status: "pass" | "fail";
  detail: string;
};

const steps = ["环境检查", "创建站点", "准备完成"];

export default function InstallPage() {
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<EnvironmentCheck[]>([]);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    Promise.all([
      apiRequest<{ setupComplete: boolean }>("/setup/status"),
      apiRequest<{ checks: EnvironmentCheck[] }>("/setup/environment")
    ])
      .then(([status, environment]) => {
        if (status.setupComplete) {
          window.location.replace("/login");
          return;
        }
        setChecks(environment.checks);
      })
      .catch((requestError: unknown) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "无法连接后端服务"
        );
      })
      .finally(() => setChecking(false));
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/setup", {
        method: "POST",
        body: JSON.stringify({
          siteName: form.get("siteName"),
          displayName: form.get("displayName"),
          email: form.get("email"),
          password,
          registrationEnabled: form.get("registrationEnabled") === "on",
          theme
        })
      });
      setStep(2);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : "初始化失败，请检查服务状态"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell mode="install">
      <div className="install-card">
        <div className="install-progress" aria-label="安装进度">
          {steps.map((label, index) => (
            <div
              className={`${index === step ? "is-current" : ""}${index < step ? " is-done" : ""}`}
              key={label}
            >
              <span>{index < step ? <Check size={14} /> : index + 1}</span>
              <small>{label}</small>
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="auth-form-view">
            <div className="auth-heading">
              <span className="auth-heading__icon"><ServerCog size={21} /></span>
              <h2>先确认运行环境</h2>
              <p>只检查必要条件，不会修改系统设置。</p>
            </div>

            <div className="environment-list">
              {checking ? (
                <div className="environment-loading">
                  <LoaderCircle className="spin" size={22} />
                  正在检查运行环境
                </div>
              ) : (
                checks.map((check) => (
                  <div key={check.key}>
                    <span className={check.status === "pass" ? "is-pass" : "is-fail"}>
                      {check.status === "pass" ? <Check size={15} /> : "!"}
                    </span>
                    <p><strong>{check.label}</strong><small>{check.detail}</small></p>
                  </div>
                ))
              )}
            </div>

            {error && <div className="form-message is-error">{error}</div>}
            <Button
              className="auth-submit"
              disabled={checking || checks.some((check) => check.status === "fail")}
              onClick={() => setStep(1)}
            >
              继续配置
              <ArrowRight size={17} />
            </Button>
          </div>
        )}

        {step === 1 && (
          <form className="auth-form-view" onSubmit={submit}>
            <div className="auth-heading">
              <span className="auth-heading__icon"><ShieldCheck size={21} /></span>
              <h2>创建你的图床</h2>
              <p>设置站点信息与第一个管理员账号。</p>
            </div>

            <div className="form-grid form-grid--two">
              <label className="field">
                <span>站点名称</span>
                <input defaultValue="OU-Image Hosting" maxLength={60} minLength={2} name="siteName" required />
              </label>
              <label className="field">
                <span>管理员名称</span>
                <input autoComplete="name" maxLength={40} minLength={2} name="displayName" placeholder="你的称呼" required />
              </label>
            </div>

            <label className="field">
              <span>管理员邮箱</span>
              <input autoComplete="email" inputMode="email" name="email" placeholder="name@example.com" required type="email" />
            </label>

            <label className="field">
              <span>管理员密码</span>
              <span className="field__input-action">
                <input
                  autoComplete="new-password"
                  maxLength={128}
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="创建一个安全密码"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                />
                <button
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  onClick={() => setShowPassword((value) => !value)}
                  type="button"
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>
            <PasswordMeter value={password} />

            <fieldset className="theme-choice">
              <legend>默认外观</legend>
              <div>
                {(["light", "dark", "system"] as const).map((value) => (
                  <button
                    className={theme === value ? "is-selected" : ""}
                    key={value}
                    onClick={() => setTheme(value)}
                    type="button"
                  >
                    <span>{value === "light" ? "Aa" : value === "dark" ? "Aa" : "◐"}</span>
                    {value === "light" ? "浅色" : value === "dark" ? "深色" : "跟随系统"}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="switch-row">
              <span><strong>开放用户注册</strong><small>关闭后仅管理员可添加成员。</small></span>
              <input name="registrationEnabled" type="checkbox" />
            </label>

            {error && <div className="form-message is-error">{error}</div>}

            <div className="form-actions">
              <Button onClick={() => setStep(0)} type="button" variant="secondary">
                <ArrowLeft size={17} />上一步
              </Button>
              <Button disabled={submitting} type="submit">
                {submitting ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}
                创建站点
              </Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="install-complete">
            <span className="install-complete__art">
              <span><img alt="" src="/brand/ou-image-hosting-logo.jpg" /></span>
              <CheckCircle2 size={26} />
            </span>
            <span className="auth-eyebrow"><Sparkles size={14} /> INSTALLATION COMPLETE</span>
            <h2>你的图床已经准备好了</h2>
            <p>管理员账号、站点偏好和本地数据目录已经创建。接下来用一分钟完成首次使用引导。</p>
            <div className="complete-summary">
              <span><Check size={15} /> 管理员账号已创建</span>
              <span><Check size={15} /> 安全会话已建立</span>
              <span><Check size={15} /> 默认本地存储已登记</span>
            </div>
            <Button asChild className="auth-submit">
              <Link href="/onboarding">开始使用 <ArrowRight size={17} /></Link>
            </Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
