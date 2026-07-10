"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Badge, Button } from "@ou-image/ui";
import {
  Clock3,
  Crown,
  Link2,
  LoaderCircle,
  MailPlus,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
  Users,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createInvitation,
  getTeam,
  removeMember,
  revokeInvitation,
  transferWorkspaceOwnership,
  updateMemberRole,
  type MemberRole,
  type TeamMember,
  type WorkspaceInvitation
} from "@/lib/admin-api";
import { ApiError } from "@/lib/api";
import {
  AccessDenied,
  ConfirmActionDialog,
  EmptyPanel,
  LoadingPanel,
  ManagementHeader,
  ManagementNotice,
  ManagementPage,
  ManagementTabs,
  OneTimeSecretDialog,
  RoleBadge,
  formatManagementDate,
  managementStyles as styles,
  memberRoleCopy,
  requestMessage
} from "./management-ui";

type TeamTab = "members" | "invitations";
type PendingAction =
  | { type: "remove"; member: TeamMember }
  | { type: "transfer"; member: TeamMember }
  | { type: "revoke-invite"; invitation: WorkspaceInvitation }
  | null;

const editableRoles: Array<Exclude<MemberRole, "owner">> = [
  "admin",
  "editor",
  "viewer"
];

function statusBadge(status: TeamMember["status"]) {
  if (status === "active") return <Badge tone="success">活跃</Badge>;
  if (status === "suspended") return <Badge tone="warning">已暂停</Badge>;
  return <Badge>待加入</Badge>;
}

function invitationBadge(status: WorkspaceInvitation["status"]) {
  if (status === "pending") return <Badge tone="info">等待接受</Badge>;
  if (status === "accepted") return <Badge tone="success">已加入</Badge>;
  if (status === "expired") return <Badge tone="warning">已过期</Badge>;
  return <Badge>已撤销</Badge>;
}

