import { AsyncLocalStorage } from 'node:async_hooks';
import { CODES, fail } from './errors.js';

/**
 * One access context for every business call. Request bodies may SUGGEST a
 * workspaceId/grants, but only a Host-derived context grants access.
 *
 * `shared` is readable by every workspace and writable only by an admin actor.
 */
export const SHARED_WORKSPACE = 'shared';
export const DEFAULT_ACTOR = Object.freeze({
  workspaceId: 'default',
  trustedWorkspaceId: 'default',
  grants: Object.freeze([]),
  canWriteShared: false,
  isAdmin: false,
  source: 'internal',
});

const storage = new AsyncLocalStorage();

export function currentActor() {
  return storage.getStore() ?? DEFAULT_ACTOR;
}

export function withActor(actor, fn) {
  const normalized = {
    ...DEFAULT_ACTOR,
    ...actor,
    workspaceId: actor?.workspaceId ?? DEFAULT_ACTOR.workspaceId,
    grants: Array.isArray(actor?.grants) ? [...actor.grants] : [],
  };
  return storage.run(normalized, fn);
}

export function createAccessPolicy({
  defaultWorkspaceId = 'default',
  trustedGrants = [],
  adminWorkspaces = [],
  allowAdmin = false,
} = {}) {
  /** Never trust `requestedGrants`: only Host-side trusted grants count. */
  function resolveActor({ requestedWorkspaceId, requestedGrants, sessionWorkspaceId, isAdmin = false, source = 'http' } = {}) {
    const trustedWorkspaceId = typeof sessionWorkspaceId === 'string' && sessionWorkspaceId
      ? sessionWorkspaceId
      : defaultWorkspaceId;
    let workspaceId = trustedWorkspaceId;
    if (requestedWorkspaceId && requestedWorkspaceId !== trustedWorkspaceId) {
      if (requestedWorkspaceId === SHARED_WORKSPACE) {
        workspaceId = SHARED_WORKSPACE;
      } else if (allowAdmin && isAdmin && adminWorkspaces.includes(requestedWorkspaceId)) {
        workspaceId = requestedWorkspaceId;
      } else {
        fail(CODES.PERMISSION_DENIED, `请求的工作空间 ${requestedWorkspaceId} 与会话绑定的 ${trustedWorkspaceId} 不一致`, {
          requestedWorkspaceId, trustedWorkspaceId,
        });
      }
    }
    void requestedGrants;
    return {
      workspaceId,
      trustedWorkspaceId,
      grants: [...trustedGrants],
      canWriteShared: allowAdmin && isAdmin,
      isAdmin: allowAdmin && isAdmin,
      source,
      ignoredRequestGrants: Array.isArray(requestedGrants) ? requestedGrants.length : 0,
    };
  }

  function adminActor() {
    if (!allowAdmin) fail(CODES.PERMISSION_DENIED, '全局备份是独立管理操作，当前部署未开放');
    return { ...DEFAULT_ACTOR, isAdmin: true, canWriteShared: true, grants: [...trustedGrants, 'state.export.admin'], source: 'admin' };
  }

  return { resolveActor, adminActor, defaultWorkspaceId, trustedGrants };
}

/** The single ownership gate used by every service. */
export function assertOwner(record, action = 'read', actor = currentActor()) {
  if (!record) fail(CODES.NOT_FOUND, '对象不存在', { action });
  const owner = record.workspaceId ?? 'default';
  if (owner === SHARED_WORKSPACE) {
    if (action !== 'read' && !actor.canWriteShared) {
      fail(CODES.PERMISSION_DENIED, '共享资料为只读；修改、删除、归档需管理权限', { owner, action });
    }
    return record;
  }
  if (owner !== actor.workspaceId) {
    fail(CODES.PERMISSION_DENIED, '对象属于其他工作空间，拒绝访问', { owner, action });
  }
  return record;
}

export function ownerFilter(records, actor = currentActor()) {
  return records.filter((record) => {
    const owner = record.workspaceId ?? 'default';
    return owner === actor.workspaceId || owner === SHARED_WORKSPACE;
  });
}

export function assertGranted(permission, actor = currentActor()) {
  if (!actor.grants.includes(permission)) {
    fail(CODES.PERMISSION_DENIED, `缺少 Host 侧授予的权限 ${permission}`, { permission });
  }
}
