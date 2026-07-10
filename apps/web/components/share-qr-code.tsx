"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import styles from "./share-qr-code.module.css";

type ShareQrCodeProps = {
  value: string;
  label?: string;
};

export function ShareQrCode({
  value,
  label = "分享链接二维码"
}: ShareQrCodeProps) {
  const [dataUrl, setDataUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setDataUrl("");
    setFailed(false);

    void QRCode.toDataURL(value, {
      width: 304,
      margin: 1,
      color: {
        dark: "#242424",
        light: "#ffffff"
      },
      errorCorrectionLevel: "M"
    })
      .then((result) => {
        if (active) setDataUrl(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [value]);

  return (
    <figure className={styles.frame}>
      {dataUrl ? (
        <img
          alt={label}
          className={styles.image}
          height={152}
          src={dataUrl}
          width={152}
        />
      ) : (
        <div aria-live="polite" className={styles.placeholder}>
          {failed ? "二维码生成失败" : "正在生成二维码"}
        </div>
      )}
      <figcaption className={styles.caption} title={value}>
        {value}
      </figcaption>
    </figure>
  );
}