export function TeamConsole() {
  const [tab, setTab] = useState<TeamTab>("members");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [workspaceRole, setWorkspaceRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] =
    useState<Exclude<MemberRole, "owner">>("editor");
  const [inviteLink, setInviteLink] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await getTeam();
      setMembers(payload.members);
      setInvitations(payload.invitations);
      setWorkspaceRole(payload.workspaceRole ?? null);
      setDenied(false);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 403) {
        setDenied(true);
      } else {
        setError(requestMessage(requestError, "团队数据加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeMembers = useMemo(
    () => members.filter((member) => member.status === "active").length,
    [members]
  );
  const admins = useMemo(
    () =>
      members.filter(
        (member) => member.role === "owner" || member.role === "admin"
      ).length,
    [members]
  );
  const isOwner = workspaceRole === "owner";
  const isAdmin = workspaceRole === "admin";
  const canManageTeam = isOwner || isAdmin;
  const availableInviteRoles = useMemo<
    Array<Exclude<MemberRole, "owner">>
  >(
    () => (isOwner ? editableRoles : ["editor", "viewer"]),
    [isOwner]
  );

  useEffect(() => {
    if (!availableInviteRoles.includes(inviteRole)) {
      setInviteRole(availableInviteRoles[0] ?? "viewer");
    }
  }, [availableInviteRoles, inviteRole]);

  const canManageMember = (member: TeamMember) =>
    !member.isCurrentUser &&
    (isOwner
      ? member.role !== "owner"
      : isAdmin
        ? member.role === "editor" || member.role === "viewer"
        : false);

  const canTransferOwnership = (member: TeamMember) =>
    isOwner &&
    !member.isCurrentUser &&
    member.role !== "owner" &&
    member.status === "active";

  const canRevokeInvitation = (invitation: WorkspaceInvitation) =>
    canManageTeam && (isOwner || invitation.role !== "admin");

  const submitInvitation = async () => {
    if (
      !canManageTeam ||
      !inviteEmail.trim() ||
      !availableInviteRoles.includes(inviteRole)
    ) {
      return;
    }
    setBusy("invite");
    setError("");
    try {
      const payload = await createInvitation({
        email: inviteEmail.trim(),
        role: inviteRole
      });
      setInvitations((current) => [payload.invitation, ...current]);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("editor");
      if (payload.inviteUrl) setInviteLink(payload.inviteUrl);
      else setNotice("邀请已创建，邀请链接由服务端发送给成员。");
    } catch (requestError) {
      setError(requestMessage(requestError, "邀请创建失败"));
    } finally {
      setBusy("");
    }
  };

  const changeRole = async (member: TeamMember, role: MemberRole) => {
    const allowedRoles: MemberRole[] = isOwner
      ? editableRoles
      : ["editor", "viewer"];
    if (
      role === member.role ||
      !canManageMember(member) ||
      role === "owner" ||
      !allowedRoles.includes(role)
    ) {
      return;
    }
    setBusy(`role-${member.id}`);
    setError("");
    try {
      const payload = await updateMemberRole(member.userId, role);
      setMembers((current) =>
        current.map((item) =>
          item.id === member.id ? payload.member : item
        )
      );
      setNotice(`${member.displayName} 的角色已更新为${memberRoleCopy[role]}。`);
    } catch (requestError) {
      setError(requestMessage(requestError, "角色更新失败"));
    } finally {
      setBusy("");
    }
  };

  const executePendingAction = async () => {
    if (!pendingAction) return;
    if (
      (pendingAction.type === "remove" &&
        !canManageMember(pendingAction.member)) ||
      (pendingAction.type === "transfer" &&
        !canTransferOwnership(pendingAction.member)) ||
      (pendingAction.type === "revoke-invite" &&
        !canRevokeInvitation(pendingAction.invitation))
    ) {
      setPendingAction(null);
      setError("当前工作区角色无权执行此操作。");
      return;
    }
    setBusy("danger");
    setError("");
    try {
      if (pendingAction.type === "remove") {
        await removeMember(pendingAction.member.userId);
        setMembers((current) =>
          current.filter((member) => member.id !== pendingAction.member.id)
        );
        setNotice(`${pendingAction.member.displayName} 已移出工作区。`);
      }
      if (pendingAction.type === "transfer") {
        const payload = await transferWorkspaceOwnership(
          pendingAction.member.userId
        );
        setMembers((current) =>
          current.map((member) =>
            member.id === payload.member.id
              ? payload.member
              : member.role === "owner"
                ? { ...member, role: "admin" }
                : member
          )
        );
        setNotice(`所有权已转移给 ${pendingAction.member.displayName}。`);
      }
      if (pendingAction.type === "revoke-invite") {
        await revokeInvitation(pendingAction.invitation.id);
        setInvitations((current) =>
          current.filter(
            (invitation) => invitation.id !== pendingAction.invitation.id
          )
        );
        setNotice(`发送给 ${pendingAction.invitation.email} 的邀请已撤销。`);
      }
      setPendingAction(null);
    } catch (requestError) {
      setError(requestMessage(requestError, "操作失败"));
    } finally {
      setBusy("");
    }
  };

  const actionCopy = pendingAction
    ? pendingAction.type === "remove"
      ? {
          icon: UserMinus,
          title: "移除成员？",
          description: `${pendingAction.member.displayName} 将立即失去这个工作区的访问权限。`,
          label: "确认移除"
        }
      : pendingAction.type === "transfer"
        ? {
            icon: Crown,
            title: "转移工作区所有权？",
            description: `${pendingAction.member.displayName} 将成为新的所有者，你的角色会降为管理员。`,
            label: "确认转移"
          }
        : {
            icon: Trash2,
            title: "撤销邀请？",
            description: `${pendingAction.invitation.email} 将无法再使用原邀请链接加入。`,
            label: "撤销邀请"
          }
    : null;

  return (
    <ManagementPage activeKey="team">
      <ManagementHeader
        action={
          canManageTeam ? (
            <Button onClick={() => setInviteOpen(true)}>
              <MailPlus aria-hidden="true" size={17} />
              邀请成员
            </Button>
          ) : null
        }
        description="管理工作区成员、协作角色与待接受邀请。"
        eyebrow="TEAM & ACCESS"
        title="团队"
      />

      {notice && (
        <ManagementNotice onClose={() => setNotice("")} tone="success">
          {notice}
        </ManagementNotice>
      )}
      {error && (
        <ManagementNotice onClose={() => setError("")} tone="error">
          {error}
        </ManagementNotice>
      )}

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span><Users aria-hidden="true" size={19} /></span>
          <small>活跃成员</small>
          <strong>{activeMembers}</strong>
        </div>
        <div className={styles.metric}>
          <span><ShieldCheck aria-hidden="true" size={19} /></span>
          <small>管理员</small>
          <strong>{admins}</strong>
        </div>
        <div className={styles.metric}>
          <span><Clock3 aria-hidden="true" size={19} /></span>
          <small>待接受邀请</small>
          <strong>
            {invitations.filter((item) => item.status === "pending").length}
          </strong>
        </div>
      </div>

      <ManagementTabs
        active={tab}
        items={[
          { id: "members", label: "成员", icon: Users, count: members.length },
          {
            id: "invitations",
            label: "邀请",
            icon: MailPlus,
            count: invitations.length
          }
        ]}
        onChange={setTab}
      />

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>{tab === "members" ? "工作区成员" : "邀请记录"}</h2>
            <p>
              {tab === "members"
                ? "所有权转移需要二次确认。"
                : "链接只在创建后展示一次。"}
            </p>
          </div>
          <Button onClick={() => void load()} size="compact" variant="ghost">
            <RefreshCw aria-hidden="true" size={15} />
            刷新
          </Button>
        </div>

        {loading ? (
          <LoadingPanel label="正在读取团队成员" />
        ) : denied ? (
          <AccessDenied />
        ) : tab === "members" ? (
          members.length ? (
            <div className={styles.tableScroller}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>成员</th>
                    <th>状态</th>
                    <th>角色</th>
                    <th>最近活跃</th>
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <div className={styles.identity}>
                          <span className={styles.avatar}>
                            {member.displayName.slice(0, 2).toUpperCase()}
                          </span>
                          <span>
                            <strong>
                              {member.displayName}
                              {member.isCurrentUser ? "（你）" : ""}
                            </strong>
                            <small>{member.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>{statusBadge(member.status)}</td>
                      <td>
                        {!canManageMember(member) ? (
                          <RoleBadge role={member.role} />
                        ) : (
                          <select
                            aria-label={`修改 ${member.displayName} 的角色`}
                            className={styles.inlineSelect}
                            disabled={busy === `role-${member.id}`}
                            onChange={(event) =>
                              void changeRole(
                                member,
                                event.target.value as MemberRole
                              )
                            }
                            value={member.role}
                          >
                            {(isOwner
                              ? editableRoles
                              : (["editor", "viewer"] as const)
                            ).map((role) => (
                              <option key={role} value={role}>
                                {memberRoleCopy[role]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>{formatManagementDate(member.lastActiveAt)}</td>
                      <td>
                        <div className={styles.rowActions}>
                          {canTransferOwnership(member) && (
                            <Button
                              aria-label={`将所有权转移给 ${member.displayName}`}
                              onClick={() =>
                                setPendingAction({ type: "transfer", member })
                              }
                              size="icon"
                              title="转移所有权"
                              variant="ghost"
                            >
                              <Crown aria-hidden="true" size={16} />
                            </Button>
                          )}
                          {canManageMember(member) && (
                            <Button
                              aria-label={`移除 ${member.displayName}`}
                              onClick={() =>
                                setPendingAction({ type: "remove", member })
                              }
                              size="icon"
                              title="移除成员"
                              variant="ghost"
                            >
                              <UserMinus aria-hidden="true" size={16} />
                            </Button>
                          )}
                          {!canManageMember(member) &&
                            !canTransferOwnership(member) && (
                            <MoreHorizontal
                              aria-label="当前角色不可管理该成员"
                              size={17}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel
              action={
                canManageTeam ? (
                  <Button
                    onClick={() => setInviteOpen(true)}
                    variant="secondary"
                  >
                    <MailPlus aria-hidden="true" size={16} />
                    邀请第一位成员
                  </Button>
                ) : null
              }
              description="邀请成员后，可以按职责分配管理员、编辑者或只读角色。"
              icon={Users}
              title="当前只有你"
            />
          )
        ) : invitations.length ? (
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>有效期</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td><strong>{invitation.email}</strong></td>
                    <td><RoleBadge role={invitation.role} /></td>
                    <td>{invitationBadge(invitation.status)}</td>
                    <td>{formatManagementDate(invitation.expiresAt)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        {invitation.status === "pending" &&
                          canRevokeInvitation(invitation) && (
                          <Button
                            aria-label={`撤销发送给 ${invitation.email} 的邀请`}
                            onClick={() =>
                              setPendingAction({
                                type: "revoke-invite",
                                invitation
                              })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" size={16} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            action={
              canManageTeam ? (
                <Button
                  onClick={() => setInviteOpen(true)}
                  variant="secondary"
                >
                  <MailPlus aria-hidden="true" size={16} />
                  创建邀请
                </Button>
              ) : null
            }
            description="新邀请和过期状态会集中显示在这里。"
            icon={Link2}
            title="还没有邀请记录"
          />
        )}
      </section>

      <Dialog.Root onOpenChange={setInviteOpen} open={inviteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay dialog-overlay--strong" />
          <Dialog.Content className={styles.dialog}>
            <div className={styles.dialogIcon}>
              <MailPlus aria-hidden="true" size={21} />
            </div>
            <Dialog.Title>邀请成员</Dialog.Title>
            <Dialog.Description>
              创建后邀请链接只展示一次，请立即安全发送给对应成员。
            </Dialog.Description>
            <div className={styles.formStack}>
              <label className={styles.field}>
                <span><strong>邮箱地址</strong></span>
                <input
                  autoFocus
                  className={styles.input}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="member@example.com"
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className={styles.field}>
                <span>
                  <strong>工作区角色</strong>
                  <small>可在成员加入后继续修改。</small>
                </span>
                <select
                  className={styles.select}
                  onChange={(event) =>
                    setInviteRole(
                      event.target.value as Exclude<MemberRole, "owner">
                    )
                  }
                  value={inviteRole}
                >
                  {availableInviteRoles.map((role) => (
                    <option key={role} value={role}>
                      {memberRoleCopy[role]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={styles.dialogActions}>
              <Dialog.Close asChild>
                <Button disabled={busy === "invite"} variant="secondary">
                  取消
                </Button>
              </Dialog.Close>
              <Button
                disabled={busy === "invite" || !inviteEmail.trim()}
                onClick={() => void submitInvitation()}
              >
                {busy === "invite" ? (
                  <LoaderCircle className={styles.spin} size={16} />
                ) : (
                  <MailPlus aria-hidden="true" size={16} />
                )}
                创建邀请
              </Button>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭邀请窗口" className={styles.dialogClose}>
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <OneTimeSecretDialog
        description="这是唯一一次显示完整邀请链接。关闭后不会保存在浏览器中。"
        label="邀请链接"
        onOpenChange={(open) => {
          if (!open) setInviteLink("");
        }}
        open={Boolean(inviteLink)}
        secret={inviteLink}
        title="邀请已创建"
      />

      {actionCopy && (
        <ConfirmActionDialog
          busy={busy === "danger"}
          confirmLabel={actionCopy.label}
          danger
          description={actionCopy.description}
          icon={actionCopy.icon}
          onConfirm={() => void executePendingAction()}
          onOpenChange={(open) => !open && setPendingAction(null)}
          open={Boolean(pendingAction)}
          title={actionCopy.title}
        />
      )}
    </ManagementPage>
  );
}
