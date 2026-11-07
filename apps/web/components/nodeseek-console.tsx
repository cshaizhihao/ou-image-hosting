"use client";

import { Badge, Button } from "@ou-image/ui";
import { Download, ExternalLink, KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "@/lib/api";
import {
  AccessDenied,
  ConfirmActionDialog,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  OneTimeSecretDialog,
  managementStyles,
  requestMessage
} from "./management-ui";
import styles from "./nodeseek-console.module.css";

type Group = { id: string; name: string; nodeSeekPublic?: boolean; imageCount: number };
type Credential = {
  id: string;
  name: string;
  prefix: string;
  nodeSeekAlbumId?: string;
  revokedAt?: string;
  expiresAt?: string;
};

export function NodeSeekConsole() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [name, setName] = useState("");
  const [publicVisible, setPublicVisible] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<Credential | null>(null);
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    void Promise.all([
      apiRequest<{ albums: Group[] }>("/albums", options),
      apiRequest<{ tokens: Credential[] }>("/api-tokens", options)
    ]).then(([albums, tokens]) => {
      const groups = albums.albums.filter((album) => album.nodeSeekPublic !== undefined);
      setGroups(groups);
      setSelectedGroup(groups[0]?.id ?? "");
      setCredentials(tokens.tokens.filter((token) => token.nodeSeekAlbumId));
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.status === 403) setDenied(true);
      else setError(requestMessage(failure, "无法加载 NodeSeek 配置"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function mutate(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await operation(); }
    catch (failure) { setError(requestMessage(failure, "操作失败，请重试")); }
    finally { setBusy(false); }
  }

  function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const groupName = name.trim();
    if (!groupName) return;
    void mutate(async () => {
      const { album } = await apiRequest<{ album: Group }>("/albums", {
        method: "POST",
        body: JSON.stringify({ name: groupName, nodeSeekPublic: publicVisible })
      });
      setGroups((current) => [album, ...current]);
      setSelectedGroup(album.id);
      setName("");
      setPublicVisible(false);
      setNotice("NodeSeek 分组已创建");
    });
  }

  function changeVisibility(group: Group, next: boolean) {
    void mutate(async () => {
      const { album } = await apiRequest<{ album: Group }>(`/albums/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nodeSeekPublic: next })
      });
      setGroups((current) => current.map((item) => item.id === album.id ? album : item));
      setNotice(next ? "分组中的 NodeSeek 上传已设为公开展示" : "分组中的 NodeSeek 上传已从公共图库隐藏");
    });
  }

  function issueCredential() {
    const group = groups.find((item) => item.id === selectedGroup);
    if (!group) return;
    void mutate(async () => {
      const response = await apiRequest<{ value: string; token: Credential }>("/api-tokens", {
        method: "POST",
        body: JSON.stringify({
          name: `NodeSeek · ${group.name}`,
          scopes: ["nodeseek:upload"],
          nodeSeekAlbumId: group.id
        })
      });
      setCredentials((current) => [response.token, ...current]);
      setSecret(response.value);
    });
  }

  function revokeCredential(credential: Credential) {
    void mutate(async () => {
      await apiRequest(`/api-tokens/${credential.id}`, { method: "DELETE" });
      setCredentials((current) => current.filter((token) => token.id !== credential.id));
      setPendingRevoke(null);
      setNotice("上传凭据已撤销");
    });
  }

  return (
    <ManagementPage activeKey="nodeseek">
      <ManagementHeader
        eyebrow="浏览器集成"
        title="NodeSeek 快捷上传"
        description="在论坛编辑器里粘贴或选图上传，也可以用快捷菜单上传论坛图片。"
        action={!denied && (
          <Button asChild>
            <a href="/api/integrations/nodeseek/install.user.js" target="_blank" rel="noopener noreferrer">
              <Download aria-hidden="true" size={17} />安装浏览器脚本
            </a>
          </Button>
        )}
      />
      {error && <ManagementNotice tone="error" onClose={() => setError("")}>{error}</ManagementNotice>}
      {notice && <ManagementNotice tone="success" onClose={() => setNotice("")}>{notice}</ManagementNotice>}
      {loading ? <LoadingPanel label="正在加载 NodeSeek 配置" /> : denied ? <AccessDenied /> : (
        <>
          <ol className={styles.steps} aria-label="安装步骤">
            <li><strong>安装脚本</strong><span>先安装 <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener noreferrer">Tampermonkey <ExternalLink aria-hidden="true" size={12} /></a>，再点击页面上的安装按钮。</span></li>
            <li><strong>绑定分组</strong><span>创建分组和上传凭据，在论坛编辑器点击「凭据设置」，或从脚本菜单打开设置面板。</span></li>
            <li><strong>开始上传</strong><span>在编辑框粘贴或选图上传。论坛图片用 Shift＋右键上传，Firefox 用 Alt＋右键。</span></li>
          </ol>
          <div className={styles.grid}>
            <section className={managementStyles.panel} aria-labelledby="nodeseek-groups">
              <div className={managementStyles.panelHeading}>
                <div>
                  <h2 id="nodeseek-groups">上传分组</h2>
                  <p>关闭公开展示会从公共图库隐藏分组中的脚本上传图片，直链仍可访问。</p>
                </div>
              </div>
              <form className={styles.form} onSubmit={createGroup}>
                <label className={styles.field}>分组名称
                  <input maxLength={60} onChange={(event) => setName(event.target.value)} required value={name} />
                </label>
                <label className={styles.checkbox}>
                  <input type="checkbox" checked={publicVisible} onChange={(event) => setPublicVisible(event.target.checked)} />
                  公开展示到公共图库
                </label>
                <Button disabled={busy || !name.trim()} type="submit" size="compact"><Plus aria-hidden="true" size={16} />创建分组</Button>
              </form>
              {groups.length > 0 && (
                <ul className={styles.list}>
                  {groups.map((group) => (
                    <li key={group.id}>
                      <div><strong>{group.name}</strong><small>{group.imageCount ?? 0} 张图片</small></div>
                      <label className={styles.checkbox}>
                        <input
                          aria-label={`${group.name} 公开展示`}
                          type="checkbox"
                          checked={group.nodeSeekPublic === true}
                          disabled={busy}
                          onChange={(event) => changeVisibility(group, event.target.checked)}
                        />
                        公开展示
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className={managementStyles.panel} aria-labelledby="nodeseek-credentials">
              <div className={managementStyles.panelHeading}>
                <div>
                  <h2 id="nodeseek-credentials">上传凭据</h2>
                  <p>每个凭据只允许上传到绑定的分组。更换分组时可在脚本菜单换用对应凭据。</p>
                </div>
              </div>
              <div className={styles.form}>
                <label className={styles.field}>绑定分组
                  <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)} disabled={!groups.length}>
                    {!groups.length && <option value="">先创建分组</option>}
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
                <Button onClick={issueCredential} disabled={busy || !selectedGroup} size="compact"><KeyRound aria-hidden="true" size={16} />生成上传凭据</Button>
              </div>
              <ul className={styles.list}>
                {credentials.filter((token) => !token.revokedAt).map((token) => (
                  <li key={token.id}>
                    <div><strong>{token.name}</strong><small>ouh_{token.prefix}…</small></div>
                    <div className={styles.credentialActions}>
                      {!groups.some((group) => group.id === token.nodeSeekAlbumId) && <Badge tone="warning">分组已删除</Badge>}
                      <Button disabled={busy} onClick={() => setPendingRevoke(token)} size="compact" variant="ghost">
                        <Trash2 aria-hidden="true" size={15} />撤销
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      <OneTimeSecretDialog
        open={Boolean(secret)}
        onOpenChange={(open) => { if (!open) setSecret(""); }}
        title="NodeSeek 上传凭据"
        description="复制到论坛编辑器的「凭据设置」。"
        secret={secret}
      />
      <ConfirmActionDialog
        busy={busy}
        danger
        icon={Trash2}
        open={Boolean(pendingRevoke)}
        onOpenChange={(open) => { if (!open && !busy) setPendingRevoke(null); }}
        onConfirm={() => { if (pendingRevoke) revokeCredential(pendingRevoke); }}
        title="撤销上传凭据"
        description="撤销后该脚本凭据会停止上传，已经生成的图片链接仍可访问。"
        confirmLabel="撤销"
      />
    </ManagementPage>
  );
}
