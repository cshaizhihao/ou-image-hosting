"use client";

import { Check, Circle } from "lucide-react";

const rules = [
  { label: "至少 12 个字符", test: (value: string) => value.length >= 12 },
  { label: "包含大小写字母", test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { label: "包含数字", test: (value: string) => /\d/.test(value) },
  { label: "包含特殊字符", test: (value: string) => /[^A-Za-z0-9]/.test(value) }
];

export function PasswordMeter({ value }: { value: string }) {
  const score = rules.filter((rule) => rule.test(value)).length;
  const labels = ["等待输入", "较弱", "一般", "良好", "强"];

  return (
    <div className="password-meter">
      <div className="password-meter__head">
        <span>密码强度</span>
        <strong data-score={score}>{labels[score]}</strong>
      </div>
      <div className="password-meter__bars" aria-hidden="true">
        {rules.map((rule, index) => (
          <span className={score > index ? "is-active" : ""} key={rule.label} />
        ))}
      </div>
      <div className="password-rules">
        {rules.map((rule) => {
          const valid = rule.test(value);
          return (
            <span className={valid ? "is-valid" : ""} key={rule.label}>
              {valid ? <Check size={13} /> : <Circle size={10} />}
              {rule.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
